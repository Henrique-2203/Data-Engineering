// Boas-vindas do servidor: texto sugerido e troca de {usuario} e {servidor} pelo nome de verdade.
export const WELCOME_SUGGESTED = `Que bom ter você aqui, {usuario}! 💚

Bem-vindo(a) ao {servidor}. Para começar:
📜 Leia as regras e clique em "Aceito".
💬 Se apresenta no chat: de onde você é e o que joga.
🔊 As calls são abertas: é só entrar.`;

export function fillWelcome(text: string, user: string, server: string) {
  return text.replace(/\{usuario\}/gi, user).replace(/\{servidor\}/gi, server);
}
