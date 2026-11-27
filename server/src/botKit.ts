import type { z } from 'zod';
import type { Db } from './db.ts';
import type { Realtime } from './realtime.ts';
import { HttpError } from './http.ts';
import type { pollSchema } from './community.ts';
import type { BotEmbed, PublicUser } from '../../shared/types.ts';

/** Peças comuns dos comandos do Resenha Bot (ficam aqui para cada grupo de comandos ter o seu arquivo). */
export const BOT_COLOR = '#3ddc97';

export const embed = (title: string, description: string, fields?: BotEmbed['fields']): BotEmbed => ({ title, description, color: BOT_COLOR, ...(fields ? { fields } : {}) });
export const bad = (msg: string) => new HttpError(400, msg);

export interface Reply {
  content?: string;
  embed?: BotEmbed;
  poll?: z.infer<typeof pollSchema>;
  /** criados pelo comando que o bot posta já pronto (ex.: avisos) */
  silent?: boolean;
}

export interface Ctx {
  db: Db;
  rt: Realtime;
  args: string;
  user: PublicUser;
  channel: { id: string; guildId: string; name: string };
  /** posta uma mensagem do bot em outro canal do servidor (ex.: dentro do ticket que acabou de abrir) */
  postTo(channelId: string, reply: Reply): Promise<void>;
  /** permissões da pessoa no servidor */
  perms: number;
  isOwner: boolean;
  /** o servidor ligou os comandos de IA */
  aiEnabled: boolean;
  /** comandos ligados neste servidor (para /ajuda) */
  enabled: { name: string; description: string; usage: string }[];
}

export interface BotCommand {
  name: string;
  /** grupo na tela Integrações */
  group: string;
  /** manda texto para um serviço de IA externo: só roda se o servidor ligar a IA em Integrações */
  ai?: boolean;
  description: string;
  usage: string;
  run(ctx: Ctx): Promise<Reply> | Reply;
}
