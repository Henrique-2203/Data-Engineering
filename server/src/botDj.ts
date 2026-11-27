import type { Db } from './db.ts';
import { limit } from './security.ts';
import { resolveEmbed } from './embeds.ts';
import { Perm, has } from '../../shared/permissions.ts';
import { findEmbedUrls } from '../../shared/embedUrl.ts';
import type { TogetherState } from '../../shared/types.ts';
import { bad, embed, type BotCommand, type Ctx } from './botKit.ts';

/**
 * DJ do Resenha Bot: toca música na call usando o "Assistir juntos" (o vídeo do YouTube toca igual para todo
 * mundo da call, pelo player do próprio YouTube). Os comandos só mexem na fila; ninguém baixa nem retransmite áudio.
 * Para pular, a call vota (maioria); quem colocou a música pode pular na hora.
 * A busca pelo nome usa a API do YouTube (YOUTUBE_API_KEY no Render, grátis); sem a chave, só com link.
 */
const YT_API = process.env.YOUTUBE_API_BASE || 'https://www.googleapis.com/youtube/v3';
const NEED_CALL = 'Entre num canal de voz deste servidor para usar o DJ.';

const searchCache = new Map<string, { at: number; hit: { videoId: string; title: string | null } }>();

/** Link do YouTube ou nome da música -> vídeo */
async function findVideo(db: Db, userId: string, text: string): Promise<{ videoId: string; title: string | null }> {
  const t = text.trim();
  if (!t) throw bad('Diga a música: cole o link do YouTube ou escreva o nome. Ex.: /tocar lofi hip hop');
  const url = findEmbedUrls(t, 1)[0];
  if (url) {
    const e = await resolveEmbed(url);
    if (!e) throw bad('Não consegui abrir esse link.');
    if (e.provider !== 'youtube') throw bad('O DJ toca vídeos do YouTube. Cole um link do YouTube ou escreva o nome da música.');
    return { videoId: e.id, title: e.title };
  }
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw bad('Cole o link do YouTube da música. (A busca pelo nome ainda não está ligada neste Resenha.)');
  const q = t.slice(0, 100).toLowerCase();
  const hit = searchCache.get(q);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.hit;
  limit(`djsearch:${userId}`, 8, 60_000, 'Calma! Muitas buscas seguidas. Espere um minuto.');
  const u = new URL(`${YT_API}/search`);
  u.search = new URLSearchParams({ part: 'snippet', type: 'video', maxResults: '1', videoEmbeddable: 'true', safeSearch: 'moderate', q, key }).toString();
  const res = await fetch(u, { signal: AbortSignal.timeout(6000) }).catch(() => null);
  if (!res?.ok) throw bad('A busca do YouTube não respondeu. Tente colar o link da música.');
  const j = (await res.json()) as { items?: { id?: { videoId?: string }; snippet?: { title?: string } }[] };
  const item = j.items?.[0];
  if (!item?.id?.videoId) throw bad('Não achei essa música. Tente escrever de outro jeito ou cole o link.');
  const found = { videoId: item.id.videoId, title: item.snippet?.title?.slice(0, 200) ?? null };
  searchCache.set(q, { at: Date.now(), hit: found });
  return found;
}

async function names(db: Db, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db.query<{ id: string; name: string }>('select id, display_name as name from users where id = any($1)', [[...new Set(ids)]]);
  return new Map(rows.map((r) => [r.id, r.name]));
}

const link = (id: string, title: string | null) => `[${(title ?? 'vídeo do YouTube').replace(/[[\]]/g, '')}](https://www.youtube.com/watch?v=${id})`;
const canManage = (c: Ctx) => c.isOwner || has(c.perms, Perm.MANAGE_GUILD) || has(c.perms, Perm.MOVE_MEMBERS);

function need(c: Ctx) {
  const info = c.rt.togetherOf(c.user.id, c.channel.guildId);
  if (!info) throw bad(NEED_CALL);
  return info;
}
function ok(r: { ok: boolean; error?: string }) {
  if (!r.ok) throw bad(r.error ?? 'Não deu certo.');
}

async function add(c: Ctx, front: boolean) {
  const info = need(c);
  const v = await findVideo(c.db, c.user.id, c.args);
  if (!info.state) {
    ok(c.rt.dj(c.user.id, c.channel.guildId, { action: 'play', videoId: v.videoId, title: v.title }));
    return { embed: embed('🎵 Tocando agora', `${link(v.videoId, v.title)}\nPedido por **${c.user.displayName}**. Toca para todo mundo da call (cada um pode silenciar só para si no cartão do DJ).`) };
  }
  ok(c.rt.dj(c.user.id, c.channel.guildId, { action: 'enqueue', videoId: v.videoId, title: v.title, front }));
  const pos = front ? 1 : info.state.queue.length + 1;
  return { embed: embed(front ? '⏫ Vai ser a próxima' : '➕ Na fila', `${link(v.videoId, v.title)}\n${front ? 'Toca depois da música atual.' : `Posição **${pos}** da fila.`} Pedido por **${c.user.displayName}**.`) };
}

const line = (s: Pick<TogetherState, 'videoId' | 'title'>, by?: string) => `${link(s.videoId, s.title)}${by ? ` · pedido por ${by}` : ''}`;

export const DJ_COMMANDS: BotCommand[] = [
  {
    name: 'tocar',
    group: 'DJ (música na call)',
    description: 'Toca uma música do YouTube na call (ou põe na fila)',
    usage: '/tocar lofi hip hop  ·  /tocar https://youtu.be/…',
    run: (c) => add(c, false),
  },
  {
    name: 'proxima',
    group: 'DJ (música na call)',
    description: 'Escolhe a próxima música (passa na frente da fila)',
    usage: '/proxima nome da música ou link',
    run: (c) => add(c, true),
  },
  {
    name: 'pular',
    group: 'DJ (música na call)',
    description: 'Vota para pular a música (maioria da call; quem pediu pula na hora)',
    usage: '/pular',
    run: (c) => {
      need(c);
      const r = c.rt.dj(c.user.id, c.channel.guildId, { action: 'voteskip' });
      ok(r);
      if (r.skipped) {
        const now = r.state;
        return { embed: embed('⏭️ Pulou!', now ? `Agora toca: ${line(now)}` : 'A fila acabou. Use **/tocar** para colocar outra.') };
      }
      return { embed: embed('🗳️ Voto para pular', `**${c.user.displayName}** quer pular. Votos: **${r.votes}/${r.needed}** (precisa da maioria da call).`) };
    },
  },
  {
    name: 'fila',
    group: 'DJ (música na call)',
    description: 'Mostra a música de agora e a fila',
    usage: '/fila',
    run: async (c) => {
      const { state } = need(c);
      if (!state) return { embed: embed('🎶 Fila vazia', 'Não tem nada tocando. Use **/tocar** para começar.') };
      const who = await names(c.db, [state.by, ...state.queue.map((q) => q.by)]);
      const rest = state.queue.slice(0, 10).map((q, i) => `${i + 1}. ${line(q, who.get(q.by))}`);
      return {
        embed: embed('🎶 Fila da call', `**Tocando:** ${line(state, who.get(state.by))}`, [
          { name: state.queue.length ? `Próximas (${state.queue.length})` : 'Próximas', value: rest.length ? rest.join('\n').slice(0, 900) : 'Nada na fila.' },
        ]),
      };
    },
  },
  {
    name: 'agora',
    group: 'DJ (música na call)',
    description: 'Mostra o que está tocando',
    usage: '/agora',
    run: async (c) => {
      const { state } = need(c);
      if (!state) return { embed: embed('🎧 Nada tocando', 'Use **/tocar** para começar.') };
      const who = await names(c.db, [state.by]);
      return { embed: embed('🎧 Tocando agora', `${line(state, who.get(state.by))}${state.skip ? `\nVotos para pular: ${state.skip.votes}/${state.skip.needed}` : ''}`) };
    },
  },
  {
    name: 'parar',
    group: 'DJ (música na call)',
    description: 'Para a música e limpa a fila (quem pediu a atual ou quem administra)',
    usage: '/parar',
    run: (c) => {
      const { state } = need(c);
      if (!state) throw bad('Não tem nada tocando.');
      if (state.by !== c.user.id && !canManage(c)) throw bad('Só quem pediu a música ou quem administra o servidor pode parar tudo. Use /pular para votar.');
      ok(c.rt.dj(c.user.id, c.channel.guildId, { action: 'stop' }));
      return { embed: embed('⏹️ Parou', `**${c.user.displayName}** parou a música e limpou a fila.`) };
    },
  },
  {
    name: 'remover',
    group: 'DJ (música na call)',
    description: 'Tira uma música da fila pelo número (a sua, ou qualquer uma se você administra)',
    usage: '/remover 2',
    run: (c) => {
      const { state } = need(c);
      const n = Number(c.args.trim());
      if (!state || !Number.isInteger(n) || n < 1 || n > state.queue.length) throw bad('Use o número da música na fila. Ex.: /remover 2 (veja em /fila).');
      const item = state.queue[n - 1];
      if (item.by !== c.user.id && !canManage(c)) throw bad('Você só pode tirar as músicas que você pediu.');
      ok(c.rt.dj(c.user.id, c.channel.guildId, { action: 'remove', index: n - 1 }));
      return { embed: embed('🗑️ Saiu da fila', line(item)) };
    },
  },
];
