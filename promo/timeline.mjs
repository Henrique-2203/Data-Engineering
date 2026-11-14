// Roteiro do vídeo com o tempo REAL de cada trecho da narração (medido nas pausas do áudio).
// As legendas, as cenas, os efeitos sonoros e o .srt saem daqui. Para outra narração, basta
// medir os trechos de novo (ffmpeg -af silencedetect) e trocar os tempos de `segs`.
export const FPS = 30;
export const DURATION = 32.6;
/** narração (opcional): arquivo e volume; sem ela, o vídeo sai só com os efeitos */
export const VOICE_START = 0;

export const LINES = [
  { segs: [[0.05, 2.91, 'O Discord quer te cobrar pra fazer live em HD.']], keys: ['cobrar', 'HD.'] },
  { segs: [[3.15, 3.86, 'Então...'], [4.12, 4.98, 'eu criei o meu.']], keys: ['criei'] },
  { segs: [[5.41, 6.8, 'Esse é o Resenha.']], keys: ['Resenha.'] },
  { segs: [[7.06, 8.88, 'Mesmo jeitinho que você já conhece:'], [9.09, 9.73, 'servidor,'], [9.92, 10.39, 'canal,'], [10.63, 10.92, 'call.']], keys: ['servidor,', 'canal,', 'call.'] },
  { segs: [[11.26, 11.93, 'Só que aqui,'], [12.1, 14.98, 'compartilhar a tela em Full HD é de graça.']], keys: ['Full', 'HD', 'graça.'] },
  { segs: [[15.25, 15.96, 'Soundboard?'], [16.19, 16.86, 'De graça.']], keys: ['Soundboard?', 'graça.'] },
  { segs: [[17.13, 19.82, 'Emoji animado, figurinha, foto em GIF?'], [20.09, 21.16, 'Tudo de graça.']], keys: ['GIF?', 'graça.'] },
  { segs: [[21.38, 23.97, 'E ele mostra sozinho o jogo que você tá jogando.']], keys: ['sozinho', 'jogando.'] },
  { segs: [[24.23, 26.08, 'Funciona no PC e no celular.']], keys: ['PC', 'celular.'] },
  { segs: [[26.31, 27.4, 'Feito no Brasil,'], [27.53, 28.8, 'pra galera que joga junto.']], keys: ['Brasil,'] },
  { segs: [[29.05, 29.58, 'Quer testar?'], [29.85, 30.55, 'Link na bio.'], [30.77, 31.68, 'Chama a resenha!']], keys: ['Link', 'bio.', 'resenha!'] },
].map((l) => ({ ...l, start: l.segs[0][0], end: l.segs[l.segs.length - 1][1], text: l.segs.map((s) => s[2]).join(' ') }));

/** sílabas aproximadas (para dividir o tempo de cada trecho entre as palavras) */
const SPECIAL = { hd: 2, pc: 2, gif: 1, soundboard: 2, discord: 2, full: 1, call: 1, link: 2, live: 1 };
function syllables(word) {
  const w = word.toLowerCase().replace(/[^\p{L}]/gu, '');
  if (SPECIAL[w]) return SPECIAL[w];
  const groups = w.match(/(ão|õe|ãe|ai|ei|oi|ou|eu|au|iu|ui|[aeiouáéíóúâêôãõà])/g);
  return Math.max(1, groups?.length ?? 1);
}

/** Tempo de cada palavra: cada trecho falado é dividido pelas sílabas das palavras. */
export function wordTimes(line) {
  const out = [];
  for (const [a, b, text] of line.segs) {
    const words = text.split(' ');
    const weights = words.map((w) => syllables(w) + 0.35);
    const total = weights.reduce((x, y) => x + y, 0);
    let t = a;
    words.forEach((w, i) => {
      const d = (weights[i] / total) * (b - a);
      out.push({ word: w, start: t, end: t + d, key: line.keys.includes(w) });
      t += d;
    });
  }
  return out;
}

/** Início de uma palavra (fala `li`, n-ésima ocorrência de `word`) — usado para sincronizar animações. */
export function at(li, word, nth = 0) {
  const hits = wordTimes(LINES[li]).filter((w) => w.word.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase() === word.toLowerCase());
  if (!hits[nth]) throw new Error(`palavra "${word}" não está na fala ${li}`);
  return hits[nth].start;
}

/** Momentos-chave das animações e dos efeitos sonoros, presos às palavras faladas. */
export const CUES = {
  lock: at(0, 'cobrar'),
  money: at(0, 'live'),
  servidor: at(3, 'servidor'),
  canal: at(3, 'canal'),
  call: at(3, 'call'),
  fullHd: at(4, 'Full'),
  stamp5: at(4, 'graça'),
  tap: at(5, 'Soundboard') + 0.25,
  horn: at(5, 'Soundboard') + 0.4,
  stamp6: at(5, 'graça'),
  pops: [at(6, 'Emoji'), at(6, 'animado'), at(6, 'figurinha'), at(6, 'foto'), at(6, 'GIF')],
  stamp7: at(6, 'graça'),
  playing: at(7, 'sozinho'),
  pad: at(7, 'jogo'),
  cta: at(10, 'Link'),
};

/** Blocos de legenda: até 3 palavras, quebrando nas pausas da fala e na pontuação, sem palavra sozinha. */
export function captionChunks() {
  const chunks = [];
  for (const line of LINES) {
    const words = wordTimes(line);
    // trechos falados (separados por pausa) -> frases (separadas por pontuação)
    const phrases = [];
    let cur = [];
    words.forEach((w, i) => {
      const gap = cur.length && w.start - words[i - 1].end > 0.1;
      if (gap) (phrases.push(cur), (cur = []));
      cur.push(w);
      if (/[.?!:,]$/.test(w.word)) (phrases.push(cur), (cur = []));
    });
    if (cur.length) phrases.push(cur);
    // junta frase de 1 palavra com a seguinte do mesmo trecho (ex.: "Emoji animado, figurinha,")
    for (const ph of phrases) {
      const g = Math.ceil(ph.length / 3);
      const sizes = Array.from({ length: g }, (_, i) => Math.floor(ph.length / g) + (i < ph.length % g ? 1 : 0));
      // não separa "Full HD"
      let k = 0;
      sizes.forEach((n, i) => {
        if (i < sizes.length - 1 && ph[k + n - 1]?.word === 'Full') (sizes[i] += 1), (sizes[i + 1] -= 1);
        k += sizes[i];
      });
      let pos = 0;
      for (const n of sizes.filter((n) => n > 0)) {
        const part = ph.slice(pos, pos + n);
        pos += n;
        chunks.push({ words: part, start: part[0].start, end: part[part.length - 1].end });
      }
    }
  }
  for (let i = 0; i < chunks.length - 1; i++) chunks[i].end = Math.min(chunks[i + 1].start, chunks[i].end + 0.6);
  chunks[chunks.length - 1].end = DURATION - 0.4;
  return chunks;
}

const srtTime = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
export const toSrt = () => LINES.map((l, i) => `${i + 1}\n${srtTime(l.start)} --> ${srtTime(l.end)}\n${l.text}\n`).join('\n');
