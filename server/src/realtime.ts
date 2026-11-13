import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { config } from './config.ts';
import { sessionFromToken, tokenFromHeaders } from './auth.ts';
import { canSee, channelAudience, isTimedOut, loadChannel, memberAccess } from './access.ts';
import type { Db } from './db.ts';
import { usableExpression } from './expressions.ts';
import { bump } from './stats.ts';
import { Perm, has, topRolePosition } from '../../shared/permissions.ts';
import { audit } from './audit.ts';
import { randomUUID } from 'node:crypto';
import type { PublicUser, RtcSignal, VoiceState, Activity, TogetherState, CallChatMessage, ScreenAudience } from '../../shared/types.ts';
import { checkAutomod } from './community.ts';
import { HttpError } from './http.ts';
import { limit } from './security.ts';

type Ack = (res: any) => void;

/** limite contra abuso nos eventos do socket (o `limit` das rotas lança erro; aqui só recusa) */
const allow = (key: string, max: number, windowMs: number) => {
  try {
    limit(key, max, windowMs);
    return true;
  } catch {
    return false;
  }
};

/**
 * Camada de tempo real: presença, digitação, estado de voz e
 * retransmissão de sinalização WebRTC entre os participantes.
 */
export class Realtime {
  readonly io: Server;
  /** "Assistir juntos": vídeo de cada call (some quando a call esvazia) */
  private together = new Map<string, TogetherState>();
  /** quem pode assistir a transmissão de cada pessoa (socketId de quem transmite) */
  private screenAudience = new Map<string, ScreenAudience>();
  /** chat privado de cada call (só na memória; some quando a call esvazia) */
  private callChat = new Map<string, CallChatMessage[]>();
  private lastCallChat = new Map<string, number[]>();
  /** desligando para atualizar (ver index.ts) */
  shuttingDown = false;
  /** userId -> número de conexões abertas */
  private online = new Map<string, number>();
  /** conexões com o Resenha visível na tela (userId -> socketIds): quem não tem nenhuma recebe notificação no celular */
  private activeSockets = new Map<string, Set<string>>();
  /** socketId -> estado de voz */
  private voice = new Map<string, VoiceState>();
  /** silenciado/ensurdecido por moderador, por servidor e pessoa ("guildId:userId"); vale até tirarem */
  private voiceMod = new Map<string, { mute: boolean; deaf: boolean }>();
  /** quem um moderador está movendo: pode entrar no canal de destino mesmo se ele tiver limite */
  private moveTickets = new Map<string, { channelId: string; until: number }>();
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
        // o site entra pelo cookie protegido; clientes sem navegador mandam o token
        const session = await sessionFromToken(db, socket.handshake.auth?.token ?? tokenFromHeaders(socket.handshake.headers));
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

    // a página avisa quando fica visível/escondida (para decidir se manda notificação no celular)
    this.setActive(user.id, socket.id, socket.handshake.auth?.visible !== false);
    socket.on('client:active', (payload: unknown) => this.setActive(user.id, socket.id, payload === true));

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

    // moderação de voz: mover, desconectar, silenciar e ensurdecer (com permissão e hierarquia)
    socket.on('voice:mod', (payload: unknown, ack?: Ack) => {
      this.onVoiceMod(socket, payload)
        .then((res) => ack?.(res))
        .catch((err) => {
          console.error('[voice] moderação falhou', err);
          ack?.({ ok: false, error: 'Não foi possível fazer isso agora.' });
        });
    });

    // "Jogando agora" / "Ouvindo agora": o app de desktop informa o jogo aberto ou a música do Spotify (ou null)
    socket.on('activity:set', (payload: unknown) => {
      const p = z
        .object({
          name: z.string().trim().min(1).max(100).nullable(),
          kind: z.enum(['game', 'music']).optional(),
          details: z.string().trim().max(100).nullable().optional(),
        })
        .safeParse(payload);
      if (!p.success) return;
      const current = this.activities.get(user.id);
      if (!p.data.name) {
        if (!current) return;
        this.activities.delete(user.id);
        this.io.emit('activity:update', { userId: user.id, activity: null });
        return;
      }
      const kind = p.data.kind ?? 'game';
      const details = kind === 'music' ? p.data.details || null : null;
      if (current?.name === p.data.name && (current.kind ?? 'game') === kind && (current.details ?? null) === details) return;
      const activity: Activity = { name: p.data.name, startedAt: new Date().toISOString(), ...(kind === 'music' ? { kind, details } : {}) };
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
          screenAudioOff: z.boolean().optional(),
          screenAudioMode: z.enum(['clean', 'system', 'tab', 'none']).optional(),
        })
        .safeParse(payload);
      if (!state || !p.success) return;
      if (p.data.screen && !state.screen) bump('screen_share');
      Object.assign(state, p.data);
      this.emitVoice(state, 'voice:state', state);
    });

    // Assistir juntos (YouTube sincronizado): qualquer pessoa da call controla
    socket.on('together:get', (_p: unknown, ack?: Ack) => {
      const v = this.voice.get(socket.id);
      ack?.({ state: v ? (this.together.get(v.channelId) ?? null) : null, now: Date.now() });
    });
    // (calcula antes: com `ack?.(f())`, f nem roda quando o cliente não pede resposta)
    socket.on('together:action', (payload: unknown, ack?: Ack) => {
      const r = this.onTogether(socket, payload);
      ack?.(r);
    });
    socket.on('callchat:get', (_p: unknown, ack?: Ack) => {
      const v = this.voice.get(socket.id);
      ack?.({ channelId: v?.channelId ?? null, messages: v ? (this.callChat.get(v.channelId) ?? []) : [] });
    });
    socket.on('callchat:send', (payload: unknown, ack?: Ack) => {
      this.onCallChat(socket, payload).then(
        (r) => ack?.(r),
        (err) => ack?.({ ok: false, error: err instanceof HttpError ? err.message : 'Não deu para mandar a mensagem.' }),
      );
    });
    socket.on('callchat:delete', (payload: unknown, ack?: Ack) => {
      const r = this.onCallChatDelete(socket, payload);
      ack?.(r);
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
      // pedido para assistir uma transmissão restrita: só chega a quem transmite se a pessoa pode
      // (o app de quem transmite confere de novo antes de mandar qualquer imagem)
      if (payload.data?.type === 'watch' && payload.data.on && this.screenAudience.has(to)) {
        // conferir custa uma consulta (amigos): no máximo 20 pedidos a cada 10 s por pessoa
        if (!allow(`watch:${socket.id}`, 20, 10_000)) return;
        void this.canWatchScreen(to, from.userId).then((ok) => {
          if (ok) this.io.to(to).emit('rtc:signal', { from: socket.id, data: payload.data });
          else this.io.to(socket.id).emit('screen:access', { socketId: to, allowed: false });
        });
        return;
      }
      this.io.to(to).emit('rtc:signal', { from: socket.id, data: payload.data });
    });

    // quem pode assistir a minha transmissão
    socket.on('screen:audience', (payload: unknown, ack?: Ack) => {
      const state = this.voice.get(socket.id);
      const p = z
        .object({ mode: z.enum(['all', 'friends', 'only', 'except']), userIds: z.array(z.string().max(64)).max(100) })
        .safeParse(payload);
      if (!state || !p.success) {
        ack?.({ ok: false });
        return;
      }
      // avisa cada pessoa da call a cada mudança: no máximo 10 mudanças a cada 10 s
      if (!allow(`audience:${socket.id}`, 10, 10_000)) {
        ack?.({ ok: false, error: 'Calma: muitas mudanças seguidas. Espere uns segundos.' });
        return;
      }
      if (p.data.mode === 'all') this.screenAudience.delete(socket.id);
      else this.screenAudience.set(socket.id, { mode: p.data.mode, userIds: [...new Set(p.data.userIds)] });
      void this.sendScreenAccess(socket.id);
      ack?.({ ok: true });
    });

    // 'disconnecting' (e não 'disconnect') porque aqui socket.rooms ainda está preenchido.
    socket.on('disconnecting', () => {
      // servidor desligando para atualizar: NÃO avisa que todo mundo saiu da call (os apps mantêm a
      // voz, que é direta entre os aparelhos, e voltam sozinhos para o servidor novo)
      if (this.shuttingDown) return;
      this.leaveVoice(socket.id);
      this.setActive(user.id, socket.id, false);
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


  private setActive(userId: string, socketId: string, active: boolean) {
    const set = this.activeSockets.get(userId) ?? new Set<string>();
    if (active) set.add(socketId);
    else set.delete(socketId);
    if (set.size) this.activeSockets.set(userId, set);
    else this.activeSockets.delete(userId);
  }

  /** Agora: pessoas online, em call, calls abertas e transmissões (Painel da equipe → Saúde). */
  liveCounts() {
    const states = [...this.voice.values()];
    return {
      online: this.online.size,
      inVoice: states.length,
      calls: new Set(states.map((s) => s.channelId)).size,
      streaming: states.filter((s) => s.screen).length,
    };
  }

  /** A pessoa está com o Resenha aberto e visível em algum aparelho agora. */
  isActive(userId: string) {
    return this.activeSockets.has(userId);
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
      if (access.rulesPending) return { ok: false, error: 'Aceite as regras do servidor para entrar nas calls (o botão "Aceito" fica no topo do servidor).' };
      const inChannel = [...this.voice.values()].filter((s) => s.channelId === full.id && s.userId !== user.id).length;
      const ticket = this.moveTickets.get(socket.id);
      const moved = !!ticket && ticket.channelId === full.id && ticket.until > Date.now();
      this.moveTickets.delete(socket.id);
      if (full.userLimit > 0 && inChannel >= full.userLimit && !moved) {
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
    const mod = state.guildId ? this.voiceMod.get(`${state.guildId}:${user.id}`) : undefined;
    if (mod?.mute) state.serverMuted = true;
    if (mod?.deaf) state.serverDeafened = true;
    this.voice.set(socket.id, state);
    bump('voice_join');
    socket.join(`voice:${state.channelId}`);
    for (const peer of peers) {
      this.io.to(peer.socketId).emit('voice:peer-joined', { socketId: socket.id, userId: user.id });
    }
    // transmissões restritas já em andamento: conta a quem chegou se pode assistir
    for (const sid of this.screenAudience.keys()) {
      if (this.voice.get(sid)?.channelId === state.channelId) void this.sendScreenAccess(sid, [socket.id]);
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
    this.screenAudience.delete(socketId);
    // call vazia: o "Assistir juntos" e o chat privado acabam
    if (![...this.voice.values()].some((v) => v.channelId === state.channelId)) {
      this.together.delete(state.channelId);
      this.callChat.delete(state.channelId);
    }
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

  private onTogether(socket: Socket, payload: unknown) {
    const v = this.voice.get(socket.id);
    if (!v) return { ok: false, error: 'Entre na call primeiro.' };
    const id = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
    const pos = z.number().min(0).max(86_400);
    const parsed = z
      .discriminatedUnion('action', [
        z.object({ action: z.literal('play'), videoId: id, title: z.string().max(200).nullable().optional(), position: pos.optional() }),
        z.object({ action: z.literal('enqueue'), videoId: id, title: z.string().max(200).nullable().optional() }),
        z.object({ action: z.literal('pause'), position: pos }),
        z.object({ action: z.literal('resume'), position: pos }),
        z.object({ action: z.literal('seek'), position: pos }),
        z.object({ action: z.literal('next') }),
        z.object({ action: z.literal('ended'), videoId: id, position: pos.optional(), duration: pos.optional() }),
        z.object({ action: z.literal('remove'), index: z.number().int().min(0).max(100) }),
        z.object({ action: z.literal('stop') }),
      ])
      .safeParse(payload);
    if (!parsed.success) return { ok: false, error: 'Pedido inválido.' };
    const a = parsed.data;
    const user = (socket.data.user as PublicUser).id;
    const now = Date.now();
    const cur = this.together.get(v.channelId) ?? null;
    let next: TogetherState | null = cur;
    const start = (videoId: string, title: string | null, by: string, position = 0, queue = cur?.queue ?? []): TogetherState => ({
      videoId,
      title,
      playing: true,
      position,
      at: now,
      by,
      queue,
    });
    switch (a.action) {
      case 'play':
        next = start(a.videoId, a.title ?? null, user, a.position ?? 0);
        break;
      case 'enqueue':
        if (!cur) next = start(a.videoId, a.title ?? null, user);
        else if (cur.queue.length >= 50) return { ok: false, error: 'A fila já tem 50 vídeos.' };
        else next = { ...cur, queue: [...cur.queue, { videoId: a.videoId, title: a.title ?? null, by: user }] };
        break;
      case 'pause':
      case 'resume':
      case 'seek':
        if (!cur) return { ok: false };
        next = { ...cur, playing: a.action === 'seek' ? cur.playing : a.action === 'resume', position: a.position, at: now };
        break;
      case 'ended':
        // várias pessoas avisam que acabou: só a primeira conta
        if (!cur || cur.videoId !== a.videoId || now - cur.at < 3000) return { ok: true };
        // só acaba quando a linha do tempo de TODOS chegou ao fim: um player com defeito (ou um PC que
        // dormiu) não encerra o vídeo dos outros
        {
          const shared = cur.playing ? cur.position + (now - cur.at) / 1000 : cur.position;
          if (!a.duration || shared < a.duration - 10) return { ok: true };
        }
      // eslint-disable-next-line no-fallthrough
      case 'next': {
        const q = cur?.queue ?? [];
        next = q.length ? start(q[0].videoId, q[0].title, q[0].by, 0, q.slice(1)) : null;
        break;
      }
      case 'remove':
        if (!cur) return { ok: false };
        next = { ...cur, queue: cur.queue.filter((_, i) => i !== a.index) };
        break;
      case 'stop':
        next = null;
        break;
    }
    if (next) this.together.set(v.channelId, next);
    else this.together.delete(v.channelId);
    // avisa no chat privado da call o que foi colocado para tocar
    if (a.action === 'play' || a.action === 'enqueue') this.pushCallChat(v.channelId, { userId: user, content: a.title?.trim() || 'um vídeo do YouTube', kind: 'together' });
    this.io.to(`voice:${v.channelId}`).emit('together:state', { channelId: v.channelId, state: next, now, by: user, action: a.action });
    return { ok: true };
  }

  /** A pessoa (userId) pode assistir a transmissão de quem está no socket `streamerSid`? */
  private async canWatchScreen(streamerSid: string, viewerUserId: string) {
    const a = this.screenAudience.get(streamerSid);
    const st = this.voice.get(streamerSid);
    if (!a || !st || a.mode === 'all' || viewerUserId === st.userId) return true;
    if (a.mode === 'only') return a.userIds.includes(viewerUserId);
    if (a.mode === 'except') return !a.userIds.includes(viewerUserId);
    const rows = await this.db.query(
      `select 1 from friendships where status = 'accepted'
         and ((requester_id = $1 and addressee_id = $2) or (requester_id = $2 and addressee_id = $1)) limit 1`,
      [st.userId, viewerUserId],
    );
    return rows.length > 0;
  }

  /** Conta a cada pessoa da call (ou só a `only`) se ela pode assistir a transmissão de `streamerSid`. */
  private async sendScreenAccess(streamerSid: string, only?: string[]) {
    const st = this.voice.get(streamerSid);
    if (!st) return;
    const targets = only ?? [...this.voice.values()].filter((v) => v.channelId === st.channelId && v.socketId !== streamerSid).map((v) => v.socketId);
    for (const sid of targets) {
      const v = this.voice.get(sid);
      if (!v) continue;
      const allowed = await this.canWatchScreen(streamerSid, v.userId).catch(() => false);
      this.io.to(sid).emit('screen:access', { socketId: streamerSid, allowed });
    }
  }

  private pushCallChat(channelId: string, m: Omit<CallChatMessage, 'id' | 'at'>) {
    const msg: CallChatMessage = { id: randomUUID(), at: Date.now(), ...m };
    const list = this.callChat.get(channelId) ?? [];
    list.push(msg);
    if (list.length > 200) list.splice(0, list.length - 200);
    this.callChat.set(channelId, list);
    this.io.to(`voice:${channelId}`).emit('callchat:message', { channelId, message: msg });
    return msg;
  }

  /** Chat privado da call: só quem está nela manda e recebe; nada vai para o banco. */
  private async onCallChat(socket: Socket, payload: unknown) {
    const v = this.voice.get(socket.id);
    if (!v) return { ok: false, error: 'Entre na call para usar o chat dela.' };
    const p = z.object({ content: z.string().trim().min(1).max(1000) }).safeParse(payload);
    if (!p.success) return { ok: false, error: 'Mensagem vazia ou longa demais (até 1000 caracteres).' };
    const user = socket.data.user as PublicUser;
    const now = Date.now();
    const recent = (this.lastCallChat.get(user.id) ?? []).filter((t) => now - t < 10_000);
    if (recent.length >= 8) return { ok: false, error: 'Calma! Muitas mensagens seguidas. Espere uns segundos.' };
    if (v.guildId) {
      const access = await memberAccess(this.db, v.guildId, user.id);
      if (!access) return { ok: false, error: 'Você não está mais neste servidor.' };
      if (isTimedOut(access)) return { ok: false, error: 'Você está de castigo neste servidor.' };
      const [g] = await this.db.query<{ invite_code: string }>('select invite_code from guilds where id = $1', [v.guildId]);
      const [c] = await this.db.query<{ name: string }>('select name from channels where id = $1', [v.channelId]);
      await checkAutomod(this.db, {
        guildId: v.guildId,
        channelName: c?.name ?? 'call',
        access,
        userId: user.id,
        inviteCode: g?.invite_code ?? '',
        texts: [p.data.content],
      });
    }
    // saiu da call enquanto conferia
    if (this.voice.get(socket.id)?.channelId !== v.channelId) return { ok: false, error: 'Você saiu da call.' };
    this.lastCallChat.set(user.id, [...recent, now]);
    if (this.lastCallChat.size > 5000) for (const k of [...this.lastCallChat.keys()].slice(0, 1000)) this.lastCallChat.delete(k);
    const message = this.pushCallChat(v.channelId, { userId: user.id, content: p.data.content, kind: 'text' });
    bump('messages');
    return { ok: true, message };
  }

  /** Apaga a própria mensagem do chat privado. */
  private onCallChatDelete(socket: Socket, payload: unknown) {
    const v = this.voice.get(socket.id);
    const p = z.object({ id: z.string().max(64) }).safeParse(payload);
    if (!v || !p.success) return { ok: false };
    const list = this.callChat.get(v.channelId) ?? [];
    const i = list.findIndex((m) => m.id === p.data.id);
    if (i < 0) return { ok: true };
    if (list[i].userId !== (socket.data.user as PublicUser).id) return { ok: false, error: 'Você só pode apagar as suas mensagens.' };
    list.splice(i, 1);
    this.io.to(`voice:${v.channelId}`).emit('callchat:delete', { channelId: v.channelId, id: p.data.id });
    return { ok: true };
  }

  private async onVoiceMod(socket: Socket, payload: unknown) {
    const actor = socket.data.user as PublicUser;
    const p = z
      .object({
        action: z.enum(['move', 'disconnect', 'mute', 'unmute', 'deafen', 'undeafen']),
        socketId: z.string(),
        channelId: z.string().optional(),
      })
      .safeParse(payload);
    if (!p.success) return { ok: false, error: 'Requisição inválida.' };
    const { action } = p.data;
    const target = this.voice.get(p.data.socketId);
    if (!target || !target.guildId) return { ok: false, error: 'Essa pessoa não está mais na call.' };
    const need = action === 'move' || action === 'disconnect' ? Perm.MOVE_MEMBERS : action === 'mute' || action === 'unmute' ? Perm.MUTE_MEMBERS : Perm.DEAFEN_MEMBERS;
    const [me, them] = await Promise.all([memberAccess(this.db, target.guildId, actor.id), memberAccess(this.db, target.guildId, target.userId)]);
    if (!me || !has(me.perms, need)) return { ok: false, error: 'Seu cargo não tem permissão para isso neste servidor.' };
    if (!them) return { ok: false, error: 'Essa pessoa não está mais no servidor.' };
    // ninguém mexe em quem está no mesmo nível ou acima (o dono só mexe em si mesmo... e em todos)
    if (target.userId !== actor.id && topRolePosition(me.ctx, actor.id, me.roleIds) <= topRolePosition(them.ctx, target.userId, them.roleIds)) {
      return { ok: false, error: 'Você só pode fazer isso com quem tem cargo abaixo do seu.' };
    }
    const actorName = (await this.db.query<{ name: string }>(
      `select coalesce(m.nick, u.display_name) as name from users u left join members m on m.user_id = u.id and m.guild_id = $2 where u.id = $1`,
      [actor.id, target.guildId],
    ))[0]?.name ?? actor.displayName;
    const targetLabel = (await this.db.query<{ name: string }>('select display_name as name from users where id = $1', [target.userId]))[0]?.name ?? 'alguém';
    const who = { type: 'user' as const, id: target.userId, label: targetLabel };
    const from = await loadChannel(this.db, target.channelId);

    if (action === 'move') {
      const dest = p.data.channelId ? await loadChannel(this.db, p.data.channelId) : null;
      if (!dest || dest.guildId !== target.guildId || dest.type !== 'voice') return { ok: false, error: 'Canal de voz não encontrado.' };
      if (dest.id === target.channelId) return { ok: true };
      if (!canSee(them, dest)) return { ok: false, error: 'Essa pessoa não tem acesso a esse canal.' };
      if ([...this.voice.values()].filter((v) => v.channelId === dest.id).length >= config.maxVoicePeers) {
        return { ok: false, error: `Esse canal está cheio (máximo de ${config.maxVoicePeers} pessoas).` };
      }
      this.moveTickets.set(target.socketId, { channelId: dest.id, until: Date.now() + 20_000 });
      this.io.to(target.socketId).emit('voice:move', { channelId: dest.id, by: actorName });
      await audit(this.db, target.guildId, actor.id, 'voice_move', who, { from: from?.name ?? '', to: dest.name });
      return { ok: true };
    }
    if (action === 'disconnect') {
      this.kickFromVoice(target.socketId, `${actorName} tirou você da call.`);
      await audit(this.db, target.guildId, actor.id, 'voice_disconnect', who, { from: from?.name ?? '' });
      return { ok: true };
    }
    const key = `${target.guildId}:${target.userId}`;
    const cur = this.voiceMod.get(key) ?? { mute: false, deaf: false };
    if (action === 'mute' || action === 'unmute') cur.mute = action === 'mute';
    else cur.deaf = action === 'deafen';
    if (cur.mute || cur.deaf) this.voiceMod.set(key, cur);
    else this.voiceMod.delete(key);
    // vale em qualquer aparelho dessa pessoa nesse servidor
    for (const v of this.voice.values()) {
      if (v.guildId !== target.guildId || v.userId !== target.userId) continue;
      v.serverMuted = cur.mute || undefined;
      v.serverDeafened = cur.deaf || undefined;
      this.emitVoice(v, 'voice:state', v);
      this.io.to(v.socketId).emit('voice:server-mod', { muted: cur.mute, deafened: cur.deaf, action, by: actorName });
    }
    await audit(this.db, target.guildId, actor.id, `voice_${action}` as 'voice_mute', who, { channel: from?.name ?? '' });
    return { ok: true };
  }

  private kickFromVoice(socketId: string, reason: string) {
    this.io.to(socketId).emit('voice:kicked', { reason });
    this.leaveVoice(socketId);
  }
}
