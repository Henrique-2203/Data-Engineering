import { useEffect } from 'react';
import { useVoice } from '../store/voice';
import { voice } from '../voice/engine';
import { isDesktop } from '../lib/desktop';

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/** Código do botão do mouse no mesmo formato da tecla salva (Mouse1 = meio, Mouse3/4 = laterais). */
export const mouseCode = (button: number) => `Mouse${button}`;

/**
 * Atalhos globais da página:
 *  - push-to-talk (tecla ou botão lateral do mouse configurável)
 *  - Ctrl+Shift+M silencia, Ctrl+Shift+D desativa o áudio
 * Funcionam enquanto a aba do Resenha está em foco (limite dos navegadores).
 */
export function Hotkeys() {
  useEffect(() => {
    // no app de desktop os atalhos vêm do hook global (DesktopBridge), inclusive com a janela em foco
    if (isDesktop) return;
    const inCall = () => useVoice.getState().status !== 'idle';
    const ptt = () => {
      const s = useVoice.getState().settings;
      return s.inputMode === 'ptt' ? s.pttKey : null;
    };
    // durante a gravação de uma tecla nova nas configurações, os atalhos ficam pausados
    const binding = () => document.body.dataset.bindingKey === '1';

    const onKeyDown = (e: KeyboardEvent) => {
      if (binding()) return;
      if (e.ctrlKey && e.shiftKey && !e.altKey && (e.code === 'KeyM' || e.code === 'KeyD')) {
        e.preventDefault();
        const v = useVoice.getState();
        if (e.code === 'KeyM') voice.setMuted(!v.muted);
        else voice.setDeafened(!v.deafened);
        return;
      }
      if (inCall() && e.code === ptt() && !isTyping(e.target)) {
        e.preventDefault();
        voice.setPtt(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === ptt()) voice.setPtt(false);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (binding()) return;
      if (inCall() && mouseCode(e.button) === ptt()) {
        e.preventDefault(); // impede o "voltar/avançar" do navegador nos botões laterais
        voice.setPtt(true);
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (mouseCode(e.button) === ptt()) {
        e.preventDefault();
        voice.setPtt(false);
      }
    };
    // se a janela perder o foco com a tecla apertada, não deixa o microfone "preso" aberto
    const release = () => voice.setPtt(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', release);
    };
  }, []);
  return null;
}
