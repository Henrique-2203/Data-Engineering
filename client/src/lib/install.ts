import { isDesktop } from './desktop';

/**
 * "Instalar o app" no celular (e no PC) sem loja e sem baixar arquivo: o Resenha vira um app com ícone
 * na tela inicial que abre em tela cheia. Como ele abre o próprio site, está sempre na versão mais nova.
 *  - Android/Chrome/Edge: o navegador avisa que dá para instalar (beforeinstallprompt) e mostramos o pedido;
 *  - iPhone/iPad: o Safari não tem esse aviso; mostramos o passo a passo (Compartilhar → Tela de Início).
 */
type PromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let deferred: PromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

export function initInstall() {
  if (typeof window === 'undefined' || isDesktop) return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as PromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
  // o service worker (o mesmo das notificações) também deixa o site "instalável"
  if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
}

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
export const isMobile = () => /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) || isIos();
export const canPrompt = () => !!deferred;
export function onInstallChange(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}
/** Mostra o pedido de instalação do navegador. Devolve true se a pessoa instalou. */
export async function promptInstall() {
  if (!deferred) return false;
  const d = deferred;
  deferred = null;
  await d.prompt();
  const { outcome } = await d.userChoice;
  notify();
  return outcome === 'accepted';
}
