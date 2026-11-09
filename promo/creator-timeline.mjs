// Vídeo "Criei meu próprio Discord" (avatar do criador). Tempos de cada trecho falado medidos no áudio
// (pausas + núcleos de sílaba casados com o roteiro). Legendas, cenas, efeitos e trilha saem daqui.
export const FPS = 30;
export const DURATION = 44;

/** [início, fim, texto] de cada trecho falado */
export const SEGMENTS = [
  [0.13, 0.42, "Eu não sou"],
  [0.48, 0.70, "empresa."],
  [1.65, 1.80, "Não"],
  [1.86, 2.58, "tenho investidor."],
  [3.15, 3.86, "E mesmo assim..."],
  [4.54, 4.97, "eu criei"],
  [5.12, 5.29, "o meu"],
  [5.38, 5.56, "próprio"],
  [5.64, 5.81, "Discord."],
  [6.48, 8.23, "Tudo começou porque eu queria"],
  [8.34, 9.36, "transmitir a tela pros meus"],
  [9.50, 10.05, "amigos em Full HD..."],
  [10.46, 10.62, "e"],
  [10.70, 11.50, "descobri que, pra"],
  [11.74, 12.09, "isso, eu tinha"],
  [12.21, 12.53, "que pagar."],
  [13.01, 13.63, "Aí eu pensei:"],
  [14.09, 14.26, "e se eu"],
  [14.34, 14.89, "fizesse o meu?"],
  [15.31, 16.32, "Eu usei inteligência"],
  [16.39, 17.49, "artificial"],
  [17.56, 18.16, "como parceira de"],
  [18.36, 18.72, "programação,"],
  [18.82, 19.13, "e fui"],
  [19.31, 19.77, "construindo, noite"],
  [19.85, 20.17, "após noite."],
  [20.65, 21.47, "Primeiro, o chat."],
  [21.81, 22.98, "Depois, a call de voz."],
  [23.29, 24.28, "Depois, a transmissão de"],
  [24.36, 24.62, "tela."],
  [24.91, 25.70, "Aí vieram"],
  [25.80, 27.55, "o soundboard, os emojis, as figurinhas..."],
  [27.83, 28.68, "tudo de graça."],
  [29.09, 30.10, "Testei com a minha galera,"],
  [30.17, 30.98, "corrigi os bugs..."],
  [31.28, 32.41, "e hoje, ele tá no ar."],
  [32.76, 33.82, "O nome é Resenha."],
  [34.09, 34.76, "Ainda tá em"],
  [34.82, 35.79, "beta, mas já dá pra usar."],
  [36.21, 36.73, "Quer saber como"],
  [36.79, 36.96, "eu fiz?"],
  [37.37, 37.73, "Comenta \"COMO\","],
  [37.87, 38.23, "que eu"],
  [38.31, 38.69, "conto tudo"],
  [38.83, 39.77, "no próximo vídeo."],
  [40.12, 40.74, "Link na bio."],
  [40.96, 41.65, "Chama a resenha!"],
];

const SPECIAL = { hd: 2, full: 1, discord: 2, chat: 1, call: 1, soundboard: 2, bugs: 1, link: 2, emojis: 3 };
function syllables(word) {
  const w = word.toLowerCase().replace(/[^\p{L}]/gu, '');
  if (SPECIAL[w]) return SPECIAL[w];
  return Math.max(1, (w.match(/(ão|õe|ãe|ai|ei|oi|ou|eu|au|iu|ui|[aeiouáéíóúâêôãõà])/g) ?? []).length);
}

const KEYS = new Set(['Discord.', 'pagar.', 'meu?', 'inteligência', 'artificial', 'chat.', 'voz.', 'tela.', 'soundboard,', 'figurinhas...', 'graça.', 'ar.', 'Resenha.', '"COMO",', 'bio.', 'resenha!', 'HD...']);

/** Cada palavra com início/fim (dividindo o trecho pelas sílabas). */
export const WORDS = SEGMENTS.flatMap(([a, b, text]) => {
  const ws = text.split(' ');
  const wt = ws.map((w) => syllables(w) + 0.35);
  const total = wt.reduce((x, y) => x + y, 0);
  let t = a;
  return ws.map((w, i) => {
    const d = (wt[i] / total) * (b - a);
    const out = { word: w, start: t, end: t + d, key: KEYS.has(w) };
    t += d;
    return out;
  });
});

/** Momento em que uma palavra começa (n-ésima ocorrência). */
export function at(word, nth = 0) {
  const hits = WORDS.filter((w) => w.word.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase() === word.toLowerCase());
  if (!hits[nth]) throw new Error(`palavra "${word}" não encontrada`);
  return hits[nth].start;
}

/** Cenas e momentos-chave presos às palavras faladas. */
export const CUES = {
  criei: at('criei'),
  tudo: at('Tudo', 0),
  pagar: at('pagar'),
  pensei: at('Aí', 0),
  fizesse: at('fizesse'),
  usei: at('usei'),
  noite: at('noite', 0),
  chat: at('Primeiro'),
  call: at('Depois', 0),
  tela: at('Depois', 1),
  soundboard: at('Aí', 1),
  emojis: at('emojis'),
  figurinhas: at('figurinhas'),
  graca: at('graça'),
  testei: at('Testei'),
  bugs: at('corrigi'),
  noAr: at('hoje'),
  nome: at('nome'),
  beta: at('Ainda'),
  quer: at('Quer'),
  como: at('Comenta'),
  link: at('Link'),
  chama: at('Chama'),
};

/** Blocos de legenda: frases (pontuação ou pausa longa) divididas em blocos equilibrados de até 3 palavras. */
export function captionChunks() {
  const phrases = [];
  let cur = [];
  WORDS.forEach((w, i) => {
    const prev = WORDS[i - 1];
    if (cur.length && w.start - prev.end > 0.35) (phrases.push(cur), (cur = []));
    cur.push(w);
    if (/[.?!:,]$|\.\.\.$|",$/.test(w.word)) (phrases.push(cur), (cur = []));
  });
  if (cur.length) phrases.push(cur);
  const chunks = [];
  for (const ph of phrases) {
    // frase curta fica inteira (ex.: "Eu não sou empresa." nunca vira "SOU EMPRESA" sozinho)
    const chars = ph.map((w) => w.word).join(' ').length;
    const g = ph.length <= 4 && chars <= 20 ? 1 : Math.ceil(ph.length / 3);
    let pos = 0;
    for (let i = 0; i < g; i++) {
      const n = Math.floor(ph.length / g) + (i < ph.length % g ? 1 : 0);
      const part = ph.slice(pos, pos + n);
      pos += n;
      chunks.push({ words: part, start: part[0].start, end: part[part.length - 1].end });
    }
  }
  for (let i = 0; i < chunks.length - 1; i++) chunks[i].end = Math.min(chunks[i + 1].start, chunks[i].end + 0.6);
  chunks[chunks.length - 1].end = DURATION - 1.5;
  return chunks;
}
