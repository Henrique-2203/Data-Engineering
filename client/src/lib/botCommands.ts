import type { BotCommandInfo } from '../../../shared/types';
import { api } from './api';

/** Comandos do bot de cada servidor (guardados por 30 s para o "/" abrir na hora). */
const cache = new Map<string, { at: number; list: BotCommandInfo[] }>();

export async function loadCommands(guildId: string): Promise<BotCommandInfo[]> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < 30_000) return hit.list;
  const list = await api<{ commands: BotCommandInfo[] }>(`/guilds/${guildId}/commands`).then((r) => r.commands, () => []);
  cache.set(guildId, { at: Date.now(), list });
  return list;
}

/** instalou, removeu ou ligou/desligou um comando: a lista antiga não vale mais */
export const clearCommands = (guildId: string) => void cache.delete(guildId);
