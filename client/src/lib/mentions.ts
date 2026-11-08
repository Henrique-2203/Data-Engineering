/** @usuario (mesmas regras do cadastro) ou @todos. */
export const MENTION_RE = /(^|[^\w@])@(todos|[a-z0-9_.]{3,24})(?![\w])/gi;

/** A mensagem menciona este usuário? (@todos só vale em canais de servidor) */
export function mentionsUser(content: string, username: string, inGuild: boolean): boolean {
  for (const m of content.matchAll(MENTION_RE)) {
    const name = m[2].toLowerCase();
    if (name === username.toLowerCase() || (inGuild && name === 'todos')) return true;
  }
  return false;
}

/** Texto antes do cursor termina com "@algo"? Retorna o que foi digitado depois do @. */
export function mentionQuery(textBeforeCaret: string): string | null {
  const m = /(^|\s)@([\w.]{0,24})$/.exec(textBeforeCaret);
  return m ? m[2] : null;
}
