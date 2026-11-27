import { config } from './config.ts';

/**
 * Nomes e texto de pessoas (IMP-01/02): tira caracteres invisíveis e de inversão de leitura (que servem para
 * disfarçar "exe" como "txt" ou esconder quem é quem) e impede que alguém se passe pela equipe do Resenha.
 */

// controles bidi (U+202A–202E, U+2066–2069, U+200E/F, U+061C), espaço de largura zero (U+200B), word joiner (U+2060),
// BOM (U+FEFF), hífen suave (U+00AD) e separadores de linha/parágrafo. Mantém U+200D (junta emojis 👨‍👩‍👧) e U+200C.
const ch = (n: number) => String.fromCharCode(n);
const INVISIBLE = new RegExp(`[${[[0x202a, 0x202e], [0x2066, 0x2069]].map(([a, b]) => `${ch(a)}-${ch(b)}`).join('')}${[0x200e, 0x200f, 0x061c, 0x200b, 0x2060, 0xfeff, 0x00ad, 0x2028, 0x2029, 0x180e].map(ch).join('')}]`, 'g');
export const stripInvisible = (s: string) => s.replace(INVISIBLE, '');

/** campos que nunca são mexidos (senha, códigos, tokens) */
const SENSITIVE_KEY = /pass|senha|code|codigo|token|secret|captcha|totp|otp/i;

/** devolve uma cópia profunda do dado com o texto limpo de caracteres invisíveis */
export function cleanDeep(v: unknown, key = '', depth = 0): unknown {
  if (depth > 8) return v;
  if (typeof v === 'string') return SENSITIVE_KEY.test(key) ? v : stripInvisible(v);
  if (Array.isArray(v)) return v.map((x) => cleanDeep(x, key, depth + 1));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cleanDeep(x, k, depth + 1)]));
  return v;
}

const CONFUSABLE: Record<string, string> = {
  '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i', '|': 'l', '€': 'e', '£': 'l', '¥': 'y', '¢': 'c',
  // cirílico
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', к: 'k', м: 'm', н: 'h', т: 't', в: 'b', ѵ: 'v', ԛ: 'q', ԝ: 'w', һ: 'h', ӏ: 'l',
  // grego
  α: 'a', β: 'b', γ: 'y', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x', η: 'n', ω: 'w', ϲ: 'c', ϳ: 'j', ς: 's',
  // latim estendido e IPA (letras que o NFKD não decompõe)
  ħ: 'h', ɦ: 'h', ʜ: 'h', ı: 'i', ɪ: 'i', ɩ: 'i', ł: 'l', ʟ: 'l', ɭ: 'l', ø: 'o', ɵ: 'o', ᴏ: 'o', đ: 'd', ð: 'd', ɖ: 'd', ᴅ: 'd', þ: 'p', ƒ: 'f',
  ʀ: 'r', ɾ: 'r', ɼ: 'r', ɑ: 'a', ɐ: 'a', ᴀ: 'a', ɛ: 'e', ᴇ: 'e', ɜ: 'e', ɡ: 'g', ɢ: 'g', ɴ: 'n', ɲ: 'n', ŋ: 'n', ᴍ: 'm', ɱ: 'm', ꜱ: 's', ʂ: 's', ᴛ: 't', ʈ: 't',
  ᴜ: 'u', ʋ: 'v', ᴠ: 'v', ᴡ: 'w', ʏ: 'y', ᴢ: 'z', ʐ: 'z', ɓ: 'b', ʙ: 'b', ƀ: 'b', ᴄ: 'c', ƈ: 'c', ɕ: 'c', ᴘ: 'p', ᴋ: 'k', ʞ: 'k', ꓲ: 'l', ⅼ: 'l', ⅰ: 'i', ո: 'n', ս: 'u', ɯ: 'w',
};

/**
 * "esqueleto" do nome: sem acento, sem símbolos, com letras parecidas trocadas (Resenh@ ≈ resenha, rn ≈ m, vv ≈ w).
 * Uma letra que NÃO é conhecida (de outro alfabeto) NÃO some: vira "?" (curinga), para o nome não parecer ter menos letras do
 * que tem — veja `likeAt` abaixo, que deixa o "?" casar com qualquer letra ao comparar com os nomes reservados.
 */
export function skeleton(name: string): string {
  let s = stripInvisible(name).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = [...s].map((c) => CONFUSABLE[c] ?? c).join('');
  s = s.replace(/rn/g, 'm').replace(/vv/g, 'w');
  return [...s].map((c) => (c >= 'a' && c <= 'z' ? c : /\p{L}/u.test(c) ? '?' : '')).join('');
}

/** `key` (com "?" curingas) parece a `word` a partir da posição i? Os "?" casam com qualquer letra, mas pelo menos 5/7 das letras têm de ser de verdade (nome todo em outro alfabeto não casa) */
function likeAt(key: string, word: string, i: number): boolean {
  if (i + word.length > key.length) return false;
  let real = 0;
  for (let j = 0; j < word.length; j++) {
    const c = key[i + j];
    if (c === word[j]) real++;
    else if (c !== '?') return false;
  }
  return real >= Math.ceil((word.length * 5) / 7);
}
const containsLike = (key: string, word: string) => {
  for (let i = 0; i + word.length <= key.length; i++) if (likeAt(key, word, i)) return true;
  return false;
};

/** o nome contém "Resenha" (mesmo disfarçado com letras parecidas ou de outro alfabeto)? */
export const mentionsResenha = (name: string) => containsLike(skeleton(name), 'resenha');

const RESERVED = new Set([
  'resenha', 'resenhabot', 'resenhaoficial', 'resenhaequipe', 'resenhasuporte', 'resenhastaff', 'resenhaadmin', 'resenhateam', 'resenhasupport',
  'equipe', 'equiperesenha', 'suporte', 'suporteresenha', 'support', 'admin', 'administrador', 'staff', 'oficial', 'sistema', 'system', 'everyone', 'todos',
]);
const PREFIXES = ['bot', 'oficial', 'official', 'equipe', 'staff', 'suporte', 'support', 'admin', 'team'].map((x) => `resenha${x}`);

/** o nome se passa pela equipe/sistema do Resenha? (a equipe de verdade, listada em PLATFORM_ADMINS, pode usar) */
export function impersonatesStaff(name: string, username?: string): boolean {
  if (username && config.platformAdmins.includes(username.toLowerCase())) return false;
  const k = skeleton(name);
  for (const w of RESERVED) if (k.length === w.length && likeAt(k, w, 0)) return true;
  return PREFIXES.some((w) => likeAt(k, w, 0));
}

/** só "Resenha" + cargo oficial (resenhaoficial, resenhastaff...): vale para apelidos e nomes de canal, onde "admin"/"suporte" sozinhos são comuns e "resenha" é só uma palavra do dia a dia */
export function impersonatesResenhaStaff(name: string, username?: string): boolean {
  if (username && config.platformAdmins.includes(username.toLowerCase())) return false;
  const k = skeleton(name);
  return PREFIXES.some((w) => likeAt(k, w, 0)) || (k.length === 'resenhabot'.length && likeAt(k, 'resenhabot', 0));
}
