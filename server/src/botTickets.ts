import { randomUUID } from 'node:crypto';
import type { Db } from './db.ts';
import { channelAudience, memberRoleIds } from './access.ts';
import { audit } from './audit.ts';
import { sendPush } from './push.ts';
import { Perm, has } from '../../shared/permissions.ts';
import { bad, embed, type BotCommand, type Ctx } from './botKit.ts';

/**
 * Tickets de ajuda do servidor (Resenha Bot). /ticket abrir cria um canal PRIVADO que só enxerga quem abriu,
 * o dono, os administradores e os cargos que o servidor escolher em Integrações. /ticket fechar encerra
 * (o canal fica só para a equipe, que pode apagar quando quiser).
 */
const USAGE = 'Use: /ticket abrir (assunto) · /ticket fechar (motivo) · /ticket adicionar @pessoa · /ticket lista';
const MAX_OPEN_PER_PERSON = 2;
const MAX_OPEN_PER_GUILD = 100;

interface Ticket {
  id: string;
  number: number;
  channelId: string;
  openerId: string;
  subject: string;
  status: string;
}

/** cargos que atendem os tickets além do dono e dos administradores (config da instalação do bot) */
export async function ticketRoleIds(db: Db, guildId: string): Promise<string[]> {
  const [row] = await db.query<{ config: { ticketRoleIds?: string[] } }>("select config from guild_bots where guild_id = $1 and bot_id = 'bot_resenha'", [guildId]);
  return row?.config?.ticketRoleIds ?? [];
}

/** dono, administradores, quem gerencia o servidor ou tem um cargo de atendimento */
async function isStaff(c: Ctx) {
  if (c.isOwner || has(c.perms, Perm.ADMIN) || has(c.perms, Perm.MANAGE_GUILD)) return true;
  const roles = await ticketRoleIds(c.db, c.channel.guildId);
  if (!roles.length) return false;
  const mine = await memberRoleIds(c.db, c.channel.guildId, c.user.id);
  return mine.some((r) => roles.includes(r));
}

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'pessoa';

async function ticketHere(c: Ctx): Promise<Ticket | null> {
  const [t] = await c.db.query<Ticket>(
    `select id, number, channel_id as "channelId", opener_id as "openerId", subject, status from tickets where guild_id = $1 and channel_id = $2`,
    [c.channel.guildId, c.channel.id],
  );
  return t ?? null;
}

async function open(c: Ctx, subject: string) {
  if (subject.length < 3) throw bad('Conte em poucas palavras o que você precisa. Ex.: /ticket abrir Não consigo entrar na call');
  if (subject.length > 150) throw bad('O assunto pode ter até 150 letras. Conte o resto dentro do ticket.');
  const g = c.channel.guildId;
  const [mine] = await c.db.query<{ n: number }>("select count(*)::int as n from tickets where guild_id = $1 and opener_id = $2 and status = 'open'", [g, c.user.id]);
  if ((mine?.n ?? 0) >= MAX_OPEN_PER_PERSON) throw bad(`Você já tem ${MAX_OPEN_PER_PERSON} tickets abertos. Feche um antes de abrir outro (/ticket fechar).`);
  const [all] = await c.db.query<{ n: number }>("select count(*)::int as n from tickets where guild_id = $1 and status = 'open'", [g]);
  if ((all?.n ?? 0) >= MAX_OPEN_PER_GUILD) throw bad('Este servidor já tem muitos tickets abertos. Chame a equipe por outro canal.');

  const roles = await ticketRoleIds(c.db, g);
  const [num] = await c.db.query<{ n: number }>('select coalesce(max(number), 0)::int + 1 as n from tickets where guild_id = $1', [g]);
  const number = num.n;
  // categoria "Tickets" (criada na primeira vez) para não bagunçar a lista de canais
  let [cat] = await c.db.query<{ id: string }>("select id from categories where guild_id = $1 and name = 'Tickets' limit 1", [g]);
  if (!cat) {
    cat = { id: randomUUID() };
    await c.db.query("insert into categories (id, guild_id, name, position) values ($1, $2, 'Tickets', coalesce((select max(position) + 1 from categories where guild_id = $2), 0))", [cat.id, g]);
  }
  const channelId = randomUUID();
  const name = `ticket-${number}-${slug(c.user.username)}`;
  await c.db.query(
    `insert into channels (id, guild_id, name, type, position, category_id, allowed_role_ids, allowed_user_ids)
     values ($1, $2, $3, 'text', coalesce((select max(position) + 1 from channels where guild_id = $2), 0), $4, $5, $6)`,
    [channelId, g, name, cat.id, roles, [c.user.id]],
  );
  const ticketId = randomUUID();
  await c.db.query('insert into tickets (id, guild_id, channel_id, number, opener_id, subject) values ($1, $2, $3, $4, $5, $6)', [ticketId, g, channelId, number, c.user.id, subject]);
  await audit(c.db, g, c.user.id, 'channel_create', { type: 'channel', id: channelId, label: name }, { ticket: number });
  c.rt.guildChanged(g);
  await c.postTo(channelId, {
    embed: embed(`🎫 Ticket #${number}`, `**Assunto:** ${subject}\nAberto por **${c.user.displayName}**.`, [
      {
        name: 'Como funciona',
        value: 'Só você, o dono e a equipe do servidor veem este canal. Explique o que precisa e espere a resposta aqui. Para encerrar: /ticket fechar. Para chamar mais alguém: /ticket adicionar @pessoa.',
      },
    ]),
  });
  // avisa a equipe no celular (quem está com o Resenha aberto já vê o canal novo)
  const channel = { guildId: g, allowedRoleIds: roles, allowedUserIds: [c.user.id] };
  const staff = ((await channelAudience(c.db, channel)) ?? []).filter((id) => id !== c.user.id);
  void sendPush(c.db, staff, { title: `Novo ticket #${number}`, body: `${c.user.displayName}: ${subject}`.slice(0, 120), channelId, guildId: g, tag: `ticket:${ticketId}` }, { onlyAway: c.rt }).catch(() => {});
  return { content: `🎫 Ticket **#${number}** aberto: <#${channelId}>`, embed: embed('Ticket aberto', `**${c.user.displayName}**, a equipe do servidor vai te atender no canal do ticket.`) };
}

async function close(c: Ctx, reason: string) {
  const t = await ticketHere(c);
  if (!t || t.status !== 'open') throw bad('Use este comando dentro de um canal de ticket aberto.');
  if (t.openerId !== c.user.id && !(await isStaff(c))) throw bad('Só quem abriu o ticket ou a equipe do servidor pode fechar.');
  await c.db.query("update tickets set status = 'closed', closed_at = now(), closed_by = $2 where id = $1", [t.id, c.user.id]);
  // quem abriu perde o acesso; a equipe continua vendo (e pode apagar o canal quando quiser)
  await c.db.query("update channels set allowed_user_ids = '{}', name = $2 where id = $1", [t.channelId, `fechado-${t.number}`]);
  c.rt.guildChanged(c.channel.guildId);
  return { embed: embed(`✅ Ticket #${t.number} fechado`, `Fechado por **${c.user.displayName}**.${reason ? `\n**Motivo:** ${reason.slice(0, 300)}` : ''}\nQuem abriu não vê mais este canal. A equipe pode apagá-lo em Configurações do canal.`) };
}

async function add(c: Ctx, who: string) {
  const t = await ticketHere(c);
  if (!t || t.status !== 'open') throw bad('Use este comando dentro de um canal de ticket aberto.');
  if (t.openerId !== c.user.id && !(await isStaff(c))) throw bad('Só quem abriu o ticket ou a equipe pode chamar mais alguém.');
  const username = who.trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_.]{2,32}$/.test(username)) throw bad('Diga quem chamar. Ex.: /ticket adicionar @amigo');
  const [u] = await c.db.query<{ id: string; displayName: string }>(
    `select u.id, u.display_name as "displayName" from users u join members m on m.user_id = u.id and m.guild_id = $2 where u.username = $1 and not u.is_bot`,
    [username, c.channel.guildId],
  );
  if (!u) throw bad(`@${username} não está neste servidor.`);
  await c.db.query('update channels set allowed_user_ids = array_append(allowed_user_ids, $2) where id = $1 and not coalesce($2 = any(allowed_user_ids), false)', [t.channelId, u.id]);
  c.rt.guildChanged(c.channel.guildId);
  return { embed: embed('➕ Pessoa adicionada', `**${u.displayName}** (@${username}) agora vê este ticket.`) };
}

async function list(c: Ctx) {
  if (!(await isStaff(c))) throw bad('Só a equipe do servidor (dono, administradores e cargos de atendimento) vê a lista.');
  const rows = await c.db.query<{ number: number; subject: string; channelId: string; name: string }>(
    `select t.number, t.subject, t.channel_id as "channelId", u.display_name as name from tickets t join users u on u.id = t.opener_id
     where t.guild_id = $1 and t.status = 'open' order by t.number limit 15`,
    [c.channel.guildId],
  );
  if (!rows.length) return { embed: embed('🎫 Tickets abertos', 'Nenhum ticket aberto agora. 🎉') };
  return { embed: embed(`🎫 Tickets abertos (${rows.length})`, rows.map((r) => `**#${r.number}** · ${r.name} · ${r.subject}`).join('\n').slice(0, 1500)), content: rows.map((r) => `<#${r.channelId}>`).join(' ') };
}

export const TICKET_COMMANDS: BotCommand[] = [
  {
    name: 'ticket',
    group: 'Tickets de ajuda',
    description: 'Abre um ticket de ajuda: um canal privado com o dono e os administradores',
    usage: '/ticket abrir Preciso de ajuda com…  ·  /ticket fechar  ·  /ticket adicionar @pessoa  ·  /ticket lista',
    run: async (c) => {
      const text = c.args.trim();
      const sub = (text.split(/\s+/)[0] ?? '').toLowerCase();
      const rest = text.slice(sub.length).trim();
      if (sub === 'abrir') return open(c, rest);
      if (sub === 'fechar') return close(c, rest);
      if (sub === 'adicionar') return add(c, rest);
      if (sub === 'lista') return list(c);
      throw bad(USAGE);
    },
  },
];
