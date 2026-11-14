import { api } from './api';
import { isDesktop } from './desktop';

/**
 * Notificações no celular (web push): o navegador guarda uma "inscrição" e o servidor manda
 * avisos de mensagens diretas, menções e eventos mesmo com o Resenha fechado.
 * O conteúdo vai criptografado de ponta a ponta até o aparelho (padrão Web Push).
 */
const FLAG = 'resenha.push';

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    !isDesktop && // o app de Windows já mostra as notificações dele
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** iPhone/iPad só recebe notificações com o Resenha adicionado à Tela de Início. */
export function needsHomeScreen() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

/** Este navegador está inscrito (as notificações vêm pelo service worker, não pela página). */
export function pushActive() {
  try {
    return localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

function setFlag(on: boolean) {
  try {
    if (on) localStorage.setItem(FLAG, '1');
    else localStorage.removeItem(FLAG);
  } catch {
    /* sem armazenamento: tudo bem */
  }
}

let registration: Promise<ServiceWorkerRegistration> | null = null;
export function registerServiceWorker() {
  if (!pushSupported()) return null;
  registration ??= navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return registration;
}

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function enablePush(): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) return { ok: false, error: 'Este navegador não recebe notificações.' };
  if (needsHomeScreen()) return { ok: false, error: 'No iPhone, adicione o Resenha à Tela de Início e abra por lá para ligar as notificações.' };
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (permission !== 'granted') return { ok: false, error: 'As notificações estão bloqueadas. Libere nas permissões do site.' };
  try {
    const reg = await registerServiceWorker()!;
    const { key } = await api<{ key: string }>('/push/key');
    let sub = await reg.pushManager.getSubscription();
    // a chave do servidor mudou: refaz a inscrição
    if (sub && sub.options.applicationServerKey) {
      const current = btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      if (current !== key) {
        await sub.unsubscribe();
        sub = null;
      }
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
    await api('/push/subscribe', { body: sub.toJSON() });
    setFlag(true);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'Não foi possível ligar as notificações.' };
  }
}

export async function disablePush() {
  setFlag(false);
  try {
    const reg = await registerServiceWorker();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api('/push/unsubscribe', { body: { endpoint: sub.endpoint } }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch {
    /* já estava desligado */
  }
}

/** Ao abrir o site: renova a inscrição (o navegador pode trocá-la) e escuta cliques nas notificações. */
export function initPush(openChannel: (channelId: string) => void) {
  if (!pushSupported()) return;
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'resenha:open-channel' && typeof e.data.channelId === 'string') openChannel(e.data.channelId);
  });
  if (pushActive() && Notification.permission === 'granted') void enablePush();
  else if (pushActive()) setFlag(false);
}
