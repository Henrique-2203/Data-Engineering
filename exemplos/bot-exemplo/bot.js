import { createHmac, timingSafeEqual } from 'node:crypto';
import express from 'express';

/**
 * Bot de exemplo para o Resenha. Mostra os 3 jeitos de um bot agir:
 *  1. RESPONDER a comandos "/" (o Resenha chama POST /resenha e este código responde na hora)
 *  2. MANDAR AVISOS sozinho (POST na API do Resenha com o token do bot)
 *  3. USAR serviços da internet (o /clima consulta a previsão do tempo)
 * Tudo que o bot precisa vem de variáveis de ambiente (nunca escreva o token no código):
 *   BOT_TOKEN       o token do bot (Configurações → Desenvolvedor)
 *   SIGNING_SECRET  o segredo de assinatura do bot (mesmo lugar)
 *   ADMIN_KEY       uma senha que VOCÊ inventa, para abrir o /painel deste bot
 *   RESENHA_URL     (opcional) endereço do Resenha; o padrão é https://resenhabr.com.br
 */

// ------------------------------------------------------------------ os comandos
const PIADAS = [
  'Por que o computador foi ao médico? Porque estava com um vírus!',
  'O que o pato disse para a pata? Vem Quá!',
  'Qual é o cúmulo da rapidez? Fechar a porta de vaivém sem bater.',
  'Por que o jogador de FPS nunca conta segredos? Porque as paredes têm... wallhack.',
  'O que um servidor falou para o outro? "Nossa, que lag entre a gente."',
];

const WMO = { 0: 'céu limpo', 1: 'quase limpo', 2: 'parcialmente nublado', 3: 'nublado', 45: 'neblina', 51: 'garoa', 61: 'chuva fraca', 63: 'chuva', 65: 'chuva forte', 80: 'pancadas de chuva', 95: 'tempestade' };

/** cada comando recebe o texto digitado e quem usou, e devolve { content } e/ou { embed } */
export const COMANDOS = [
  { name: 'ping', description: 'Responde pong (teste rápido)', usage: '/ping', run: ({ user }) => ({ content: `pong 🏓 (olá, ${user?.displayName ?? 'amigo'}!)` }) },
  { name: 'eco', description: 'Repete o que você disser', usage: '/eco qualquer texto', run: ({ args }) => ({ content: args.slice(0, 300) || 'Diga algo depois do /eco 🙂' }) },
  {
    name: 'hora',
    description: 'Mostra a hora certa em Brasília',
    usage: '/hora',
    run: () => ({
      embed: { title: '🕒 Hora certa', description: `**${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full', timeStyle: 'short' })}** (Brasília)`, color: '#7c6cff' },
    }),
  },
  { name: 'piada', description: 'Conta uma piada', usage: '/piada', run: () => ({ content: PIADAS[Math.floor(Math.random() * PIADAS.length)] }) },
  {
    name: 'clima',
    description: 'Previsão do tempo de uma cidade',
    usage: '/clima São Paulo',
    // usa um serviço da internet (grátis, sem chave). O Resenha espera só 3 segundos pela resposta.
    run: async ({ args }) => {
      const cidade = args.trim();
      if (!cidade) return { content: 'Diga a cidade: /clima São Paulo' };
      try {
        const sinal = AbortSignal.timeout(2300);
        const geo = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=pt&name=${encodeURIComponent(cidade)}`, { signal: sinal })).json();
        const lugar = geo.results?.[0];
        if (!lugar) return { content: `Não encontrei a cidade "${cidade.slice(0, 40)}".` };
        const tempo = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lugar.latitude}&longitude=${lugar.longitude}&current=temperature_2m,weather_code,wind_speed_10m`, { signal: sinal })).json();
        const c = tempo.current;
        return {
          embed: {
            title: `🌤️ ${lugar.name}${lugar.admin1 ? ' · ' + lugar.admin1 : ''}`,
            description: `**${Math.round(c.temperature_2m)}°C**, ${WMO[c.weather_code] ?? 'tempo variável'}`,
            color: '#3ddc97',
            fields: [{ name: 'Vento', value: `${Math.round(c.wind_speed_10m)} km/h` }],
          },
        };
      } catch {
        return { content: 'Não consegui consultar a previsão agora. Tente de novo em instantes.' };
      }
    },
  },
];

// ------------------------------------------------------------------ o servidor do bot
// escapa texto antes de pôr em HTML (evita XSS no painel: nomes de servidor/canal e mensagens vêm de fora)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// ids de chamadas já vistas (proteção contra repetição/replay: a mesma chamada assinada não vale duas vezes).
// LIMITAÇÃO: a lista fica na memória de CADA instância. Na Vercel, se o Resenha cair em duas instâncias diferentes, a
// proteção não cobre as duas. Para cobrir de verdade, guarde os ids num lugar compartilhado (Redis/banco) com validade de 5 min.
const VISTOS = new Map();
const jaVisto = (id) => {
  const agora = Date.now();
  for (const [k, t] of VISTOS) if (agora - t > 6 * 60_000) VISTOS.delete(k);
  if (VISTOS.has(id)) return true;
  VISTOS.set(id, agora);
  return false;
};
const igual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

export function criarBot({ token, signingSecret, adminKey, resenhaUrl = 'https://resenhabr.com.br' }) {
  const app = express();
  app.disable('x-powered-by');
  // cabeçalhos de segurança em todas as respostas (o painel é uma página HTML)
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    });
    next();
  });

  app.get('/', (_req, res) => res.type('text').send('Bot de exemplo do Resenha no ar. Endereço para colocar no Resenha: /resenha. Painel: /painel'));

  // 1) O Resenha chama aqui quando alguém usa um comando. O corpo vem CRU porque a assinatura é calculada sobre os bytes exatos.
  app.post('/resenha', express.raw({ type: '*/*', limit: '20kb' }), async (req, res) => {
    const corpo = req.body?.toString('utf8') ?? '';
    const carimbo = String(req.headers['x-resenha-timestamp'] ?? '');
    const esperada = 'v1=' + createHmac('sha256', signingSecret ?? '').update(`${carimbo}.${corpo}`).digest('hex');
    // recusa assinatura errada e chamadas antigas (mais de 5 minutos): quem não tem o segredo não consegue forjar
    // o carimbo TEM de ser um número (um texto qualquer virava NaN e passava pela checagem de data)
    if (!signingSecret || !/^\d{9,12}$/.test(carimbo) || !igual(req.headers['x-resenha-signature'] ?? '', esperada) || Math.abs(Date.now() / 1000 - Number(carimbo)) > 300) {
      return res.status(401).json({ erro: 'assinatura inválida' });
    }
    let evento;
    try {
      evento = JSON.parse(corpo);
    } catch {
      return res.status(400).json({ erro: 'JSON inválido' });
    }
    // o corpo tem de ser um objeto (assinado ou não, "null" ou "5" não são chamadas do Resenha)
    if (!evento || typeof evento !== 'object' || Array.isArray(evento)) return res.status(400).json({ erro: 'corpo inválido' });
    if (typeof evento.id !== 'string' || !evento.id) return res.status(400).json({ erro: 'falta o id da chamada' });
    if (jaVisto(evento.id)) return res.status(409).json({ erro: 'chamada repetida' });
    const cmd = COMANDOS.find((c) => c.name === evento.command);
    if (!cmd) return res.json({ content: `Não conheço o comando /${String(evento.command).slice(0, 20)}.` });
    res.json(await cmd.run({ args: String(evento.args ?? ''), user: evento.user, channel: evento.channel, guild: evento.guild }));
  });

  // 2) Painel simples (protegido pela ADMIN_KEY): registrar os comandos no Resenha e mandar um aviso.
  const form = express.urlencoded({ extended: false, limit: '10kb' });
  const pagina = (msg = '') => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Painel do bot</title><style>body{font:16px system-ui;max-width:560px;margin:30px auto;padding:0 16px;line-height:1.5}input,textarea{width:100%;padding:8px;margin:4px 0 12px;box-sizing:border-box}button{padding:10px 16px}.ok{background:#e6ffed;padding:10px;border-radius:8px}</style>
<h1>Painel do bot</h1>${msg ? `<p class="ok">${esc(msg)}</p>` : ''}
<h2>1. Registrar os comandos no Resenha</h2>
<p>Faça isto uma vez (e de novo se mudar os comandos).</p>
<form method="post" action="/painel/registrar"><label>Senha do painel (ADMIN_KEY)<input name="chave" type="password" required></label><button>Registrar comandos</button></form>
<h2>2. Mandar um aviso para um canal</h2>
<form method="post" action="/painel/anunciar"><label>Senha do painel<input name="chave" type="password" required></label>
<label>Nome do canal (ex.: geral)<input name="canal" required></label>
<label>Mensagem<textarea name="texto" rows="3" maxlength="500" required></textarea></label><button>Enviar aviso</button></form>`;
  app.get('/painel', (_req, res) => res.type('html').send(pagina()));

  const resenha = (caminho, metodo, corpo) =>
    fetch(`${resenhaUrl}/api${caminho}`, { method: metodo, headers: { 'content-type': 'application/json', authorization: `Bot ${token}` }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });

  app.post('/painel/registrar', form, async (req, res) => {
    if (!adminKey || !igual(req.body?.chave ?? '', adminKey)) return res.status(403).type('html').send(pagina('Senha incorreta.'));
    const r = await resenha('/bot/commands', 'PUT', { commands: COMANDOS.map(({ name, description, usage }) => ({ name, description, usage })) });
    const dados = await r.json().catch(() => ({}));
    res.type('html').send(pagina(r.ok ? `Pronto! ${dados.commands?.length ?? 0} comandos registrados.` : `O Resenha recusou: ${dados.error ?? r.status}`));
  });

  app.post('/painel/anunciar', form, async (req, res) => {
    if (!adminKey || !igual(req.body?.chave ?? '', adminKey)) return res.status(403).type('html').send(pagina('Senha incorreta.'));
    const nome = String(req.body?.canal ?? '').trim().replace(/^#/, '').toLowerCase();
    const texto = String(req.body?.texto ?? '').slice(0, 500);
    // acha o canal pelo nome em cada servidor onde o bot está instalado
    const eu = await (await resenha('/bot/me', 'GET')).json().catch(() => ({}));
    for (const g of eu.guilds ?? []) {
      const lista = await (await resenha(`/bot/guilds/${g.id}/channels`, 'GET')).json().catch(() => ({}));
      const canal = (lista.channels ?? []).find((c) => c.name.toLowerCase() === nome);
      if (!canal) continue;
      const r = await resenha(`/bot/channels/${canal.id}/messages`, 'POST', { content: texto });
      const dados = await r.json().catch(() => ({}));
      return res.type('html').send(pagina(r.ok ? `Aviso enviado em #${canal.name} (${g.name})!` : `O Resenha recusou: ${dados.error ?? r.status}`));
    }
    res.type('html').send(pagina(`Não achei o canal "${nome}". O bot precisa estar instalado no servidor (Configurações do servidor → Integrações).`));
  });

  return app;
}
