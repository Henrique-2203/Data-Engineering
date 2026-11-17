import { useApp, findChannel } from '../store/app';
import { useVoice } from '../store/voice';
import { voice } from '../voice/engine';

/**
 * App Android do Resenha (android/): o site roda dentro do app, que expõe window.ResenhaAndroid.
 * Ao entrar numa call, o app liga a notificação "Você está numa call", que mantém o microfone e o som vivos
 * com o celular bloqueado ou em outro app. "Sair da call" na notificação chega aqui como 'resenha:native-leave'.
 */
interface AndroidBridge {
  callStarted(title: string): void;
  callEnded(): void;
  version(): string;
  versionCode(): number;
  checkUpdate(): void;
}
const bridge = (): AndroidBridge | undefined => (window as Window & { ResenhaAndroid?: AndroidBridge }).ResenhaAndroid;

export const isAndroidApp = () => !!bridge() || /ResenhaAndroid\//.test(navigator.userAgent);
export const androidAppVersion = () => {
  try {
    return bridge()?.version() ?? null;
  } catch {
    return null;
  }
};
export const checkAndroidUpdate = () => bridge()?.checkUpdate();

export function initAndroidApp() {
  const b = bridge();
  if (!b) return;
  let inCall = false;
  const title = () => {
    const v = useVoice.getState();
    const ch = findChannel(v.channelId);
    const g = v.guildId ? useApp.getState().guilds[v.guildId] : undefined;
    return ch ? (g ? `${ch.name} · ${g.name}` : ch.name) : 'Toque para voltar à call';
  };
  useVoice.subscribe((s, prev) => {
    try {
      if (s.status === 'connected' && (!inCall || s.channelId !== prev.channelId)) {
        inCall = true;
        b.callStarted(title());
      } else if (s.status === 'idle' && inCall) {
        inCall = false;
        b.callEnded();
      }
    } catch {}
  });
  window.addEventListener('resenha:native-leave', () => voice.leave());
}
