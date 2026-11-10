/**
 * Banners da call (fundo do quadro de cada pessoa na chamada). Os temas prontos são artes ORIGINAIS
 * do Resenha (desenhos vetoriais inspirados em estilos de jogo), sem imagens, logos ou personagens
 * de jogos de terceiros. A pessoa também pode enviar a própria imagem ou usar o banner do perfil.
 */
export const CALL_BANNER_PRESETS = [
  'cidade-neon',
  'tatico',
  'blocos',
  'arena',
  'tempestade',
  'corrida',
  'gramado',
  'espaco',
  'fantasia',
  'cyberpunk',
  'neblina',
  'faroeste',
  'fliperama',
] as const;

export type CallBannerPreset = (typeof CALL_BANNER_PRESETS)[number];
