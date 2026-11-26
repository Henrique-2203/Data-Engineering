import { randomInt } from 'node:crypto';
import type { Router } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';
import { config } from './config.ts';
import { HttpError, parse, wrap } from './http.ts';
import { limit } from './security.ts';
import type { requireAuth } from './auth.ts';
import { sendPush } from './push.ts';
import { isPlatformAdmin } from './reports.ts';
import { USER_COLUMNS } from './auth.ts';
import type { PublicUser } from '../../shared/types.ts';

/**
 * "Apoie o Resenha": apoio voluntário por Pix (valor livre, a partir do mínimo), até uma data limite.
 * Quem apoia ganha o selo "Apoiador Fundador" e mais nada (nenhuma função extra). Nomes e o valor de cada
 * pessoa ficam só com a equipe. O TOTAL do mês (soma dos apoios confirmados no mês) aparece para todos numa
 * barra de meta, se a equipe deixar ligado (showMonthly), para todo mundo saber quanto falta para pagar os servidores.
 *
 * Card "depois de gostar": só aparece para quem já usa o Resenha de verdade (conta com alguns dias e
 * mensagens enviadas ou calls), no máximo uma vez por mês, e some ao fechar. Ninguém vê pedido no 1º dia.
 *
 * Como funciona: a pessoa (logada) abre a janela e vê o QR Code + Pix copia e cola, com um código
 * dela (RSN-XXXX) que vai junto no Pix; faz o Pix e clica "Já fiz o Pix". A equipe confere no extrato
 * do banco e confirma no painel; o selo aparece na hora. Não passa por empresa de pagamento: o Pix
 * cai direto na chave configurada (chave aleatória, para não expor CPF/telefone/e-mail).
 */
export interface ApoioSettings {
  enabled: boolean;
  /** chave Pix (de preferência a aleatória) */
  pixKey: string;
  /** nome de quem recebe, como no banco (vai no QR, até 25 letras) */
  name: string;
  /** cidade de quem recebe (vai no QR, até 15 letras) */
  city: string;
  /** último dia para apoiar e ganhar o selo (AAAA-MM-DD, até 23:59 de Brasília) */
  deadline: string;
  minCents: number;
  /** meta para considerar que a campanha deu certo (só a equipe vê) */
  goalSupporters: number;
  goalCents: number;
  /** meta do mês, mostrada para todos na barra (o custo dos servidores) */
  monthlyGoalCents: number;
  /** mostrar a barra com o total do mês para todos (sem nomes) */
  showMonthly: boolean;
}
export const APOIO_DEFAULT: ApoioSettings = {
  enabled: false,
  pixKey: '',
  name: '',
  city: '',
  deadline: '2026-12-17',
  minCents: 500,
  goalSupporters: 10,
  goalCents: 10_000,
  monthlyGoalCents: 10_000,
  showMonthly: true,
};

/** mês atual em Brasília: "AAAA-MM" e o instante em que ele começou */
export function currentMonth(now = new Date()) {
  const br = new Date(now.getTime() - 3 * 3600_000);
  const key = `${br.getUTCFullYear()}-${String(br.getUTCMonth() + 1).padStart(2, '0')}`;
  return { key, start: new Date(`${key}-01T00:00:00-03:00`) };
}
/** soma dos apoios confirmados neste mês (o valor que a equipe anotou ao confirmar) */
export async function monthTotalCents(db: Db, now = new Date()) {
  const [{ cents }] = await db.query<{ cents: number }>(
    `select coalesce(sum(amount_cents), 0)::int as cents from supporters where status = 'confirmed' and confirmed_at >= $1`,
    [currentMonth(now).start],
  );
  return cents;
}
// quem já usa de verdade: conta com alguns dias E (mensagens enviadas OU calls)
const CARD_MIN_DAYS = Number(process.env.APOIO_CARD_MIN_DAYS ?? 5); // os testes usam 0
const CARD_MIN_MESSAGES = 15;
const CARD_MIN_CALLS = 3;

export async function getApoio(db: Db): Promise<ApoioSettings> {
  const [row] = await db.query<{ value: Partial<ApoioSettings> }>(`select value from app_settings where name = 'apoio'`);
  return { ...APOIO_DEFAULT, ...(row?.value ?? {}) };
}
/** termina às 23:59:59 de Brasília do dia limite */
export const deadlineEnd = (d: string) => new Date(`${d}T23:59:59-03:00`);
const isOpen = (s: ApoioSettings, now = new Date()) => s.enabled && !!s.pixKey && !!s.name && !!s.city && now <= deadlineEnd(s.deadline);

// ---------------- Pix "copia e cola" (BR Code, padrão EMV do Banco Central) ----------------

const field = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`;
/** só letras sem acento, números e espaço (alguns bancos recusam acento no nome/cidade) */
const plain = (s: string, max: number) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .trim()
    .slice(0, max)
    .toUpperCase();
export function crc16(s: string) {
  let crc = 0xffff;
  for (const b of Buffer.from(s, 'utf8')) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
/** Pix sem valor fixo (a pessoa digita quanto quer dar), com o código dela como identificador */
export function pixPayload(s: ApoioSettings, code: string) {
  const account = field('00', 'br.gov.bcb.pix') + field('01', s.pixKey.trim()) + field('02', `Apoio Resenha ${code}`);
  const body =
    field('00', '01') +
    field('01', '11') + // QR que pode ser usado várias vezes
    field('26', account) +
    field('52', '0000') +
    field('53', '986') + // real
    field('58', 'BR') +
    field('59', plain(s.name, 25)) +
    field('60', plain(s.city, 15)) +
    field('62', field('05', code.replace(/[^A-Z0-9]/g, '').slice(0, 25))) +
    '6304';
  return body + crc16(body);
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O, 1/I
const newCode = () => `RSN-${Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`;

type Row = { code: string; status: 'none' | 'pending' | 'confirmed' | 'rejected'; showBadge: boolean; ring: string | null };

export function registerApoioRoutes(r: Router, db: Db, rt: Realtime, auth: ReturnType<typeof requireAuth>) {
  const requireAdmin = (username: string | undefined) => {
    if (!isPlatformAdmin(username)) throw new HttpError(404, 'Rota não encontrada.');
  };
  const mine = async (userId: string, create: boolean): Promise<Row | null> => {
    const get = async () =>
      (
        await db.query<Row>(
          `select s.code, s.status, s.show_badge as "showBadge", coalesce(u.founder_ring, 'raiz') as ring
           from supporters s join users u on u.id = s.user_id where s.user_id = $1`,
          [userId],
        )
      )[0] ?? null;
    let row = await get();
    for (let i = 0; !row && create && i < 5; i++) {
      await db.query('insert into supporters (user_id, code) values ($1, $2) on conflict do nothing', [userId, newCode()]).catch(() => {});
      row = await get();
    }
    return row;
  };

  // ---------- quem apoia ----------
  r.get(
    '/apoio',
    auth,
    wrap(async (req) => {
      const s = await getApoio(db);
      const open = isOpen(s);
      const row = await mine(req.user!.id, open);
      const payload = open && row ? pixPayload(s, row.code) : null;
      const uid = req.user!.id;
      const month = currentMonth();
      const monthly = s.showMonthly ? { cents: await monthTotalCents(db), goalCents: s.monthlyGoalCents } : null;
      // o card: só se o apoio está aberto, a pessoa ainda não apoiou, não viu o card este mês e já usa o Resenha
      let card = false;
      if (open && (!row || row.status === 'none' || row.status === 'rejected')) {
        const [u] = await db.query<{ seen: string | null; days: number; msgs: number }>(
          `select u.apoio_card_month as seen, extract(epoch from now() - u.created_at)::float / 86400 as days,
             (select count(*)::int from (select 1 from messages m where m.author_id = u.id limit ${CARD_MIN_MESSAGES}) x) as msgs
           from users u where u.id = $1`,
          [uid],
        );
        const calls = Math.max(0, Math.min(1000, Number(req.query.calls) || 0)); // contado no aparelho (só decide se mostra um card)
        card = !!u && u.seen !== month.key && u.days >= CARD_MIN_DAYS && (u.msgs >= CARD_MIN_MESSAGES || calls >= CARD_MIN_CALLS);
      }
      return {
        open,
        card,
        monthly,
        deadline: s.deadline,
        minCents: s.minCents,
        me: row ? { code: row.code, status: row.status, showBadge: row.showBadge, ring: row.status === 'confirmed' ? row.ring : null } : null,
        pix: payload
          ? {
              payload,
              qrSvg: await QRCode.toString(payload, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#ffffff' } }),
              receiver: plain(s.name, 25),
            }
          : null,
      };
    }),
  );

  /** fechou ou abriu o card: não aparece de novo até o mês que vem (vale em todos os aparelhos) */
  r.post(
    '/apoio/card-seen',
    auth,
    wrap(async (req) => {
      await db.query('update users set apoio_card_month = $2 where id = $1', [req.user!.id, currentMonth().key]);
      return { ok: true };
    }),
  );

  /** "Já fiz o Pix": entra na lista da equipe para conferir */
  r.post(
    '/apoio/claim',
    auth,
    wrap(async (req) => {
      const uid = req.user!.id;
      limit(`apoio:${uid}`, 10, 24 * 60 * 60_000, 'Muitas tentativas hoje. Se já fez o Pix, aguarde a equipe conferir.');
      const s = await getApoio(db);
      if (!isOpen(s)) throw new HttpError(400, 'O apoio com o selo de Fundador já foi encerrado. Obrigado pelo carinho! 💚');
      const row = await mine(uid, true);
      if (!row) throw new HttpError(500, 'Tente de novo.');
      if (row.status === 'confirmed') return { status: 'confirmed' };
      await db.query(`update supporters set status = 'pending', claimed_at = now() where user_id = $1`, [uid]);
      await notifyAdmins();
      return { status: 'pending' };
    }),
  );

  /** mostrar ou esconder o selo no perfil */
  r.post(
    '/apoio/badge',
    auth,
    wrap(async (req) => {
      const { show } = parse(z.object({ show: z.boolean() }), req.body);
      await db.query('update supporters set show_badge = $2 where user_id = $1', [req.user!.id, show]);
      return { showBadge: show };
    }),
  );

  /** escolher o anel de Fundador (ou nenhum). Só quem teve o apoio confirmado. */
  r.post(
    '/apoio/ring',
    auth,
    wrap(async (req) => {
      const { ring } = parse(z.object({ ring: z.enum(['raiz', 'aurora', 'selo', 'none']) }), req.body);
      const uid = req.user!.id;
      const row = await mine(uid, false);
      if (row?.status !== 'confirmed') throw new HttpError(403, 'Os anéis de Fundador são de quem teve o apoio confirmado pela equipe.');
      await db.query('update users set founder_ring = $2 where id = $1', [uid, ring]);
      const user = await broadcastUser(uid);
      return { ring, user };
    }),
  );

  /** todo mundo vê o anel aparecer (ou sumir) na hora: chat, membros, perfil e call */
  const broadcastUser = async (userId: string) => {
    const [user] = await db.query<PublicUser>(`select ${USER_COLUMNS} from users u where u.id = $1`, [userId]);
    if (user) void rt.emitRelated(user.id, 'user:update', user);
    return user ?? null;
  };

  // ---------- equipe ----------
  const notifyAdmins = async () => {
    const [{ n }] = await db.query<{ n: number }>(`select count(*)::int as n from supporters where status = 'pending'`);
    if (!config.platformAdmins.length) return;
    const admins = await db.query<{ id: string }>('select id from users where username = any($1)', [config.platformAdmins]);
    for (const a of admins) rt.emitUser(a.id, 'apoio:count', { pending: n });
  };

  r.get(
    '/admin/apoio',
    auth,
    wrap(async (req) => {
      requireAdmin(req.user!.username);
      const settings = await getApoio(db);
      const supporters = await db.query(
        `select s.user_id as "userId", u.username, u.display_name as "displayName", s.code, s.status,
           s.claimed_at as "claimedAt", s.confirmed_at as "confirmedAt", s.amount_cents as "amountCents"
         from supporters s join users u on u.id = s.user_id
         where s.status <> 'none'
         order by case s.status when 'pending' then 0 when 'confirmed' then 1 else 2 end, coalesce(s.claimed_at, s.created_at) desc`,
      );
      const monthCents = await monthTotalCents(db);
      const [totals] = await db.query<{ confirmed: number; pending: number; cents: number }>(
        `select count(*) filter (where status = 'confirmed')::int as confirmed,
                count(*) filter (where status = 'pending')::int as pending,
                coalesce(sum(amount_cents) filter (where status = 'confirmed'), 0)::int as cents
         from supporters`,
      );
      return { settings, open: isOpen(settings), supporters, totals: { ...totals, monthCents } };
    }),
  );

  r.put(
    '/admin/apoio',
    auth,
    wrap(async (req) => {
      requireAdmin(req.user!.username);
      const b = parse(
        z.object({
          enabled: z.boolean(),
          pixKey: z.string().trim().max(77, 'Chave Pix grande demais.'),
          name: z.string().trim().max(60),
          city: z.string().trim().max(40),
          deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.'),
          minCents: z.number().int().min(100).max(100_000),
          goalSupporters: z.number().int().min(1).max(100_000),
          goalCents: z.number().int().min(100).max(100_000_000),
          monthlyGoalCents: z.number().int().min(100).max(100_000_000).default(APOIO_DEFAULT.monthlyGoalCents),
          showMonthly: z.boolean().default(APOIO_DEFAULT.showMonthly),
        }),
        req.body,
      );
      if (b.enabled && (!b.pixKey || !plain(b.name, 25) || !plain(b.city, 15))) throw new HttpError(400, 'Para ligar, preencha a chave Pix, o nome e a cidade de quem recebe.');
      await db.query(
        `insert into app_settings (name, value, updated_at) values ('apoio', $1, now())
         on conflict (name) do update set value = excluded.value, updated_at = now()`,
        [JSON.stringify(b)],
      );
      // quem está com o Resenha aberto vê o botão aparecer (ou sumir) na hora, sem recarregar
      rt.io.emit('apoio:changed', {});
      return { settings: b, open: isOpen(b) };
    }),
  );

  r.post(
    '/admin/apoio/:userId/confirm',
    auth,
    wrap(async (req) => {
      requireAdmin(req.user!.username);
      const { amountCents } = parse(z.object({ amountCents: z.number().int().min(0).max(100_000_000).nullable().optional() }), req.body ?? {});
      const userId = String(req.params.userId);
      const [row] = await db.query<{ userId: string }>(
        `update supporters set status = 'confirmed', confirmed_at = now(), confirmed_by = $2, amount_cents = $3
         where user_id = $1 returning user_id as "userId"`,
        [userId, req.user!.username, amountCents ?? null],
      );
      if (!row) throw new HttpError(404, 'Apoio não encontrado.');
      rt.emitUser(userId, 'apoio:update', { status: 'confirmed' });
      await broadcastUser(userId);
      await sendPush(db, [userId], { title: 'Seu selo chegou 💚', body: 'Obrigado por apoiar o Resenha! Agora você é Apoiador Fundador.', tag: 'apoio' }, { onlyAway: rt }).catch(() => {});
      await notifyAdmins();
      return { ok: true };
    }),
  );

  r.post(
    '/admin/apoio/:userId/reject',
    auth,
    wrap(async (req) => {
      requireAdmin(req.user!.username);
      const userId = String(req.params.userId);
      await db.query(`update supporters set status = 'rejected', confirmed_at = null, amount_cents = null where user_id = $1`, [userId]);
      rt.emitUser(userId, 'apoio:update', { status: 'rejected' });
      await broadcastUser(userId);
      await notifyAdmins();
      return { ok: true };
    }),
  );
}

/** o selo aparece no perfil de quem teve o apoio confirmado (e não escondeu) */
export async function isSupporter(db: Db, userId: string) {
  const [row] = await db.query<{ ok: boolean }>(`select true as ok from supporters where user_id = $1 and status = 'confirmed' and show_badge`, [userId]);
  return !!row;
}
