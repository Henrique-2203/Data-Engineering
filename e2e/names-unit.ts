// Filtro de nomes que imitam a equipe/"Resenha" (homóglifos, outros alfabetos, invisíveis). Uso: node --import tsx e2e/names-unit.ts
import { impersonatesResenhaStaff, impersonatesStaff, mentionsResenha, skeleton } from '../server/src/names.ts';

const assert = (c: unknown, m: string) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const cc = String.fromCharCode;

// nomes que DEVEM ser barrados como "Resenha" (bots) e como equipe
const imitam = [
  'Resenha Bot', 'resenha', 'RESENHA', 'Resenh@', 'R3senha', 'Rеsenha' /* cirílico е */, 'Ｒｅｓｅｎｈａ' /* largura total */, `Re${cc(0x200b)}senha` /* zero-width */,
  '𝐑𝐞𝐬𝐞𝐧𝐡𝐚' /* negrito matemático */,
  // os 4 casos do relatório
  'Resenħa', 'ʀesenha', 'Resenhα', 'R€senha',
  // outros disfarces
  'Resenhɑ', 'Rеѕеnһа', 'Resenha‮', 'Re$enha', 'Resεnha', 'Rєsenha' /* outra letra desconhecida: vira curinga */, 'Reṣenha', 'ᴿesenha',
];
for (const n of imitam) assert(mentionsResenha(n), `"${n}" (esqueleto "${skeleton(n)}") deveria ser reconhecido como Resenha`);

// equipe "oficial"
for (const n of ['Resenha Oficial', 'Resenhα Staff', 'ʀesenha Suporte', 'R€senha Admin', 'Resenħa Equipe', 'Resenha Bot']) {
  assert(impersonatesStaff(n), `"${n}" deveria se passar pela equipe`);
  assert(impersonatesResenhaStaff(n), `"${n}" deveria ser barrado em apelido/canal`);
}
assert(impersonatesStaff('Admin') && impersonatesStaff('Suporte') && impersonatesStaff('Rеsenha'), 'nomes de cargo e cirílico barrados como equipe');

// NÃO podem ser barrados (falsos positivos): nomes de verdade, outros alfabetos inteiros, palavras parecidas
for (const n of ['Renata', 'Resende', 'Reserva', 'Receita', 'Henrique', 'Rosenha', 'Ana Paula', 'João', 'Рената' /* cirílico inteiro */, '山田太郎', 'ひらがなひらが', 'أحمد', 'Ресенья', '🎮 Gamer', 'Resenhar']) {
  // "Resenhar" contém "resenha" de verdade (palavra do português): para BOT é barrado (contém Resenha); para equipe não
  if (n === 'Resenhar') {
    assert(mentionsResenha(n), '"Resenhar" contém Resenha (bots não podem)');
    assert(!impersonatesStaff(n), '"Resenhar" não se passa pela equipe');
    continue;
  }
  assert(!mentionsResenha(n), `"${n}" (esqueleto "${skeleton(n)}") não deveria ser barrado como Resenha`);
  assert(!impersonatesStaff(n), `"${n}" não deveria se passar pela equipe`);
}
// apelido/canal: "resenha" sozinho é palavra do dia a dia (bate-papo) e é permitido; só "resenha + cargo oficial" é barrado
assert(!impersonatesResenhaStaff('resenha') && !impersonatesResenhaStaff('Resenha da galera') && !impersonatesResenhaStaff('resenha-geral'), '"resenha" comum é permitido em apelido e canal');
assert(impersonatesResenhaStaff('resenha-oficial') && impersonatesResenhaStaff('resenha_staff'), '"resenha-oficial" é barrado em canal');

// o esqueleto nunca DESCARTA uma letra desconhecida (vira "?"), então o nome não parece menor do que é
assert(skeleton('Resenħa') === 'resenha' && skeleton('Resenhα') === 'resenha' && skeleton('ʀesenha') === 'resenha' && skeleton('R€senha') === 'resenha', 'homóglifos mapeados');
assert(skeleton('Resen' + cc(0x0561) + 'a') === 'resen?a', 'letra desconhecida (armênia) vira "?", não some');
assert(skeleton('山田') === '??' && skeleton('🎮!!') === 'i'.repeat(0) + skeleton('!!'), 'emoji some; letras de outro alfabeto viram "?"');
console.log('✓ filtro de nomes: homóglifos (ħ ʀ α ɑ €...), letras desconhecidas viram curinga, sem falsos positivos em nomes reais');
