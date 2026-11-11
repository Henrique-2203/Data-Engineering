import { setAppearance, useAppearance } from '../lib/appearance';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { desktop, type DesktopUpdate } from '../lib/desktop';
import { useVoice } from '../store/voice';
import { voice } from '../voice/engine';
import { getSocket, onSocketReady } from '../lib/socket';
import { findChannel, findMember, useApp } from '../store/app';

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

    // "Jogando agora" / "Ouvindo agora": o app detecta o jogo e a música do Spotify; o site repassa
    // ao servidor (se a pessoa permitir). Com jogo aberto, o jogo aparece no lugar da música.
    let game: string | null = null;
    let music: { track: string; artist: string } | null = null;
    const publish = () => {
      const { shareActivity, shareMusic } = useVoice.getState().settings;
      if (shareActivity && game) getSocket()?.emit('activity:set', { name: game, kind: 'game' });
      else if (shareMusic && music) getSocket()?.emit('activity:set', { name: music.track, kind: 'music', details: music.artist });
      else getSocket()?.emit('activity:set', { name: null });
    };
    const offMusic = d.onMusic?.((m) => {
      music = m;
      publish();
    });
    void d.getMusic?.().then((m) => {
      music = m;
      publish();
    });
    const offActivity = d.onActivity?.((a) => {
      game = a.name;
      publish();
    });
    void d.getActivity?.().then((a) => {
      game = a.name;
      publish();
    });
    const offReady = onSocketReady(() => publish()); // reconectou: o servidor esqueceu
    const unsubShare = useVoice.subscribe((s, prev) => {
      if (s.settings.shareActivity !== prev.settings.shareActivity || s.settings.shareMusic !== prev.settings.shareMusic) publish();
    });
    void d.getSettings().then((s) => {
      setUpdate(s.update);
      // o app guarda o ícone escolhido: a tela de Aparência mostra o mesmo
      if (d.setAppIcon && s.appIconId && s.appIconId !== useAppearance.getState().icon) setAppearance({ icon: s.appIconId });
    });

    // overlay no jogo: quem está na chamada, quem fala, quem está mutado/transmitindo
    let overlayTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSent = '';
    const sendOverlay = () => {
      overlayTimer = null;
      if (!d.setOverlayState) return;
      const v = useVoice.getState();
      const app = useApp.getState();
      const inCall = v.status !== 'idle' && !!v.channelId;
      const channel = inCall ? findChannel(v.channelId!) : null;
      const people = inCall
        ? Object.values(app.voiceStates)
            .filter((p) => p.channelId === v.channelId)
            .map((p) => {
              const me = p.socketId === app.socketId;
              const m = findMember(p.guildId, p.userId);
              return {
                id: p.socketId,
                name: m?.displayName ?? 'Alguém',
                color: m?.avatarColor ?? '#555',
                avatar: m?.avatarId ? `${location.origin}/api/images/${m.avatarId}` : null,
                speaking: !p.muted && !p.deafened && !!(me ? v.speaking.me : v.speaking[p.socketId]),
                muted: p.muted,
                deafened: p.deafened,
                streaming: !!p.screen,
                me,
              };
            })
        : [];
      const state = { inCall, channel: channel?.name ?? '', people };
      const json = JSON.stringify(state);
      if (json === lastSent) return;
      lastSent = json;
      d.setOverlayState(state);
    };
    // no máximo ~8 atualizações por segundo (quem fala muda o tempo todo)
    const queueOverlay = () => {
      overlayTimer ??= setTimeout(sendOverlay, 120);
    };
    const unsubOverlayVoice = useVoice.subscribe(queueOverlay);
    const unsubOverlayApp = useApp.subscribe((s, prev) => {
      if (s.voiceStates !== prev.voiceStates || s.socketId !== prev.socketId) queueOverlay();
    });
    queueOverlay();

    return () => {
      unsubVoice();
      offKey();
      offTray();
      offUpdate();
      offActivity?.();
      offMusic?.();
      offReady();
      unsubShare();
      unsubOverlayVoice();
      unsubOverlayApp();
      if (overlayTimer) clearTimeout(overlayTimer);
      d.setOverlayState?.({ inCall: false, channel: '', people: [] });
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
