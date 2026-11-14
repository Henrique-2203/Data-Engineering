// Explorar servidores: categorias (o servidor escolhe uma) e o que é preciso para aparecer na lista.
export const GUILD_CATEGORIES = ['jogos', 'fps', 'rpg', 'moba', 'amizade', 'estudos', 'musica', 'anime', 'outros'] as const;
export type GuildCategory = (typeof GUILD_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<GuildCategory, string> = {
  jogos: '🎮 Jogos',
  fps: '🎯 FPS',
  rpg: '🐉 RPG',
  moba: '⚔️ MOBA',
  amizade: '🤝 Amizade',
  estudos: '📚 Estudos',
  musica: '🎵 Música',
  anime: '🌸 Anime',
  outros: '✨ Outros',
};

/** Para aparecer no Explorar: público, com descrição, ícone e regras com "Aceito" (e sem ter sido tirado da lista). */
export function listingMissing(g: { description?: string; iconId?: string | null; rules?: string; rulesRequired?: boolean; category?: string }) {
  const missing: string[] = [];
  if (!g.description?.trim()) missing.push('descrição');
  if (!g.iconId) missing.push('ícone');
  if (!g.rules?.trim() || !g.rulesRequired) missing.push('regras com "Aceito"');
  if (!g.category) missing.push('categoria');
  return missing;
}
