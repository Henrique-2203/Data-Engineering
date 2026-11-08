import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { desktop, type DesktopUpdate } from '../lib/desktop';
import { useVoice } from '../store/voice';
import { voice } from '../voice/engine';

/**
 * Liga o site aos recursos do app de desktop: atalhos globais (push-to-talk com o jogo em
 * primeiro plano), menu do ícone da bandeja e aviso de atualização pronta.
 * No navegador comum não faz nada.
 */
export function DesktopBridge() {
  const [update, setUpdate] = useState<DesktopUpdate | null>(null);

  useEffect(() => {
    if (!desktop) return;
    const d = desktop;

    // quais teclas o hook global deve observar
    const syncKeys = () => {
      const s = useVoice.getState().settings;
      d.setGlobalKeys({ ptt: s.inputMode === 'ptt' ? s.pttKey : null });
    };
    // estado do menu da bandeja
    const syncTray = () => {
      const v = useVoice.getState();
      d.setTrayState({ muted: v.muted, deafened: v.deafened, inCall: v.status !== 'idle' });
    };
    syncKeys();
    syncTray();
    const unsubVoice = useVoice.subscribe((s, prev) => {
      if (s.settings.inputMode !== prev.settings.inputMode || s.settings.pttKey !== prev.settings.pttKey) syncKeys();
      if (s.muted !== prev.muted || s.deafened !== prev.deafened || s.status !== prev.status) syncTray();
    });

    const offKey = d.onGlobalKey((e) => {
      const v = useVoice.getState();
      if (e.type === 'ptt-down' || e.type === 'ptt-up') {
        if (v.status !== 'idle') voice.setPtt(e.type === 'ptt-down');
      } else if (e.type === 'toggle-mute') {
        voice.setMuted(!v.muted);
      } else if (e.type === 'toggle-deafen') {
        voice.setDeafened(!v.deafened);
      }
    });
    const offTray = d.onTrayAction((action) => {
      const v = useVoice.getState();
      if (action === 'toggle-mute') voice.setMuted(!v.muted);
      else if (action === 'toggle-deafen') voice.setDeafened(!v.deafened);
      else if (action === 'leave-call') voice.leave();
    });
    const offUpdate = d.onUpdate(setUpdate);
    void d.getSettings().then((s) => setUpdate(s.update));

    return () => {
      unsubVoice();
      offKey();
      offTray();
      offUpdate();
    };
  }, []);

  if (!desktop || update?.state !== 'ready') return null;
  return (
    <div className="update-banner" role="status">
      <RefreshCw size={16} />
      <span>Nova versão do app ({update.version}) pronta.</span>
      <button className="btn small primary" onClick={() => desktop!.installUpdate()}>
        Reiniciar e atualizar
      </button>
    </div>
  );
}
