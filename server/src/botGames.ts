import { randomInt } from 'node:crypto';
import type { Db } from './db.ts';
import { bad, embed, type BotCommand } from './botKit.ts';
import { pollSchema } from './community.ts';

/** Comandos para combinar e jogar em grupo (sem nenhum serviço externo). */

const shuffle = <T,>(list: T[]) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

async function names(db: Db, ids: string[]) {
  if (!ids.length) return [] as string[];
  const rows = await db.query<{ id: string; name: string }>('select id, display_name as name from users where id = any($1)', [ids]);
  const by = new Map(rows.map((r) => [r.id, r.name]));
  return ids.map((i) => by.get(i) ?? 'alguém');
}

const BALL = [
  'Com certeza! ✅',
  'Sem dúvida nenhuma.',
  'Pode apostar que sim.',
  'Tudo indica que sim.',
  'Os sinais apontam que sim.',
  'Talvez… pergunta de novo mais tarde.',
  'Agora não dá para dizer.',
  'Melhor não te contar agora. 🤫',
  'Concentre-se e pergunte de novo.',
  'Eu não contaria com isso.',
  'Minha resposta é não. ❌',
  'As fontes dizem que não.',
  'Muito duvidoso.',
  'Nem pensar!',
];

export const GAME_COMMANDS: BotCommand[] = [
  {
    name: 'times',
    group: 'Jogos e grupo',
    description: 'Divide a galera em times (sem nomes, usa quem está na sua call)',
    usage: '/times  ·  /times 3  ·  /times 2 Ana, Bia, Caio, Duda',
    run: async (c) => {
      let text = c.args.trim();
      let count = 2;
      const m = /^(\d{1,2})(?:\s+([\s\S]*))?$/.exec(text);
      if (m) {
        count = Number(m[1]);
        text = (m[2] ?? '').trim();
      }
      if (count < 2 || count > 10) throw bad('Escolha de 2 a 10 times. Ex.: /times 3');
      let people = text ? [...new Set(text.split(text.includes(',') || text.includes('\n') ? /[,\n]+/ : /\s+/).map((p) => p.trim()).filter(Boolean))] : [];
      if (!people.length) {
        const call = c.rt.callMembers(c.user.id, c.channel.guildId);
        if (!call) throw bad('Escreva os nomes (/times 2 Ana, Bia, Caio, Duda) ou entre numa call do servidor para dividir quem está nela.');
        people = await names(c.db, call.userIds);
      }
      if (people.length < count) throw bad(`Preciso de pelo menos ${count} pessoas para fazer ${count} times (tem ${people.length}).`);
      if (people.length > 50 || people.some((p) => p.length > 40)) throw bad('No máximo 50 nomes, de até 40 letras cada.');
      const teams: string[][] = Array.from({ length: count }, () => []);
      shuffle(people).forEach((p, i) => teams[i % count].push(p));
      return { embed: embed(`🎲 ${count} times`, `${people.length} pessoas sorteadas.`, teams.map((t, i) => ({ name: `Time ${i + 1} (${t.length})`, value: t.join(', ') }))) };
    },
  },
  {
    name: 'marcar',
    group: 'Jogos e grupo',
    description: 'Combina um horário: enquete "Vou / Talvez / Não vou"',
    usage: '/marcar hoje 20h | Valorant ranqueada',
    run: ({ args }) => {
      const [when, ...what] = args.split('|').map((x) => x.trim());
      const subject = what.join(' | ').trim();
      if (!when || !subject) throw bad('Diga quando e o quê, separados por |. Ex.: /marcar hoje 20h | Valorant ranqueada');
      const poll = pollSchema.safeParse({ question: `🎮 ${subject} · ${when}`.slice(0, 300), options: ['✅ Vou', '🤔 Talvez', '❌ Não vou'], hours: 24 });
      if (!poll.success) throw bad(poll.error.issues[0]?.message ?? 'Não deu para montar a enquete.');
      return { poll: poll.data };
    },
  },
  {
    name: 'call',
    group: 'Jogos e grupo',
    description: 'Mostra quem está em call agora neste servidor',
    usage: '/call',
    run: async (c) => {
      const states = c.rt.voiceStatesFor(c.channel.guildId, c.user.id);
      if (!states.length) return { embed: embed('🔊 Ninguém em call agora', 'Entre num canal de voz e use **/procurando** para chamar a galera.') };
      const chans = await c.db.query<{ id: string; name: string }>("select id, name from channels where guild_id = $1 and type = 'voice'", [c.channel.guildId]);
      const byChannel = new Map<string, string[]>();
      for (const s of states) byChannel.set(s.channelId, [...(byChannel.get(s.channelId) ?? []), s.userId]);
      const fields = [];
      for (const [id, users] of byChannel) {
        const who = await names(c.db, [...new Set(users)]);
        fields.push({ name: `🔊 ${chans.find((x) => x.id === id)?.name ?? 'Call'} (${who.length})`, value: who.join(', ').slice(0, 300) });
      }
      return { embed: embed('🔊 Em call agora', `${states.length} ${states.length === 1 ? 'pessoa' : 'pessoas'} no servidor.`, fields) };
    },
  },
  {
    name: 'procurando',
    group: 'Jogos e grupo',
    description: 'Chama a galera para jogar (mostra a sua call)',
    usage: '/procurando Valorant 2 vagas',
    run: (c) => {
      const text = c.args.trim();
      if (text.length < 2) throw bad('Diga o jogo. Ex.: /procurando Valorant 2 vagas');
      const call = c.rt.callMembers(c.user.id, c.channel.guildId);
      return {
        ...(call ? { content: `🎮 Entra aqui: <#${call.channelId}>` } : {}),
        embed: embed('🎮 Procurando galera', `**${c.user.displayName}** quer jogar **${text.slice(0, 120)}**.${call ? '' : '\nEntre num canal de voz e combine por aqui.'}`),
      };
    },
  },
  {
    name: '8bola',
    group: 'Diversão',
    description: 'A bola 8 mágica responde sua pergunta',
    usage: '/8bola vamos ganhar hoje?',
    run: ({ args }) => {
      const q = args.trim();
      if (q.length < 3) throw bad('Faça uma pergunta. Ex.: /8bola vamos ganhar hoje?');
      return { embed: embed('🎱 Bola 8', `**${q.slice(0, 200)}**\n${BALL[randomInt(BALL.length)]}`) };
    },
  },
];
