import { useEffect, useRef, useState } from 'react';
import { Laptop, Smartphone, SwitchCamera, VideoOff } from 'lucide-react';
import { api } from '../lib/api';
import { getSocket, onSocketReady } from '../lib/socket';
import { useHasFeature } from '../lib/layoutMode';
import { isMobile } from '../lib/install';
import { closeModal, openModal } from '../store/app';
import { useVoice } from '../store/voice';
import { PhoneLink } from '../voice/phonecam';
import { voice } from '../voice/engine';
import { Modal } from './Modals';
import type { RtcSignal } from '../../../shared/types';

/**
 * Câmera do celular como câmera do computador (em teste: só contas com o recurso "phonecam").
 * - No computador: o botão Câmera abre esta janela com a escolha e o QR Code.
 * - No celular: o QR Code abre /app?camera=… (mesma conta) e a tela PhoneCamera manda a imagem.
 */

/** Clique no botão Câmera da call: com o recurso e a câmera desligada, deixa escolher de onde vem a imagem. */
export function useCameraButton() {
  const feature = useHasFeature('phonecam');
  const camera = useVoice((s) => s.camera);
  return () => {
    // no celular/tablet a câmera "do celular" É a câmera deste aparelho: não faz sentido escolher nem mostrar QR Code
    if (feature && !camera && !isMobile()) openModal({ kind: 'camera' });
    else void voice.toggleCamera();
  };
}

export function CameraModal() {
  const [step, setStep] = useState<'choose' | 'phone'>('choose');
  const phone = useVoice((s) => s.phoneCam);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (step !== 'phone' || phone.status !== 'waiting' || !phone.expiresAt) return;
    const tick = () => setLeft(Math.max(0, Math.round((phone.expiresAt! - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [step, phone.status, phone.expiresAt]);
  // deu certo: fecha sozinho depois de mostrar o "Conectado"
  useEffect(() => {
    if (step === 'phone' && phone.status === 'connected') {
      const t = setTimeout(closeModal, 1400);
      return () => clearTimeout(t);
    }
  }, [step, phone.status]);
  // fechou a janela sem terminar: cancela o QR Code
  useEffect(
    () => () => {
      const st = useVoice.getState().phoneCam.status;
      if (st === 'waiting' || st === 'ended') voice.phoneCamCancel();
    },
    [],
  );

  function pickPc() {
    closeModal();
    void voice.toggleCamera();
  }
  function pickPhone() {
    setStep('phone');
    void voice.phoneCamStart();
  }

  const expired = phone.status === 'waiting' && !!phone.qrSvg && left === 0;
  return (
    <Modal title="Câmera">
      {step === 'choose' ? (
        <div className="cam-choose">
          <p className="muted">De onde vem a imagem da sua câmera?</p>
          <button type="button" className="cam-option" onClick={pickPc}>
            <Laptop size={26} aria-hidden />
            <span>
              <strong>Câmera do computador</strong>
              <span className="muted small">A câmera deste aparelho.</span>
            </span>
          </button>
          <button type="button" className="cam-option" onClick={pickPhone}>
            <Smartphone size={26} aria-hidden />
            <span>
              <strong>Câmera do celular</strong>
              <span className="muted small">Leia um QR Code com o celular e ele vira a sua câmera, sem instalar nada.</span>
            </span>
          </button>
        </div>
      ) : (
        <div className="cam-phone">
          {phone.status === 'connected' ? (
            <p className="cam-ok">Conectado ✅ O celular já é a sua câmera na call.</p>
          ) : phone.status === 'connecting' ? (
            <p className="muted">Celular encontrado. Conectando…</p>
          ) : phone.status === 'ended' ? (
            <>
              <p className="error">{phone.error ?? 'Não deu certo.'}</p>
              <button type="button" className="btn primary" onClick={() => void voice.phoneCamStart()}>
                Gerar QR Code novo
              </button>
            </>
          ) : phone.qrSvg ? (
            <>
              <ol className="cam-steps">
                <li>
                  Abra o <strong>Resenha no navegador do celular</strong>, com a <strong>mesma conta</strong> deste computador.
                </li>
                <li>Aponte a câmera do celular para o QR Code abaixo e abra o link.</li>
                <li>Permita a câmera quando o celular pedir.</li>
              </ol>
              <div className={`apoio-qr cam-qr${expired ? ' expired' : ''}`} role="img" aria-label="QR Code para o celular" dangerouslySetInnerHTML={{ __html: phone.qrSvg }} />
              {expired ? (
                <button type="button" className="btn primary" onClick={() => void voice.phoneCamStart()}>
                  O código expirou: gerar outro
                </button>
              ) : (
                <p className="muted small">
                  Aguardando o celular… o código vale mais {left}s. Sem câmera de QR? Abra este link no celular: <a href={phone.url} data-phonecam-link>{phone.url}</a>
                </p>
              )}
            </>
          ) : (
            <p className="muted">Gerando o QR Code…</p>
          )}
          {phone.status !== 'connected' && (
            <button type="button" className="btn ghost" onClick={() => (voice.phoneCamCancel(), setStep('choose'))}>
              Voltar
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}

type Phase = 'claiming' | 'asking' | 'live' | 'ended' | 'error';

/** Tela do celular: lê o QR Code (token na URL), abre a câmera e manda a imagem para o computador. */
export function PhoneCamera({ token, onExit }: { token: string; onExit(): void }) {
  const [phase, setPhase] = useState<Phase>('claiming');
  const [message, setMessage] = useState('');
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [linked, setLinked] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const live = useRef<{ link: PhoneLink; stream: MediaStream; sender: RTCRtpSender; pc: string } | null>(null);
  const wake = useRef<{ release(): Promise<void> } | null>(null);

  function finish(p: Phase, msg: string) {
    const l = live.current;
    live.current = null;
    l?.stream.getTracks().forEach((t) => t.stop());
    l?.link.close();
    void wake.current?.release().catch(() => {});
    wake.current = null;
    setMessage(msg);
    setPhase(p);
  }

  useEffect(() => {
    let cancelled = false;
    let unbind = () => {};
    const run = async (socket: ReturnType<typeof getSocket> & object) => {
      const res = await new Promise<{ ok: boolean; pc?: string; error?: string }>((resolve) => {
        const t = setTimeout(() => resolve({ ok: false, error: 'O servidor não respondeu.' }), 8000);
        socket.emit('phonecam:claim', { token }, (r: any) => (clearTimeout(t), resolve(r ?? { ok: false })));
      });
      if (cancelled) return;
      if (!res.ok || !res.pc) return finish('error', res.error ?? 'Não foi possível conectar.');
      setPhase('asking');
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: 'user' }, audio: false });
      } catch {
        socket.emit('phonecam:stop');
        return finish('error', 'Não foi possível abrir a câmera. Permita o acesso à câmera no navegador e leia o QR Code de novo.');
      }
      if (cancelled) return stream.getTracks().forEach((t) => t.stop());
      const ice = await api<{ iceServers: RTCIceServer[] }>('/ice').then((r) => r.iceServers, () => [] as RTCIceServer[]);
      const link = new PhoneLink(socket, res.pc, ice, {
        onState: (st) => {
          if (st === 'connected') setLinked(true);
          if (st === 'failed') {
            socket.emit('phonecam:stop');
            finish('error', 'A conexão com o computador falhou. Gere um QR Code novo.');
          }
        },
      });
      const onSignal = ({ from, data }: { from: string; data: RtcSignal }) => from === res.pc && void link.handle(data).catch(() => {});
      const onEnded = () => finish('ended', 'A câmera foi desligada no computador.');
      socket.on('phonecam:signal', onSignal);
      socket.on('phonecam:ended', onEnded);
      unbind = () => (socket.off('phonecam:signal', onSignal), socket.off('phonecam:ended', onEnded));
      const track = stream.getVideoTracks()[0];
      const sender = await link.offer(track, stream);
      live.current = { link, stream, sender, pc: res.pc };
      setPhase('live');
      // mantém a tela acesa enquanto a câmera está no ar
      try {
        wake.current = await (navigator as any).wakeLock?.request('screen');
      } catch {
        /* sem Wake Lock */
      }
    };
    // espera o tempo real conectar (a sessão já foi aberta pelo App)
    const s = getSocket();
    if (s?.connected) void run(s);
    else {
      const off = onSocketReady((sock) => {
        const go = () => void run(sock);
        if (sock.connected) go();
        else sock.once('connect', go);
        off();
      });
      unbind = off;
    }
    return () => {
      cancelled = true;
      unbind();
      const l = live.current;
      if (l) {
        getSocket()?.emit('phonecam:stop');
        l.stream.getTracks().forEach((t) => t.stop());
        l.link.close();
      }
    };
  }, [token]);

  useEffect(() => {
    if (video.current && live.current) video.current.srcObject = live.current.stream;
  }, [phase, facing]);

  /**
   * Abre a câmera de um lado (frontal/traseira). Muitos celulares Android NÃO deixam abrir a segunda câmera enquanto a primeira
   * ainda está aberta, e o "exact" é recusado em alguns aparelhos: tenta exact, depois ideal, depois sem exigência nenhuma.
   */
  async function openCamera(face: 'user' | 'environment'): Promise<MediaStream> {
    const base = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    const tries: MediaTrackConstraints[] = [{ ...base, facingMode: { exact: face } }, { ...base, facingMode: { ideal: face } }, { facingMode: face }];
    let last: unknown = null;
    for (const [i, video] of tries.entries()) {
      try {
        return await navigator.mediaDevices.getUserMedia({ video, audio: false });
      } catch (e) {
        last = e;
        // a câmera anterior pode demorar um instante para ser liberada pelo sistema
        if (i < tries.length - 1) await new Promise((r) => setTimeout(r, 250));
      }
    }
    throw last;
  }

  const flipping = useRef(false);
  const [flipBusy, setFlipBusy] = useState(false);
  async function flip() {
    const l = live.current;
    if (!l || flipping.current) return; // toques seguidos não empilham (várias aberturas ao mesmo tempo travavam a câmera)
    flipping.current = true;
    setFlipBusy(true);
    setMessage('');
    const next = facing === 'user' ? 'environment' : 'user';
    // libera a câmera atual ANTES de abrir a outra (celulares que só abrem uma por vez recusavam a segunda)
    l.stream.getTracks().forEach((t) => t.stop());
    let stream: MediaStream | null = null;
    let used: 'user' | 'environment' = next;
    try {
      stream = await openCamera(next);
    } catch {
      // não abriu a outra: volta para a que estava, para a imagem não ficar parada/preta
      try {
        stream = await openCamera(facing);
        used = facing;
        setMessage('Não foi possível virar a câmera. Continuamos na mesma.');
      } catch {
        setMessage('A câmera parou de responder. Toque em Parar e leia o QR Code de novo.');
      }
    }
    if (stream) {
      try {
        await l.sender.replaceTrack(stream.getVideoTracks()[0]);
        live.current = { ...l, stream };
        if (video.current) video.current.srcObject = stream; // direto: se continuou na mesma, o efeito de "facing" não roda
        setFacing(used);
      } catch {
        stream.getTracks().forEach((t) => t.stop());
        setMessage('Não foi possível trocar a câmera. Toque em Parar e leia o QR Code de novo.');
      }
    }
    flipping.current = false;
    setFlipBusy(false);
  }
  function stop() {
    getSocket()?.emit('phonecam:stop');
    finish('ended', 'Você parou a câmera do celular.');
  }

  return (
    <div className="phonecam">
      <header>
        <img src="/icon.svg" alt="" width={28} height={28} /> <strong>Câmera do celular</strong>
      </header>
      {phase === 'live' ? (
        <>
          <video ref={video} className={`phonecam-video${facing === 'user' ? ' mirror' : ''}`} autoPlay playsInline muted />
          <p className={`phonecam-status${linked ? ' ok' : ''}`}>{linked ? '🟢 No ar: esta é a sua câmera na call do computador' : 'Conectando ao computador…'}</p>
          {message && <p className="muted small">{message}</p>}
          <div className="phonecam-actions">
            <button type="button" className="btn" disabled={flipBusy} onClick={() => void flip()}>
              <SwitchCamera size={18} /> Virar câmera
            </button>
            <button type="button" className="btn danger" onClick={stop}>
              <VideoOff size={18} /> Parar
            </button>
          </div>
        </>
      ) : phase === 'claiming' || phase === 'asking' ? (
        <p className="muted">{phase === 'claiming' ? 'Conectando ao computador…' : 'Permita o acesso à câmera…'}</p>
      ) : (
        <>
          <p className={phase === 'error' ? 'error' : ''}>{message}</p>
          <button type="button" className="btn primary" onClick={onExit}>
            Abrir o Resenha
          </button>
        </>
      )}
    </div>
  );
}
