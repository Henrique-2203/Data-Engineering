/** @usuario (mesmas regras do cadastro); @todos é tratado à parte. Igual ao do site (client/src/lib/mentions.ts). */
const MENTION_RE = /(^|[^\w@])@(todos|[a-z0-9_.]{3,24})(?![\w])/gi;

/** Nomes de usuário mencionados na mensagem (sem @todos), no máximo 20. */
export function mentionedUsernames(content: string): string[] {
  const out = new Set<string>();
  for (const m of content.matchAll(MENTION_RE)) if (m[2].toLowerCase() !== 'todos') out.add(m[2].toLowerCase());
  return [...out].slice(0, 20);
}
