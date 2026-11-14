import type { Message } from '../../../shared/types';
import { findChannel, selectChannel, useApp } from '../store/app';
import { useVoice } from '../store/voice';
import { playSound } from './sounds';
import { mentionsUser } from './mentions';
import { plainEmojis } from './expressions';
import { pushActive } from './push';

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

/** Som e notificação para mensagens que chegam fora do canal que você está vendo. */
export function onIncomingMessage(message: Message) {
  const app = useApp.getState();
  if (message.author.id === app.me?.id) return;
  const hidden = document.visibilityState !== 'visible';
  const channel = findChannel(message.channelId);
  const mentioned = !!app.me && channel?.type !== 'dm' && mentionsUser(message.content, app.me.username, message.mentionEveryone);
  // menção toca mesmo com o canal aberto, se a aba estiver escondida
  if (!hidden && app.selectedChannelId === message.channelId) return;

  playSound(mentioned ? 'mention' : 'message');

  const { notifications } = useVoice.getState().settings;
  if (!hidden || !notifications || !notificationsSupported() || Notification.permission !== 'granted') return;
  // DMs e menções chegam pelo celular/service worker quando ele está ligado: evita aviso dobrado
  if (pushActive() && (channel?.type === 'dm' || mentioned)) return;
  const guild = channel ? app.guilds[channel.guildId] : undefined;
  const title =
    channel?.type === 'dm'
      ? `Mensagem de ${message.author.displayName}`
      : mentioned
        ? `${message.author.displayName} mencionou você em #${channel?.name ?? 'canal'}`
        : `${message.author.displayName} em #${channel?.name ?? 'canal'}`;
  const body = plainEmojis(message.content) || (message.attachments.length
      ? ({ image: '📷 Foto', video: '🎬 Vídeo', audio: '🎵 Áudio', file: '📎 Arquivo' } as const)[message.attachments[0].kind ?? 'image']
      : message.sticker ? `Figurinha: ${message.sticker.name}` : '');
  try {
    // Obs.: no Android o construtor Notification não é permitido (exige service worker) e lança erro.
    const n = new Notification(title, {
      body: body.slice(0, 200),
      icon: '/icon.svg',
      tag: message.channelId,
      ...(guild ? { data: guild.id } : {}),
    });
    n.onclick = () => {
      window.focus();
      selectChannel(message.channelId);
      n.close();
    };
  } catch {
    /* sem suporte: o som já avisou */
  }
}
