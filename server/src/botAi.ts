import { askAi } from './ai.ts';
import { limit } from './security.ts';
import { bad, embed, type BotCommand, type Ctx } from './botKit.ts';

/**
 * Comandos de IA do Resenha Bot: /ia, /traduzir e /resumo. Só funcionam depois que o servidor liga a IA em
 * Integrações (o texto vai para um serviço externo) e respeitam os limites de uso e de gasto de ai.ts.
 * Nada de mensagem privada: só canais de texto de servidor, e o /resumo só lê o que a pessoa já consegue ler.
 */
const BOT = 'bot_resenha';
const OFF = 'Os comandos de IA estão desligados neste servidor. Quem administra liga em Configurações do servidor → Integrações.';

const run = (c: Ctx, system: string, prompt: string, maxTokens: number) =>
  askAi({ db: c.db, userId: c.user.id, guildId: c.channel.guildId, system, prompt, maxTokens });

const gate = (c: Ctx) => {
  if (!c.aiEnabled) throw bad(OFF);
};

export const AI_COMMANDS: BotCommand[] = [
  {
    name: 'ia',
    group: 'IA (usa um serviço externo)',
    ai: true,
    description: 'Pergunte qualquer coisa para a IA (respostas curtas)',
    usage: '/ia qual a diferença entre RAM e SSD?',
    run: async (c) => {
      gate(c);
      const q = c.args.trim();
      if (q.length < 3) throw bad('Escreva a pergunta. Ex.: /ia qual a diferença entre RAM e SSD?');
      const answer = await run(
        c,
        'Você é o Resenha Bot, o assistente de um servidor de chat entre amigos brasileiros. Responda em português do Brasil, em no máximo 6 linhas, de forma clara e direta, no tom de uma conversa entre amigos. ' +
          'Não peça nem repita dados pessoais. Se o pedido for perigoso, ilegal ou ofensivo, recuse com educação em uma frase.',
        q,
        400,
      );
      return { embed: embed('🤖 Resposta', `**Pergunta:** ${q.slice(0, 300)}\n\n${answer}`) };
    },
  },
  {
    name: 'traduzir',
    group: 'IA (usa um serviço externo)',
    ai: true,
    description: 'Traduz um texto (sem texto, traduz a última mensagem do canal)',
    usage: '/traduzir en Bom dia, pessoal  ·  /traduzir pt (traduz a última mensagem)',
    run: async (c) => {
      gate(c);
      const m = /^(\S{2,20})(?:\s+([\s\S]+))?$/.exec(c.args.trim());
      if (!m) throw bad('Diga o idioma e o texto. Ex.: /traduzir en Bom dia · ou só /traduzir pt para traduzir a última mensagem do canal.');
      const lang = m[1];
      let text = (m[2] ?? '').trim();
      let from = '';
      if (!text) {
        const [last] = await c.db.query<{ content: string; name: string }>(
          `select m.content, u.display_name as name from messages m join users u on u.id = m.author_id
           where m.channel_id = $1 and m.system is null and m.author_id <> $2 and m.content <> '' order by m.created_at desc limit 1`,
          [c.channel.id, BOT],
        );
        if (!last) throw bad('Não achei nenhuma mensagem para traduzir neste canal.');
        text = last.content;
        from = last.name;
      }
      text = text.slice(0, 1500);
      const out = await run(
        c,
        `Traduza o texto para o idioma pedido pelo usuário: "${lang.replace(/["\n]/g, '').slice(0, 20)}" (pode vir como nome ou código, em qualquer idioma). ` +
          'Devolva SOMENTE a tradução, fiel ao tom e às gírias, sem explicações. Se o idioma pedido não existir, responda apenas: IDIOMA_INVALIDO',
        text,
        500,
      );
      if (/^IDIOMA_INVALIDO/.test(out)) throw bad(`Não conheço o idioma "${lang}". Tente assim: /traduzir en, /traduzir es, /traduzir pt…`);
      return { embed: embed(`🌐 Tradução (${lang})`, `${from ? `**${from} disse:** ${text.slice(0, 300)}\n\n` : ''}${out}`) };
    },
  },
  {
    name: 'resumo',
    group: 'IA (usa um serviço externo)',
    ai: true,
    description: 'Resume as últimas mensagens deste canal (10 a 100)',
    usage: '/resumo  ·  /resumo 80',
    run: async (c) => {
      gate(c);
      const n = c.args.trim() ? Number(c.args.trim()) : 50;
      if (!Number.isInteger(n) || n < 10 || n > 100) throw bad('Diga quantas mensagens resumir, de 10 a 100. Ex.: /resumo 60');
      limit(`resumo:${c.channel.id}`, 1, 90_000, 'Já resumi este canal há pouco. Espere um pouquinho.');
      const rows = await c.db.query<{ content: string; name: string; at: string }>(
        `select m.content, u.display_name as name, to_char(m.created_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as at
         from messages m join users u on u.id = m.author_id
         where m.channel_id = $1 and m.system is null and m.author_id <> $2 and m.content <> ''
         order by m.created_at desc limit $3`,
        [c.channel.id, BOT, n],
      );
      if (rows.length < 3) throw bad('Tem pouca conversa para resumir.');
      // mais antigas primeiro; corta o total para o custo não explodir (descarta as mais antigas)
      let total = 0;
      const lines: string[] = [];
      for (const r of rows) {
        const line = `[${r.at}] ${r.name}: ${r.content.replace(/\s+/g, ' ').slice(0, 280)}`;
        if (total + line.length > 12_000) break;
        total += line.length;
        lines.unshift(line);
      }
      const out = await run(
        c,
        'Você resume conversas de um chat entre amigos brasileiros. Escreva em português do Brasil, em tópicos curtos: assuntos principais, decisões ou combinados, e perguntas que ficaram sem resposta. ' +
          'No máximo 8 tópicos. Não invente nada que não esteja na conversa e não copie dados pessoais (telefones, e-mails, endereços).',
        lines.join('\n'),
        600,
      );
      return { embed: embed(`📝 Resumo das últimas ${lines.length} mensagens`, out) };
    },
  },
];
