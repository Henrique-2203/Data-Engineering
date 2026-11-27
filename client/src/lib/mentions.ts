/** @usuario (mesmas regras do cadastro) ou @todos. */
export const MENTION_RE = /(^|[^\w@])@(todos|[a-z0-9_.]{3,24})(?![\w])/gi;

/** A mensagem menciona este usuário? `everyone` = o servidor confirmou um @todos com permissão. */
export function mentionsUser(content: string, username: string, everyone: boolean): boolean {
  if (everyone) return true;
  for (const m of content.matchAll(MENTION_RE)) {
    if (m[2].toLowerCase() === username.toLowerCase()) return true;
  }
  return false;
}

/** Texto antes do cursor termina com "@algo"? Retorna o que foi digitado depois do @. */
export function mentionQuery(textBeforeCaret: string): string | null {
  const m = /(^|\s)@([\w.]{0,24})$/.exec(textBeforeCaret);
  return m ? m[2] : null;
}
