// Roteiro do vídeo com o tempo de cada fala (em segundos). As legendas, as cenas, os efeitos sonoros
// e o arquivo .srt saem daqui. Para encaixar uma narração gravada, basta ajustar os tempos.
export const FPS = 30;
export const DURATION = 31.5;

export const LINES = [
  { start: 0.15, end: 2.85, text: 'O Discord quer te cobrar pra fazer live em HD.', keys: ['cobrar', 'HD.'] },
  { start: 2.95, end: 4.35, text: 'Então eu criei o meu.', keys: ['criei'] },
  { start: 4.45, end: 5.7, text: 'Esse é o Resenha.', keys: ['Resenha.'] },
  { start: 5.8, end: 9.45, text: 'Mesmo jeitinho que você já conhece: servidor, canal, call.', keys: ['servidor,', 'canal,', 'call.'] },
  { start: 9.55, end: 13.05, text: 'Só que aqui, compartilhar a tela em Full HD é de graça.', keys: ['Full', 'HD', 'graça.'] },
  { start: 13.15, end: 14.85, text: 'Soundboard? De graça.', keys: ['Soundboard?', 'graça.'] },
  { start: 14.95, end: 18.65, text: 'Emoji animado, figurinha, foto em GIF? Tudo de graça.', keys: ['GIF?', 'graça.'] },
  { start: 18.75, end: 21.65, text: 'E ele mostra sozinho o jogo que você tá jogando.', keys: ['sozinho', 'jogando.'] },
  { start: 21.75, end: 23.65, text: 'Funciona no PC e no celular.', keys: ['PC', 'celular.'] },
  { start: 23.75, end: 26.45, text: 'Feito no Brasil, pra galera que joga junto.', keys: ['Brasil,'] },
  { start: 26.6, end: 30.4, text: 'Quer testar? Link na bio. Chama a resenha!', keys: ['Link', 'bio.', 'resenha!'] },
];

/** Tempo de cada palavra: a fala é dividida pelo tamanho das palavras (sílabas aproximadas). */
export function wordTimes(line) {
  const words = line.text.split(' ');
  const weights = words.map((w) => w.replace(/[^\p{L}\p{N}]/gu, '').length + 2.5);
  const total = weights.reduce((a, b) => a + b, 0);
  const span = line.end - line.start - 0.2;
  let t = line.start;
  return words.map((w, i) => {
    const d = (weights[i] / total) * span;
    const out = { word: w, start: t, end: t + d, key: line.keys.includes(w) };
    t += d;
    return out;
  });
}

/** Blocos de legenda: até 3 palavras (ou ~16 letras) por vez. */
export function captionChunks() {
  const chunks = [];
  for (const line of LINES) {
    const words = wordTimes(line);
    let cur = [];
    const flush = () => cur.length && chunks.push({ words: cur, start: cur[0].start, end: cur[cur.length - 1].end });
    for (const w of words) {
      const len = cur.reduce((n, x) => n + x.word.length + 1, 0) + w.word.length;
      if (cur.length >= 3 || (cur.length && len > 17)) {
        flush();
        cur = [];
      }
      cur.push(w);
      if (/[.?!:,]$/.test(w.word) && cur.length >= 2) {
        flush();
        cur = [];
      }
    }
    flush();
  }
  // cada bloco fica na tela até o próximo começar (sem piscar)
  for (let i = 0; i < chunks.length - 1; i++) chunks[i].end = Math.min(chunks[i + 1].start, chunks[i].end + 0.6);
  chunks[chunks.length - 1].end = DURATION - 0.6;
  return chunks;
}

const srtTime = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
export const toSrt = () => LINES.map((l, i) => `${i + 1}\n${srtTime(l.start)} --> ${srtTime(l.end)}\n${l.text}\n`).join('\n');
