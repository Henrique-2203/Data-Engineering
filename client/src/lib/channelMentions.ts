import { findChannel, useApp } from '../store/app';

/**
 * Marcar canais no chat (#canal): na mensagem vai `<#id>` (não quebra se o canal mudar de nome) e aparece
 * como "#nome" clicável. Na caixa de texto e na edição a pessoa vê e digita "#nome".
 */
export const CHANNEL_TOKEN = /<#([0-9a-f-]{8,64})>/gi;

/** "#nome" (de um canal do servidor) vira `<#id>`. Nomes mais longos primeiro ("call 1" antes de "call"). */
export function encodeChannels(text: string, guildId?: string | null): string {
  if (!guildId || !text.includes('#')) return text;
  const g = useApp.getState().guilds[guildId];
  if (!g) return text;
  const chans = [...g.channels].filter((c) => c.type !== 'dm').sort((a, b) => b.name.length - a.name.length);
  let out = text;
  for (const c of chans) {
    const esc = c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(^|[\\s(])#${esc}(?![\\p{L}\\p{N}_-])`, 'giu'), (_m, pre: string) => `${pre}<#${c.id}>`);
  }
  return out;
}

/** `<#id>` volta a ser "#nome" (para editar, copiar e prévias). */
export function plainChannels(text: string): string {
  return text.replace(CHANNEL_TOKEN, (_m, id: string) => `#${findChannel(id)?.name ?? 'canal'}`);
}
