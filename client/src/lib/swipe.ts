import { useEffect } from 'react';
import { findChannel, useApp } from '../store/app';

/**
 * Celular: arrastar a tela para o lado, como no Discord.
 *  - No chat: arrastar para a direita mostra os servidores e canais; para a esquerda, quem está no canal.
 *  - Nos canais: arrastar para a esquerda volta para o chat.
 *  - Na lista de membros: arrastar para a direita volta para o chat.
 * O painel acompanha o dedo; soltando depois de ~1/4 da tela (ou rápido) ele abre, senão volta.
 */
const MOBILE = '(max-width: 900px)';
/** onde arrastar para o lado é do próprio conteúdo (rolar fileiras, digitar, janelas, vídeo) */
const IGNORE =
  'input, textarea, select, [contenteditable], .format-bar, .home-online-row, .strip, .emoji-picker, .sticker-picker, .composer-picker, .attach-menu, .modal-backdrop, .msg-sheet-backdrop, .lp-modal, .together, .yt-player, .tile.screen, [data-no-swipe]';

export function useMobileSwipe() {
  useEffect(() => {
    const mq = window.matchMedia(MOBILE);
    let start: { x: number; y: number; t: number } | null = null;
    let mode: 'none' | 'decide' | 'drag' = 'none';
    let target: HTMLElement | null = null;
    let kind: 'openNav' | 'closeNav' | 'openMembers' | 'closeMembers' | null = null;
    let dx = 0;

    const membersEl = () => document.querySelector<HTMLElement>('.layout .side-panel') ?? document.querySelector<HTMLElement>('.layout .members');
    const canMembers = () => {
      const s = useApp.getState();
      const c = findChannel(s.selectedChannelId);
      return !!c && c.type === 'text';
    };

    const reset = (el: HTMLElement | null) => {
      if (!el) return;
      el.style.transition = '';
      el.style.transform = '';
    };

    const onStart = (e: TouchEvent) => {
      if (!mq.matches || e.touches.length !== 1 || useApp.getState().modal) return;
      const el = e.target as Element | null;
      if (el?.closest(IGNORE)) return;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, t: Date.now() };
      mode = 'decide';
      dx = 0;
    };

    const onMove = (e: TouchEvent) => {
      if (!start || mode === 'none') return;
      const t = e.touches[0];
      const x = t.clientX - start.x;
      const y = t.clientY - start.y;
      if (mode === 'decide') {
        if (Math.abs(x) < 12 && Math.abs(y) < 12) return;
        // rolando a tela para cima/baixo: não é gesto
        if (Math.abs(x) < Math.abs(y) * 1.4) {
          mode = 'none';
          return;
        }
        const panel = useApp.getState().mobilePanel;
        kind = null;
        if (panel === 'main' && x > 0) kind = 'openNav';
        else if (panel === 'main' && x < 0 && canMembers()) kind = 'openMembers';
        else if (panel === 'nav' && x < 0) kind = 'closeNav';
        else if (panel === 'members' && x > 0) kind = 'closeMembers';
        if (!kind) {
          mode = 'none';
          return;
        }
        if (kind === 'openMembers') {
          // a lista de membros só existe na tela quando está ligada
          if (!useApp.getState().showMembers) useApp.setState({ showMembers: true });
        }
        target = kind === 'openNav' || kind === 'closeNav' ? document.querySelector<HTMLElement>('.layout .nav-drawer') : membersEl();
        mode = 'drag';
      }
      if (mode !== 'drag') return;
      dx = x;
      target ??= kind === 'openMembers' || kind === 'closeMembers' ? membersEl() : null;
      if (!target) return;
      const w = target.offsetWidth || window.innerWidth;
      let off: number; // posição do painel em px (0 = aberto)
      if (kind === 'openNav') off = Math.min(0, -w + Math.max(0, x));
      else if (kind === 'closeNav') off = Math.min(0, x);
      else if (kind === 'openMembers') off = Math.max(0, w + Math.min(0, x));
      else off = Math.max(0, x);
      target.style.transition = 'none';
      target.style.transform = `translateX(${off}px)`;
    };

    const onEnd = () => {
      if (mode === 'drag' && kind && start) {
        const w = target?.offsetWidth || window.innerWidth;
        const fast = Math.abs(dx) / Math.max(1, Date.now() - start.t) > 0.5;
        const done = Math.abs(dx) > w * 0.25 || (fast && Math.abs(dx) > 40);
        const el = target;
        if (el) {
          el.style.transition = '';
          // deixa o React aplicar a classe nova e só então solta o estilo do arrasto
          requestAnimationFrame(() => reset(el));
        }
        if (done) {
          if (kind === 'openNav') useApp.setState({ mobilePanel: 'nav' });
          else if (kind === 'openMembers') useApp.setState({ mobilePanel: 'members' });
          else useApp.setState({ mobilePanel: 'main' });
          navigator.vibrate?.(8);
        }
      }
      start = null;
      mode = 'none';
      target = null;
      kind = null;
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, []);
}
