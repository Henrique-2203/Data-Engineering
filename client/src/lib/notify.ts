import type { Message } from '../../../shared/types';
import { findChannel, selectChannel, useApp } from '../store/app';
import { useVoice } from '../store/voice';
import { playSound } from './sounds';

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
  if (!hidden && app.selectedChannelId === message.channelId) return;

  playSound('message');

  const { notifications } = useVoice.getState().settings;
  if (!hidden || !notifications || !notificationsSupported() || Notification.permission !== 'granted') return;
  const channel = findChannel(message.channelId);
  const guild = channel ? app.guilds[channel.guildId] : undefined;
  try {
    // Obs.: no Android o construtor Notification não é permitido (exige service worker) e lança erro.
    const n = new Notification(`${message.author.displayName} em #${channel?.name ?? 'canal'}`, {
      body: message.content.slice(0, 200),
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
