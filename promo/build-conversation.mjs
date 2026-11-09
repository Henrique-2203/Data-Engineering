// Monta a conversa a partir dos 2 arquivos de voz (um por personagem): corta cada fala (tempos em
// promo/out/conversa/{amigo,criador}.json), intercala amigo -> criador com uma pausa natural e junta
// o "Chama a resenha!" final dos dois. Gera conversa.json (quem fala quando, palavra a palavra) e as trilhas.
// Uso: node promo/build-conversation.mjs <voz-amigo.mp3> <voz-criador.mp3>
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const [amigoFile, criadorFile] = process.argv.slice(2).map((p) => path.resolve(p));
const OUT = path.resolve('promo/out/conversa');
const amigo = JSON.parse(readFileSync(path.join(OUT, 'amigo.json'), 'utf8'));
const criador = JSON.parse(readFileSync(path.join(OUT, 'criador.json'), 'utf8'));

// ordem das falas: [personagem, índice da fala]; 'both' = os dois juntos
const ORDER = [['amigo', 0], ['criador', 0], ['amigo', 1], ['criador', 1], ['amigo', 2], ['criador', 2], ['amigo', 3], ['criador', 3], ['amigo', 4], ['criador', 4], ['amigo', 5], ['criador', 5], ['criador', 6], ['criador', 7], ['amigo', 6], ['criador', 8], ['both', [7, 9]]];
const PAD_IN = 0.05, PAD_OUT = 0.12; // folga para não cortar o começo/fim das palavras
const GAP_TURN = 0.28, GAP_SAME = 0.18;

let t = 0.4, prev = null;
const turns = [];
for (const [who, idx] of ORDER) {
  if (who === 'both') {
    const a = amigo[idx[0]], c = criador[idx[1]];
    t += GAP_TURN;
    const dur = Math.max(a.end - a.start, c.end - c.start);
    turns.push({ who: 'amigo', src: 'amigo', at: t, from: a.start, to: a.end, line: a, both: true });
    turns.push({ who: 'criador', src: 'criador', at: t, from: c.start, to: c.end, line: c, both: true });
    t += dur;
    continue;
  }
  const l = (who === 'amigo' ? amigo : criador)[idx];
  t += prev === who ? GAP_SAME : GAP_TURN;
  turns.push({ who, src: who, at: t, from: l.start, to: l.end, line: l });
  t += l.end - l.start;
  prev = who;
}
const DURATION = Math.round((t + 0.9) * 100) / 100;

// palavras com tempo no vídeo final
const words = turns.flatMap((tr) => tr.line.words.map(([w, a, b]) => ({ who: tr.both ? 'both' : tr.who, word: w, start: +(tr.at + (a - tr.from)).toFixed(3), end: +(tr.at + (b - tr.from)).toFixed(3) })))
  .filter((w, i, all) => !(w.who === 'both' && all.findIndex((x) => x.who === 'both' && x.word === w.word && Math.abs(x.start - w.start) < 0.6) !== i));
const lines = turns.map((tr) => ({ who: tr.who, both: !!tr.both, start: +tr.at.toFixed(3), end: +(tr.at + tr.to - tr.from).toFixed(3), text: tr.line.line }));
writeFileSync(path.join(OUT, 'conversa.json'), JSON.stringify({ duration: DURATION, lines, words }, null, 1));

// uma trilha por personagem (para a boca de cada um) e a conversa completa
for (const who of ['amigo', 'criador']) {
  const mine = turns.filter((tr) => tr.who === who);
  const file = who === 'amigo' ? amigoFile : criadorFile;
  const inputs = mine.flatMap(() => ['-i', file]);
  const parts = mine.map((tr, i) => `[${i}:a]atrim=${Math.max(0, tr.from - PAD_IN)}:${tr.to + PAD_OUT},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st=${tr.to - tr.from + PAD_IN + PAD_OUT - 0.05}:d=0.05,adelay=${Math.round((tr.at - PAD_IN) * 1000)}:all=1[p${i}]`);
  const mix = `${parts.join(';')};${mine.map((_, i) => `[p${i}]`).join('')}amix=inputs=${mine.length}:normalize=0:duration=longest,apad=whole_dur=${DURATION},loudnorm=I=-16:TP=-1.5:LRA=7[o]`;
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', mix, '-map', '[o]', '-ar', '44100', '-ac', '1', path.join(OUT, `voz-${who}.wav`)]);
  if (r.status !== 0) throw new Error(String(r.stderr));
}
spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(OUT, 'voz-amigo.wav'), '-i', path.join(OUT, 'voz-criador.wav'), '-filter_complex', 'amix=inputs=2:normalize=0,alimiter=limit=0.9', path.join(OUT, 'conversa.wav')]);
console.log(`conversa montada: ${DURATION} s, ${lines.length} falas`);
for (const l of lines) console.log(`${l.start.toFixed(2).padStart(6)} ${l.who.padEnd(8)} ${l.text.slice(0, 60)}`);
