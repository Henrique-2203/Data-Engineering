import { randomInt, randomUUID } from 'node:crypto';
import type { Router } from 'express';
import { z } from 'zod';
import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';
import { HttpError, parse, wrap } from './http.ts';
import { limit } from './security.ts';
import { requireFeature } from './beta.ts';
import { audit } from './audit.ts';
import { loadChannel, requireMember, requireNotTimedOut, requirePerm, type ChannelRow, type MemberAccess } from './access.ts';
import { checkAutomod, checkSlowmode, pollSchema } from './community.ts';
import { withFileLinks } from './attachments.ts';
import { bump } from './stats.ts';
import { USER_COLUMNS, type requireAuth } from './auth.ts';
import { Perm, has } from '../../shared/permissions.ts';
import type { BotCommandInfo, Member, Message, PublicUser } from '../../shared/types.ts';
import { BOT_COLOR as COLOR, bad, embed, type BotCommand, type Reply } from './botKit.ts';
import { aiConfigured } from './ai.ts';
import { DJ_COMMANDS } from './botDj.ts';
import { TICKET_COMMANDS } from './botTickets.ts';
import { AI_COMMANDS } from './botAi.ts';
import { GAME_COMMANDS } from './botGames.ts';
import { registerBotApps } from './botApps.ts';

/**
 * Bots da casa (em teste: recurso "bots"). O "Resenha Bot" roda DENTRO do servidor do Resenha:
 * ninguém hospeda nada, não existe token nem login de bot, e ele só faz o que está nesta lista de comandos.
 * - Quem tem "Gerenciar servidor" (e o recurso liberado) instala o bot no servidor, em Configurações → Integrações.
 * - Os comandos começam com "/" (popup no campo de mensagem) e a resposta sai como mensagem do bot.
 * - O texto que a pessoa digita passa pelo modo lento e pela moderação automática do servidor,
 *   para o bot não virar um jeito de driblar os filtros.
 * A API para bots de terceiros (token, webhooks) fica para depois.
 */
export const BOT_ID = 'bot_resenha';

/** Cria o usuário do bot (uma vez). Sem senha utilizável: ninguém consegue entrar como ele. */
export async function ensureBotUser(db: Db) {
  const [exists] = await db.query('select 1 from users where id = $1', [BOT_ID]);
  if (exists) return;
  for (const name of ['resenha_bot', 'resenhabot', 'resenha.bot', 'bot_resenha']) {
    const [taken] = await db.query('select 1 from users where username = $1', [name]);
    if (taken) continue;
    await db.query(
      `insert into users (id, username, display_name, password_hash, avatar_color, is_bot, official_auto_at, terms_accepted_at)
       values ($1, $2, 'Resenha Bot', 'bot$sem-login', $3, true, now(), now())`,
      [BOT_ID, name, COLOR],
    );
    return;
  }
  console.warn('[bots] não foi possível criar o usuário do bot: todos os nomes já estão em uso');
}

const DICE_HELP = 'Use assim: /dado d20 ou /dado 2d6 (até 20 dados, de 2 a 1000 lados).';
const UNITS: Record<string, { ms: number; one: string; many: string }> = {
  m: { ms: 60_000, one: 'minuto', many: 'minutos' },
  min: { ms: 60_000, one: 'minuto', many: 'minutos' },
  h: { ms: 3_600_000, one: 'hora', many: 'horas' },
  d: { ms: 86_400_000, one: 'dia', many: 'dias' },
};

export const COMMANDS: BotCommand[] = [
  {
    name: 'dado',
    group: 'Diversão',
    description: 'Rola um ou mais dados',
    usage: '/dado d20  ·  /dado 2d6',
    run: ({ args }) => {
      const t = args.toLowerCase().replace(/\s+/g, '') || 'd6';
      const m = /^(\d{1,2})?d(\d{1,4})$/.exec(t) ?? /^()(\d{1,4})$/.exec(t);
      if (!m) throw bad(DICE_HELP);
      const count = m[1] ? Number(m[1]) : 1;
      const sides = Number(m[2]);
      if (count < 1 || count > 20 || sides < 2 || sides > 1000) throw bad(DICE_HELP);
      const rolls = Array.from({ length: count }, () => randomInt(1, sides + 1));
      const total = rolls.reduce((a, b) => a + b, 0);
      return { embed: embed(`🎲 ${count > 1 ? count : ''}d${sides}`, count === 1 ? `**${total}**` : `${rolls.join(' + ')} = **${total}**`) };
    },
  },
  {
    name: 'moeda',
    group: 'Diversão',
    description: 'Cara ou coroa',
    usage: '/moeda',
    run: () => ({ embed: embed('🪙 Cara ou coroa', `Deu **${randomInt(2) ? 'cara' : 'coroa'}**!`) }),
  },
  {
    name: 'sortear',
    group: 'Diversão',
    description: 'Sorteia uma das opções (separe por vírgula)',
    usage: '/sortear pizza, hambúrguer, sushi',
    run: ({ args }) => {
      const options = [...new Set(args.split(/[,\n;]+/).map((o) => o.trim()).filter(Boolean))];
      if (options.length < 2) throw bad('Dê pelo menos 2 opções, separadas por vírgula. Ex.: /sortear pizza, sushi');
      if (options.length > 25 || options.some((o) => o.length > 60)) throw bad('No máximo 25 opções, de até 60 letras cada.');
      return { embed: embed('🎯 Sorteio', `Saiu: **${options[randomInt(options.length)]}**`, [{ name: 'Opções', value: options.join(' · ').slice(0, 200) }]) };
    },
  },
  {
    name: 'enquete',
    group: 'Utilidades',
    description: 'Cria uma enquete (separe com |)',
    usage: '/enquete Qual jogo hoje? | Valorant | CS | Minecraft',
    run: ({ args }) => {
      const [question, ...options] = args.split('|').map((x) => x.trim());
      const poll = pollSchema.safeParse({ question: question ?? '', options });
      if (!poll.success) throw bad(`${poll.error.issues[0]?.message ?? 'Enquete inválida.'} Ex.: /enquete Qual jogo hoje? | Valorant | CS`);
      return { poll: poll.data };
    },
  },
  {
    name: 'lembrar',
    group: 'Utilidades',
    description: 'Eu aviso você daqui a pouco (de 1 minuto a 7 dias)',
    usage: '/lembrar 10m tirar a pizza do forno',
    run: async ({ db, args, user, channel }) => {
      const m = /^(\d{1,3})\s*(min|m|h|d)\s+(.{1,200})$/i.exec(args.trim());
      if (!m) throw bad('Use assim: /lembrar 10m tirar a pizza do forno (m = minutos, h = horas, d = dias).');
      const unit = UNITS[m[2].toLowerCase()];
      const n = Number(m[1]);
      const ms = n * unit.ms;
      if (n < 1 || ms > 7 * 86_400_000) throw bad('O lembrete pode ser de 1 minuto a 7 dias.');
      const [pending] = await db.query<{ n: number }>('select count(*)::int as n from bot_reminders where user_id = $1 and sent_at is null', [user.id]);
      if ((pending?.n ?? 0) >= 5) throw bad('Você já tem 5 lembretes esperando. Espere algum chegar.');
      await db.query('insert into bot_reminders (id, guild_id, channel_id, user_id, text, due_at) values ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))', [
        randomUUID(),
        channel.guildId,
        channel.id,
        user.id,
        m[3].trim(),
        ms / 1000 / (Number(process.env.BOT_TIME_SCALE) || 1), // BOT_TIME_SCALE só existe nos testes (encurta o tempo)
      ]);
      remindersDirty = true;
      return { embed: embed('⏰ Lembrete criado', `Combinado, **${user.displayName}**! Eu aviso aqui em ${n} ${n === 1 ? unit.one : unit.many}: ${m[3].trim()}`) };
    },
  },
  {
    name: 'ajuda',
    group: 'Utilidades',
    description: 'Mostra os comandos do bot',
    usage: '/ajuda',
    run: ({ enabled }) => ({
      embed: embed('🤖 Comandos do Resenha Bot', 'Digite **/** no campo de mensagem para ver a lista.', enabled.map((c) => ({ name: c.usage, value: c.description }))),
    }),
  },
  ...GAME_COMMANDS,
  ...DJ_COMMANDS,
  ...TICKET_COMMANDS,
  // IA nos bots: DESLIGADA por enquanto. Para voltar, defina BOTS_AI=1 no servidor (os comandos /ia, /traduzir e /resumo reaparecem).
  ...(process.env.BOTS_AI === '1' ? AI_COMMANDS : []),
];

const commandInfo = (disabled: string[], aiEnabled = false): BotCommandInfo[] =>
  COMMANDS.map((c) => ({
    name: c.name,
    group: c.group,
    description: c.description,
    usage: c.usage,
    enabled: !disabled.includes(c.name),
    ...(c.ai ? { ai: true, locked: !aiEnabled } : {}),
  }));
const usable = (list: BotCommandInfo[]) => list.filter((c) => c.enabled && !c.locked);

interface Deps {
  channelForMember(channelId: string, userId: string): Promise<ChannelRow & { access: MemberAccess | null; slowmode?: number }>;
  emitToChannel(c: any, event: string, payload: unknown): Promise<void>;
  messageSelect: string;
}

export function registerBotRoutes(r: Router, db: Db, rt: Realtime, auth: ReturnType<typeof requireAuth>, deps: Deps) {
  const botUser = async () => (await db.query<PublicUser>(`select ${USER_COLUMNS} from users u where u.id = $1`, [BOT_ID]))[0];
  const install = async (guildId: string) =>
    (await db.query<{ disabled: string[]; config: { ticketRoleIds?: string[]; aiEnabled?: boolean } }>('select disabled_commands as disabled, config from guild_bots where guild_id = $1 and bot_id = $2', [guildId, BOT_ID]))[0];

  /** posta uma mensagem como o bot e avisa o canal */
  async function post(c: { id: string; guildId: string | null }, reply: Reply, interaction: Message['interaction'] | null, authorId: string = BOT_ID) {
    const id = randomUUID();
    await db.query('insert into messages (id, channel_id, author_id, content, mention_everyone, embeds, interaction) values ($1, $2, $3, $4, false, $5, $6)', [
      id,
      c.id,
      authorId,
      reply.content ?? '',
      reply.embed ? JSON.stringify([reply.embed]) : null,
      interaction ? JSON.stringify(interaction) : null,
    ]);
    if (reply.poll) {
      await db.query(`insert into polls (message_id, question, options, multi, ends_at) values ($1, $2, $3, $4, now() + make_interval(hours => $5))`, [
        id,
        reply.poll.question,
        JSON.stringify(reply.poll.options),
        reply.poll.multi,
        reply.poll.hours,
      ]);
    }
    const [message] = await withFileLinks(db, await db.query<Message>(`${deps.messageSelect} where msg.id = $1`, [id]));
    bump('messages');
    await deps.emitToChannel(c, 'message:new', { message });
    return message;
  }

  // bots de terceiros (token, comandos próprios): veja botApps.ts
  const apps = registerBotApps(r, db, rt, auth, {
    channelForMember: deps.channelForMember,
    post: (c, reply, interaction, authorId) => post(c, reply, interaction as Message['interaction'] | null, authorId),
    reserved: COMMANDS.map((c) => c.name),
  });

  const manage = async (userId: string, username: string, guildId: string) => {
    await requireFeature(db, username, 'bots');
    return requirePerm(db, guildId, userId, Perm.MANAGE_GUILD);
  };

  // ---------- instalar / gerenciar ----------
  r.get(
    '/guilds/:id/bots',
    auth,
    wrap(async (req) => {
      const guildId = String(req.params.id);
      await manage(req.user!.id, req.user!.username, guildId);
      const row = await install(guildId);
      return {
        bot: await botUser(),
        installed: !!row,
        commands: commandInfo(row?.disabled ?? [], !!row?.config?.aiEnabled),
        config: { ticketRoleIds: row?.config?.ticketRoleIds ?? [], aiEnabled: !!row?.config?.aiEnabled, aiAvailable: aiConfigured() },
      };
    }),
  );

  r.post(
    '/guilds/:id/bots',
    auth,
    wrap(async (req) => {
      const guildId = String(req.params.id);
      await manage(req.user!.id, req.user!.username, guildId);
      limit(`bots:${req.user!.id}`, 10, 60_000, 'Calma! Muitas mudanças seguidas.');
      if (await install(guildId)) throw new HttpError(409, 'O Resenha Bot já está neste servidor.');
      if (!(await botUser())) throw new HttpError(503, 'O bot ainda não está pronto. Tente de novo em instantes.');
      await db.query('insert into guild_bots (guild_id, bot_id, installed_by) values ($1, $2, $3)', [guildId, BOT_ID, req.user!.id]);
      // entra como membro já com as regras aceitas (senão ficaria mudo) e sem a mensagem de boas-vindas
      await db.query('insert into members (guild_id, user_id, rules_accepted_at) values ($1, $2, now()) on conflict (guild_id, user_id) do nothing', [guildId, BOT_ID]);
      const [member] = await db.query<Member>(
        `select m.joined_at as "joinedAt", m.timeout_until as "timeoutUntil", m.nick, ${USER_COLUMNS}, '{}'::text[] as "roleIds"
         from members m join users u on u.id = m.user_id where m.guild_id = $1 and m.user_id = $2`,
        [guildId, BOT_ID],
      );
      if (member) rt.emitGuild(guildId, 'member:join', { guildId, member });
      await audit(db, guildId, req.user!.id, 'bot_add', { type: 'user', id: BOT_ID, label: 'Resenha Bot' });
      return { installed: true, commands: commandInfo([], false) };
    }),
  );

  r.delete(
    '/guilds/:id/bots',
    auth,
    wrap(async (req) => {
      const guildId = String(req.params.id);
      await manage(req.user!.id, req.user!.username, guildId);
      if (!(await install(guildId))) throw new HttpError(404, 'O Resenha Bot não está neste servidor.');
      await db.query('delete from guild_bots where guild_id = $1 and bot_id = $2', [guildId, BOT_ID]);
      await db.query('delete from members where guild_id = $1 and user_id = $2', [guildId, BOT_ID]);
      await db.query('delete from bot_reminders where guild_id = $1 and sent_at is null', [guildId]);
      rt.guildChanged(guildId);
      await audit(db, guildId, req.user!.id, 'bot_remove', { type: 'user', id: BOT_ID, label: 'Resenha Bot' });
      return { installed: false };
    }),
  );

  /** liga ou desliga um comando neste servidor */
  r.patch(
    '/guilds/:id/bots/commands',
    auth,
    wrap(async (req) => {
      const guildId = String(req.params.id);
      await manage(req.user!.id, req.user!.username, guildId);
      const body = parse(z.object({ name: z.string().max(20), enabled: z.boolean() }), req.body);
      if (!COMMANDS.some((c) => c.name === body.name)) throw new HttpError(404, 'Comando não encontrado.');
      const row = await install(guildId);
      if (!row) throw new HttpError(404, 'O Resenha Bot não está neste servidor.');
      const disabled = body.enabled ? row.disabled.filter((n) => n !== body.name) : [...new Set([...row.disabled, body.name])];
      await db.query('update guild_bots set disabled_commands = $3 where guild_id = $1 and bot_id = $2', [guildId, BOT_ID, disabled]);
      return { commands: commandInfo(disabled, !!row.config?.aiEnabled) };
    }),
  );

  /** configuração do bot neste servidor: cargos que atendem tickets e a chave dos comandos de IA */
  r.patch(
    '/guilds/:id/bots/config',
    auth,
    wrap(async (req) => {
      const guildId = String(req.params.id);
      await manage(req.user!.id, req.user!.username, guildId);
      const body = parse(z.object({ ticketRoleIds: z.array(z.string().max(64)).max(20).optional(), aiEnabled: z.boolean().optional() }), req.body);
      const row = await install(guildId);
      if (!row) throw new HttpError(404, 'O Resenha Bot não está neste servidor.');
      if (body.ticketRoleIds) {
        const valid = body.ticketRoleIds.length
          ? (await db.query<{ id: string }>('select id from roles where guild_id = $1 and id = any($2)', [guildId, body.ticketRoleIds])).map((x) => x.id)
          : [];
        if (valid.length !== new Set(body.ticketRoleIds).size) throw new HttpError(400, 'Cargo inválido.');
        await db.query(`update guild_bots set config = jsonb_set(config, '{ticketRoleIds}', $3::jsonb) where guild_id = $1 and bot_id = $2`, [guildId, BOT_ID, JSON.stringify(valid)]);
        // os tickets abertos passam a ser vistos por esses cargos também
        await db.query(
          `update channels set allowed_role_ids = $2 where id in (select channel_id from tickets where guild_id = $1 and status = 'open' and channel_id is not null)`,
          [guildId, valid],
        );
        rt.guildChanged(guildId);
      }
      if (body.aiEnabled !== undefined) {
        await db.query(`update guild_bots set config = jsonb_set(config, '{aiEnabled}', $3::jsonb) where guild_id = $1 and bot_id = $2`, [guildId, BOT_ID, JSON.stringify(body.aiEnabled)]);
        await audit(db, guildId, req.user!.id, 'bot_update', { type: 'user', id: BOT_ID, label: 'Resenha Bot' }, { ai: body.aiEnabled });
      }
      const next = await install(guildId);
      return { config: { ticketRoleIds: next?.config?.ticketRoleIds ?? [], aiEnabled: !!next?.config?.aiEnabled, aiAvailable: aiConfigured() }, commands: commandInfo(next?.disabled ?? [], !!next?.config?.aiEnabled) };
    }),
  );

  // ---------- usar ----------
  /** comandos ligados neste servidor (alimenta o popup do "/" para qualquer membro) */
  r.get(
    '/guilds/:id/commands',
    auth,
    wrap(async (req) => {
      const guildId = String(req.params.id);
      await requireMember(db, guildId, req.user!.id);
      const row = await install(guildId);
      return { commands: [...(row ? usable(commandInfo(row.disabled, !!row.config?.aiEnabled)) : []), ...(await apps.commandsFor(guildId))] };
    }),
  );

  r.post(
    '/channels/:id/interactions',
    auth,
    wrap(async (req) => {
      const me = req.user!;
      const c = await deps.channelForMember(String(req.params.id), me.id);
      if (!c.guildId || !c.access || c.type !== 'text') throw bad('Os comandos do bot só funcionam em canais de texto de servidores.');
      limit(`cmd:${me.id}`, 10, 10_000, 'Calma! Muitos comandos seguidos. Espere alguns segundos.');
      requireNotTimedOut(c.access);
      const body = parse(z.object({ command: z.string().trim().toLowerCase().max(20), args: z.string().max(500).default('') }), req.body);
      const row = await install(c.guildId);
      const cmd = COMMANDS.find((x) => x.name === body.command);
      if (cmd) {
        if (!row) throw new HttpError(404, 'Este servidor não tem o Resenha Bot.');
        if (row.disabled.includes(cmd.name)) throw bad('Este comando está desligado neste servidor.');
        if (cmd.ai && !row.config?.aiEnabled) throw bad('Os comandos de IA estão desligados neste servidor. Quem administra liga em Configurações do servidor → Integrações.');
      }
      if (c.announce && !has(c.access.perms, Perm.MANAGE_GUILD) && !has(c.access.perms, Perm.MANAGE_MESSAGES)) {
        throw new HttpError(403, 'Este é um canal de avisos: só a equipe do servidor publica aqui.');
      }
      // o modo lento vale para os comandos também (a resposta é do bot, então o modo lento normal não pegaria)
      const wait = c.slowmode ?? 0;
      if (wait && !has(c.access.perms, Perm.MANAGE_MESSAGES) && !has(c.access.perms, Perm.MANAGE_CHANNELS)) {
        const [last] = await db.query<{ ago: number | null }>(
          `select extract(epoch from now() - max(created_at))::float as ago from messages where channel_id = $1 and interaction->>'userId' = $2`,
          [c.id, me.id],
        );
        if (last?.ago != null && last.ago < wait) throw new HttpError(429, `Modo lento: espere ${Math.ceil(wait - last.ago)}s para usar outro comando.`);
      }
      await checkSlowmode(db, c as any, c.access, me.id);
      const [g] = await db.query<{ code: string }>('select invite_code as code from guilds where id = $1', [c.guildId]);
      await checkAutomod(db, { guildId: c.guildId, channelName: c.name, access: c.access, userId: me.id, inviteCode: g?.code ?? '', texts: [body.args] });
      const interaction = { userId: me.id, username: me.username, displayName: me.displayName, command: body.command };
      if (!cmd) {
        // não é um comando da casa: pode ser de um bot de terceiro instalado no servidor
        const [gi] = await db.query<{ name: string }>('select name from guilds where id = $1', [c.guildId]);
        const ext = await apps.run({ guildId: c.guildId, guildName: gi?.name ?? '', channel: { id: c.id, name: c.name }, user: { id: me.id, username: me.username, displayName: me.displayName }, command: body.command, args: body.args.trim() });
        if (!ext) throw new HttpError(404, 'Comando não encontrado. Digite / para ver a lista.');
        if (!ext.reply) return { message: null }; // o bot vai responder sozinho pela API
        return { message: await apps.sendAsBot(ext.botId, c.id, ext.reply, interaction) };
      }
      const reply = await cmd.run({
        db,
        rt,
        args: body.args.trim(),
        user: me,
        channel: { id: c.id, guildId: c.guildId, name: c.name },
        postTo: async (channelId, r) => {
          const target = await loadChannel(db, channelId);
          if (target?.guildId === c.guildId) await post(target, r, null);
        },
        perms: c.access.perms,
        isOwner: c.access.isOwner,
        enabled: usable(commandInfo(row!.disabled, !!row!.config?.aiEnabled)),
        aiEnabled: !!row!.config?.aiEnabled,
      });
      const message = await post(c, reply, { userId: me.id, username: me.username, displayName: me.displayName, command: cmd.name });
      return { message };
    }),
  );

  startBotReminders(db, async (channelId, content) => {
    const c = await loadChannel(db, channelId);
    if (c?.guildId) await post(c, { content }, null);
  });
}

/** De tempos em tempos (1 min; BOT_REMINDER_TICK_MS nos testes): o bot avisa quem pediu um /lembrar. */
let remindersDirty = true;
function startBotReminders(db: Db, send: (channelId: string, content: string) => Promise<void>) {
  // Só consulta o banco quando há lembrete chegando (o Neon grátis só dorme se ninguém o consulta).
  let nextAt = Number.POSITIVE_INFINITY;
  let loaded = 0;
  const refresh = async () => {
    const [r] = await db.query<{ t: string | null }>('select min(due_at) as t from bot_reminders where sent_at is null');
    nextAt = r?.t ? new Date(r.t).getTime() : Number.POSITIVE_INFINITY;
    loaded = Date.now();
    remindersDirty = false;
  };
  const tick = async () => {
    if (remindersDirty || Date.now() - loaded > 6 * 3600_000) await refresh();
    if (nextAt > Date.now()) return;
    const due = await db.query<{ id: string; channelId: string; text: string; username: string }>(
      `update bot_reminders b set sent_at = now() from users u
       where u.id = b.user_id and b.sent_at is null and b.due_at <= now()
       returning b.id, b.channel_id as "channelId", b.text, u.username`,
    );
    for (const d of due) await send(d.channelId, `⏰ @${d.username} lembrete: ${d.text}`).catch((err) => console.warn('[bots] lembrete', err));
    await refresh();
  };
  const timer = setInterval(() => void tick().catch((err) => console.warn('[bots] lembretes', err)), Number(process.env.BOT_REMINDER_TICK_MS) || 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
