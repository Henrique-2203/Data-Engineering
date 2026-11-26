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
  '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i', '|': 'l',
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', ɡ: 'g', ո: 'n', ս: 'u', ꓲ: 'l', ⅼ: 'l', ⅰ: 'i',
};

/** "esqueleto" do nome: sem acento, sem símbolos, com letras parecidas trocadas (Resenh@ ≈ resenha, rn ≈ m, vv ≈ w) */
export function skeleton(name: string): string {
  let s = stripInvisible(name).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = [...s].map((c) => CONFUSABLE[c] ?? c).join('');
  s = s.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/[^a-z]/g, '');
  return s;
}

const RESERVED = new Set([
  'resenha', 'resenhabot', 'resenhaoficial', 'resenhaequipe', 'resenhasuporte', 'resenhastaff', 'resenhaadmin', 'resenhateam', 'resenhasupport',
  'equipe', 'equiperesenha', 'suporte', 'suporteresenha', 'support', 'admin', 'administrador', 'staff', 'oficial', 'sistema', 'system', 'everyone', 'todos',
]);
const RESERVED_PREFIX = /^resenha(bot|oficial|official|equipe|staff|suporte|support|admin|team)/;

/** o nome se passa pela equipe/sistema do Resenha? (a equipe de verdade, listada em PLATFORM_ADMINS, pode usar) */
export function impersonatesStaff(name: string, username?: string): boolean {
  if (username && config.platformAdmins.includes(username.toLowerCase())) return false;
  const k = skeleton(name);
  return RESERVED.has(k) || RESERVED_PREFIX.test(k);
}
