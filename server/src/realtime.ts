import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { config } from './config.ts';
import { sessionFromToken } from './auth.ts';
import { canSee, channelAudience, isTimedOut, loadChannel, memberAccess } from './access.ts';
import type { Db } from './db.ts';
import { usableExpression } from './expressions.ts';
import { Perm, has } from '../../shared/permissions.ts';
import type { PublicUser, RtcSignal, VoiceState, Activity } from '../../shared/types.ts';

type Ack = (res: any) => void;

/**
 * Camada de tempo real: presença, digitação, estado de voz e
 * retransmissão de sinalização WebRTC entre os participantes.
 */
export class Realtime {
  readonly io: Server;
  /** userId -> número de conexões abertas */
  private online = new Map<string, number>();
  /** socketId -> estado de voz */
  private voice = new Map<string, VoiceState>();
  /** "Jogando agora": userId -> jogo (só em memória, some quando a pessoa sai) */
  private activities = new Map<string, Activity>();
  /** participantes de cada conversa direta com chamada ativa (para entregar eventos só a eles) */
  private dmMembers = new Map<string, string[]>();
  /** canais de voz privados de servidor: quem pode ver (null/ausente = todos do servidor) */
  private voiceAudience = new Map<string, string[] | null>();
  /** chamadas tocando: canal da DM -> quem ligou, quem recebe e o tempo limite */
  private rings = new Map<string, { caller: PublicUser; callerSocket: string; callee: string; timer: ReturnType<typeof setTimeout> }>();

  constructor(
    http: HttpServer,
    private db: Db,
  ) {
    this.io = new Server(http, {
      // só aceita conexões vindas do próprio site (ou de clientes sem navegador, que não mandam Origin)
      allowRequest: (req, cb) => {
        const origin = req.headers.origin;
        if (!origin) return cb(null, true);
        try {
          cb(null, new URL(origin).host === req.headers.host);
        } catch {
          cb(null, false);
        }
      },
      maxHttpBufferSize: 1e6,
      pingInterval: 20000,
      pingTimeout: 20000,
    });

    this.io.use(async (socket, next) => {
      try {
        const session = await sessionFromToken(db, socket.handshake.auth?.token);
        if (!session) return next(new Error('unauthorized'));
        socket.data.user = session.user;
        socket.data.sessionHash = session.sessionHash;
        next();
      } catch (err) {
        next(err as Error);
      }
    });

    this.io.on('connection', (socket) => {
      this.onConnection(socket).catch((err) => {
        console.error('[realtime] erro na conexão', err);
        socket.disconnect(true);
      });
    });
  }

  // ---------- API usada pelas rotas REST ----------

  emitGuild(guildId: string, event: string, payload: unknown) {
    this.io.to(`guild:${guildId}`).emit(event, payload);
  }

  emitUser(userId: string, event: string, payload: unknown) {
    this.io.to(`user:${userId}`).emit(event, payload);
  }

  /** Sessões encerradas (sair do aparelho, troca de senha): derruba as conexões delas na hora. */
  endSessions(hashes: string[]) {
    if (!hashes.length) return;
    for (const socket of this.io.sockets.sockets.values()) {
      if (hashes.includes(socket.data.sessionHash)) {
        socket.emit('session:ended');
        socket.disconnect(true);
      }
    }
  }

  /** Conta excluída: derruba todas as conexões dela. */
  endUser(userId: string) {
    for (const socket of this.io.sockets.sockets.values()) {
      if ((socket.data.user as PublicUser | undefined)?.id === userId) {
        socket.emit('session:ended');
        socket.disconnect(true);
      }
    }
  }

  /** Coloca as conexões do usuário na sala do servidor (após entrar via convite). */
  userJoinedGuild(userId: string, guildId: string) {
    this.io.in(`user:${userId}`).socketsJoin(`guild:${guildId}`);
    // envia ao novo membro quem está online e em voz nesse servidor
    this.emitUser(userId, 'voice:states', { guildId, states: this.voiceStatesFor(guildId, userId) });
    this.emitUser(userId, 'presence:bulk', { online: [...this.online.keys()] });
  }

  userLeftGuild(userId: string, guildId: string) {
    for (const [sid, s] of this.voice) {
      if (s.userId === userId && s.guildId === guildId) this.kickFromVoice(sid, 'Você saiu do servidor.');
    }
    this.io.in(`user:${userId}`).socketsLeave(`guild:${guildId}`);
  }

  guildDeleted(guildId: string) {
    for (const [sid, s] of this.voice) {
      if (s.guildId === guildId) this.kickFromVoice(sid, 'O servidor foi excluído.');
    }
    this.io.in(`guild:${guildId}`).socketsLeave(`guild:${guildId}`);
  }

  /** Algo mudou na estrutura do servidor (cargos, canais, permissões...): todos recarregam. */
  guildChanged(guildId: string) {
    this.emitGuild(guildId, 'guild:refresh', { guildId });
  }

  private canSeeVoice(state: VoiceState, userId: string) {
    const audience = this.voiceAudience.get(state.channelId);
    return !audience || audience.includes(userId);
  }

  /** Quem está em voz nesse servidor, do ponto de vista dessa pessoa (sem canais privados que ela não vê). */
  voiceStatesFor(guildId: string, userId: string): VoiceState[] {
    return [...this.voice.values()].filter((s) => s.guildId === guildId && this.canSeeVoice(s, userId));
  }

  /**
   * Depois de mudar cargos/permissões/castigos: recalcula quem vê cada canal de voz ocupado,
   * tira da voz quem perdeu acesso ou ficou de castigo, e reenvia a lista de quem está em voz.
   */
  async recheckVoice(guildId: string) {
    const channelIds = new Set([...this.voice.values()].filter((s) => s.guildId === guildId).map((s) => s.channelId));
    for (const channelId of channelIds) {
      const channel = await loadChannel(this.db, channelId);
      if (!channel) continue;
      this.voiceAudience.set(channelId, await channelAudience(this.db, channel));
      for (const [sid, s] of this.voice) {
        if (s.channelId !== channelId) continue;
        const access = await memberAccess(this.db, guildId, s.userId);
        if (!access || !canSee(access, channel)) this.kickFromVoice(sid, 'Você não tem mais acesso a esse canal de voz.');
        else if (isTimedOut(access)) this.kickFromVoice(sid, 'Você foi colocado de castigo e saiu da chamada.');
      }
    }
    const members = await this.db.query<{ user_id: string }>('select user_id from members where guild_id = $1', [guildId]);
    for (const m of members) this.emitUser(m.user_id, 'voice:states', { guildId, states: this.voiceStatesFor(guildId, m.user_id) });
  }

  channelDeleted(channelId: string) {
    for (const [sid, s] of this.voice) {
      if (s.channelId === channelId) this.kickFromVoice(sid, 'O canal de voz foi excluído.');
    }
  }

  // ---------- Conexão ----------

  private async onConnection(socket: Socket) {
    const user = socket.data.user as PublicUser;
    socket.join(`user:${user.id}`);

    const rows = await this.db.query<{ guild_id: string }>(
      'select guild_id from members where user_id = $1',
      [user.id],
    );
    const guildIds = rows.map((r) => r.guild_id);
    for (const g of guildIds) socket.join(`guild:${g}`);

    const count = (this.online.get(user.id) ?? 0) + 1;
    this.online.set(user.id, count);
    // presença vai para todos: amigos podem não ter nenhum servidor em comum
    if (count === 1) this.io.emit('presence:update', { userId: user.id, online: true });

    const dmRows = await this.db.query<{ channel_id: string }>('select channel_id from dm_members where user_id = $1', [user.id]);
    const dmIds = new Set(dmRows.map((r) => r.channel_id));
    socket.emit('ready', {
      socketId: socket.id,
      online: [...this.online.keys()],
      voiceStates: [...this.voice.values()].filter((s) =>
        s.guildId ? guildIds.includes(s.guildId) && this.canSeeVoice(s, user.id) : dmIds.has(s.channelId),
      ),
      maxVoicePeers: config.maxVoicePeers,
      activities: Object.fromEntries(this.activities),
    });
    // ligação tocando para mim enquanto eu estava desconectado/recarregando
    for (const [channelId, ring] of this.rings) {
      if (ring.callee === user.id) socket.emit('call:ring', { channelId, from: ring.caller });
    }

    socket.on('call:decline', (payload: unknown) => {
      const channelId = typeof (payload as { channelId?: unknown })?.channelId === 'string' ? (payload as { channelId: string }).channelId : null;
      const ring = channelId ? this.rings.get(channelId) : undefined;
      if (!channelId || !ring || ring.callee !== user.id) return;
      this.stopRing(channelId);
      this.io.to(ring.callerSocket).emit('call:declined', { channelId, by: user });
      this.emitUser(user.id, 'call:end-ring', { channelId });
    });

    socket.on('typing', async (payload: unknown) => {
      const p = z.object({ guildId: z.string().optional(), channelId: z.string() }).safeParse(payload);
      if (!p.success) return;
      const { guildId, channelId } = p.data;
      if (guildId) {
        if (!socket.rooms.has(`guild:${guildId}`)) return;
        const channel = await loadChannel(this.db, channelId).catch(() => null);
        if (!channel || channel.guildId !== guildId) return;
        const audience = await channelAudience(this.db, channel).catch((): string[] => []);
        if (audience === null) socket.to(`guild:${guildId}`).emit('typing', { channelId, userId: user.id });
        else if (audience.includes(user.id)) {
          for (const uid of audience) if (uid !== user.id) this.emitUser(uid, 'typing', { channelId, userId: user.id });
        }
        return;
      }
      // conversa direta: avisa só o outro participante
      const rows = await this.db
        .query<{ user_id: string }>('select user_id from dm_members where channel_id = $1', [channelId])
        .catch(() => []);
      if (!rows.some((r) => r.user_id === user.id)) return;
      for (const r of rows) if (r.user_id !== user.id) this.emitUser(r.user_id, 'typing', { channelId, userId: user.id });
    });

    socket.on('voice:join', (payload: unknown, ack?: Ack) => {
      this.onVoiceJoin(socket, payload)
        .then((res) => ack?.(res))
        .catch((err) => {
          console.error('[voice] join falhou', err);
          ack?.({ ok: false, error: 'Não foi possível entrar no canal de voz.' });
        });
    });

    socket.on('voice:leave', () => this.leaveVoice(socket.id));

    // "Jogando agora": o app de desktop informa o jogo aberto (ou null quando fecha)
    socket.on('activity:set', (payload: unknown) => {
      const p = z.object({ name: z.string().trim().min(1).max(64).nullable() }).safeParse(payload);
      if (!p.success) return;
      const current = this.activities.get(user.id);
      if (!p.data.name) {
        if (!current) return;
        this.activities.delete(user.id);
        this.io.emit('activity:update', { userId: user.id, activity: null });
        return;
      }
      if (current?.name === p.data.name) return;
      const activity: Activity = { name: p.data.name, startedAt: new Date().toISOString() };
      this.activities.set(user.id, activity);
      this.io.emit('activity:update', { userId: user.id, activity });
    });

    socket.on('voice:update', (payload: unknown) => {
      const state = this.voice.get(socket.id);
      const p = z
        .object({
          muted: z.boolean().optional(),
          deafened: z.boolean().optional(),
          camera: z.boolean().optional(),
          screen: z.boolean().optional(),
        })
        .safeParse(payload);
      if (!state || !p.success) return;
      Object.assign(state, p.data);
      this.emitVoice(state, 'voice:state', state);
    });

    // Soundboard: toca um som para todos da chamada (sons de qualquer servidor seu, como no Nitro)
    socket.on('soundboard:play', (payload: unknown, ack?: Ack) => {
      this.onSoundboard(socket, payload)
        .then((res) => ack?.(res))
        .catch((err) => {
          console.error('[soundboard]', err);
          ack?.({ ok: false, error: 'Não foi possível tocar o som.' });
        });
    });

    socket.on('rtc:signal', (payload: { to?: unknown; data?: RtcSignal }) => {
      const to = typeof payload?.to === 'string' ? payload.to : null;
      const from = this.voice.get(socket.id);
      const target = to ? this.voice.get(to) : undefined;
      if (!to || !from || !target || from.channelId !== target.channelId) return;
      this.io.to(to).emit('rtc:signal', { from: socket.id, data: payload.data });
    });

    // 'disconnecting' (e não 'disconnect') porque aqui socket.rooms ainda está preenchido.
    socket.on('disconnecting', () => {
      this.leaveVoice(socket.id);
      const left = (this.online.get(user.id) ?? 1) - 1;
      if (left <= 0) {
        this.online.delete(user.id);
        this.io.emit('presence:update', { userId: user.id, online: false });
        if (this.activities.delete(user.id)) this.io.emit('activity:update', { userId: user.id, activity: null });
      } else {
        this.online.set(user.id, left);
      }
    });
  }


  // ---------- Voz ----------

  /** último som tocado por pessoa (evita "metralhadora" de sons) */
  private lastSound = new Map<string, number>();

  private async onSoundboard(socket: Socket, payload: unknown) {
    const user = socket.data.user as PublicUser;
    const p = z.object({ soundId: z.string() }).safeParse(payload);
    const state = this.voice.get(socket.id);
    if (!p.success || !state) return { ok: false, error: 'Entre numa chamada para usar o soundboard.' };
    if (state.guildId) {
      const access = await memberAccess(this.db, state.guildId, user.id);
      if (!access || !has(access.perms, Perm.USE_SOUNDBOARD)) return { ok: false, error: 'Seu cargo não pode usar o soundboard neste servidor.' };
      if (isTimedOut(access)) return { ok: false, error: 'Você está de castigo neste servidor.' };
    }
    const sound = await usableExpression(this.db, p.data.soundId, user.id, 'sound');
    if (!sound) return { ok: false, error: 'Som não encontrado.' };
    const now = Date.now();
    if (now - (this.lastSound.get(user.id) ?? 0) < 1500) return { ok: false, error: 'Calma! Espere um pouquinho entre um som e outro.' };
    this.lastSound.set(user.id, now);
    this.io.to(`voice:${state.channelId}`).emit('soundboard:play', {
      socketId: socket.id,
      userId: user.id,
      soundId: sound.id,
      fileId: sound.fileId,
      name: sound.name,
      emoji: sound.emoji,
    });
    return { ok: true };
  }

  private async onVoiceJoin(socket: Socket, payload: unknown) {
    const user = socket.data.user as PublicUser;
    const p = z
      .object({ channelId: z.string(), muted: z.boolean().optional(), deafened: z.boolean().optional() })
      .safeParse(payload);
    if (!p.success) return { ok: false, error: 'Requisição inválida.' };

    // canal de voz de um servidor do qual é membro, ou conversa direta da qual participa
    const [channel] = await this.db.query<{ guild_id: string | null; type: string }>(
      `select c.guild_id, c.type from channels c
       where c.id = $1 and (
         exists (select 1 from members m where m.guild_id = c.guild_id and m.user_id = $2)
         or exists (select 1 from dm_members d where d.channel_id = c.id and d.user_id = $2)
       )`,
      [p.data.channelId, user.id],
    );
    if (!channel || (channel.type !== 'voice' && channel.type !== 'dm')) {
      return { ok: false, error: 'Canal de voz não encontrado.' };
    }
    if (channel.type === 'dm') {
      const members = await this.db.query<{ user_id: string }>('select user_id from dm_members where channel_id = $1', [
        p.data.channelId,
      ]);
      this.dmMembers.set(p.data.channelId, members.map((m) => m.user_id));
    } else {
      const full = await loadChannel(this.db, p.data.channelId);
      const access = full?.guildId ? await memberAccess(this.db, full.guildId, user.id) : null;
      if (!full || !access || !canSee(access, full)) return { ok: false, error: 'Canal de voz não encontrado.' };
      if (isTimedOut(access)) return { ok: false, error: 'Você está de castigo neste servidor e não pode entrar em voz agora.' };
      const inChannel = [...this.voice.values()].filter((s) => s.channelId === full.id && s.userId !== user.id).length;
      if (full.userLimit > 0 && inChannel >= full.userLimit) {
        return { ok: false, error: `Canal cheio (limite de ${full.userLimit} pessoa${full.userLimit > 1 ? "s" : ""}).` };
      }
      this.voiceAudience.set(full.id, await channelAudience(this.db, full));
    }

    // Um usuário só pode estar em uma chamada por vez (desconecta outro dispositivo/aba).
    for (const [sid, s] of this.voice) {
      if (s.userId === user.id && sid !== socket.id) {
        this.kickFromVoice(sid, 'Você entrou na voz em outro dispositivo.');
      }
    }
    this.leaveVoice(socket.id);

    const peers = [...this.voice.values()].filter((s) => s.channelId === p.data.channelId);
    if (peers.length >= config.maxVoicePeers) {
      return { ok: false, error: `Canal cheio (máximo de ${config.maxVoicePeers} pessoas).` };
    }

    const state: VoiceState = {
      socketId: socket.id,
      userId: user.id,
      guildId: channel.guild_id ?? '',
      channelId: p.data.channelId,
      muted: p.data.muted ?? false,
      deafened: p.data.deafened ?? false,
      camera: false,
      screen: false,
    };
    this.voice.set(socket.id, state);
    socket.join(`voice:${state.channelId}`);
    for (const peer of peers) {
      this.io.to(peer.socketId).emit('voice:peer-joined', { socketId: socket.id, userId: user.id });
    }
    this.emitVoice(state, 'voice:state', state);

    if (channel.type === 'dm') {
      if (peers.length > 0) {
        // atendeu: para de tocar (inclusive nos outros aparelhos de quem atendeu)
        this.stopRing(state.channelId);
        this.emitUser(user.id, 'call:end-ring', { channelId: state.channelId });
      } else {
        this.startRing(socket, user, state.channelId);
      }
    }
    return { ok: true, peers: peers.map((s) => ({ socketId: s.socketId, userId: s.userId })) };
  }

  /** Entrega eventos de voz: ao servidor inteiro, ou só aos dois participantes da DM. */
  private emitVoice(state: VoiceState, event: string, payload: unknown) {
    if (state.guildId) {
      const audience = this.voiceAudience.get(state.channelId);
      if (!audience) this.emitGuild(state.guildId, event, payload);
      else for (const uid of audience) this.emitUser(uid, event, payload);
      return;
    }
    for (const uid of this.dmMembers.get(state.channelId) ?? []) this.emitUser(uid, event, payload);
  }

  private startRing(socket: Socket, caller: PublicUser, channelId: string) {
    const callee = (this.dmMembers.get(channelId) ?? []).find((id) => id !== caller.id);
    if (!callee) return;
    if (!this.online.has(callee)) {
      socket.emit('call:unavailable', { channelId, userId: callee });
      return;
    }
    this.stopRing(channelId);
    const timer = setTimeout(() => {
      this.rings.delete(channelId);
      this.emitUser(callee, 'call:end-ring', { channelId, missed: true, from: caller });
      this.io.to(socket.id).emit('call:missed', { channelId, userId: callee });
    }, config.ringTimeoutMs);
    this.rings.set(channelId, { caller, callerSocket: socket.id, callee, timer });
    this.emitUser(callee, 'call:ring', { channelId, from: caller });
  }

  private stopRing(channelId: string) {
    const ring = this.rings.get(channelId);
    if (!ring) return;
    clearTimeout(ring.timer);
    this.rings.delete(channelId);
  }

  private leaveVoice(socketId: string) {
    const state = this.voice.get(socketId);
    if (!state) return;
    this.voice.delete(socketId);
    this.io.in(socketId).socketsLeave(`voice:${state.channelId}`);
    this.io.to(`voice:${state.channelId}`).emit('voice:peer-left', { socketId });
    this.emitVoice(state, 'voice:state-remove', { socketId, guildId: state.guildId });
    // quem ligou desistiu antes de atenderem: vira "chamada perdida" para o outro
    const ring = this.rings.get(state.channelId);
    if (ring && ring.callerSocket === socketId) {
      this.stopRing(state.channelId);
      this.emitUser(ring.callee, 'call:end-ring', { channelId: state.channelId, missed: true, from: ring.caller });
    }
  }

  private kickFromVoice(socketId: string, reason: string) {
    this.io.to(socketId).emit('voice:kicked', { reason });
    this.leaveVoice(socketId);
  }
}
