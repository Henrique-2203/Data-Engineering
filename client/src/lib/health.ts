import { useVoice } from '../store/voice';
import { peerDiag, snapshot, type Snap } from '../voice/diagnostics';
import { voice } from '../voice/engine';

/**
 * Saúde das calls: números ANÔNIMOS de qualidade (somados por dia no servidor, sem dizer de quem
 * ou de qual call), para a equipe enxergar problemas antes de alguém reclamar. A cada minuto de call:
 * atraso e perda da voz, FPS da transmissão, quanto passou pelo TURN; e os erros do site.
 * Desliga em Configurações → Privacidade e dados.
 */
type Metric =
  | 'conn_ok'
  | 'conn_fail'
  | 'conn_ms'
  | 'resume'
  | 'voice_samples'
  | 'voice_rtt'
  | 'voice_loss'
  | 'voice_bad'
  | 'relayed_samples'
  | 'turn_mb'
  | 'stream_samples'
  | 'stream_capture'
  | 'stream_sent'
  | 'stream_viewer'
  | 'stream_ok40'
  | 'stream_turbo'
  | 'stream_encode_ms'
  | 'stream_light'
  | 'watch_samples'
  | 'watch_fps'
  | 'watch_low';

const OFF_KEY = 'resenha.healthOff';
export function healthEnabled() {
  try {
    return localStorage.getItem(OFF_KEY) !== '1';
  } catch {
    return true;
  }
}
export function setHealthEnabled(on: boolean) {
  try {
    if (on) localStorage.removeItem(OFF_KEY);
    else localStorage.setItem(OFF_KEY, '1');
  } catch {
    /* sem armazenamento */
  }
}

let acc: Partial<Record<Metric, { sum: number; count: number }>> = {};
let errors: { message: string; version?: string }[] = [];
const seenErrors = new Set<string>();
let sentErrors = 0;

function add(m: Metric, value = 1, count = 1) {
  if (!healthEnabled() || !Number.isFinite(value)) return;
  const cur = (acc[m] ??= { sum: 0, count: 0 });
  cur.sum += Math.max(0, value);
  cur.count += count;
}

/** Manda o que juntou (a cada minuto e ao fechar a página). Falha calada: nunca atrapalha o app. */
export function flushHealth(final = false) {
  if (!healthEnabled()) {
    acc = {};
    errors = [];
    return;
  }
  if (!Object.keys(acc).length && !errors.length) return;
  const body = JSON.stringify({ metrics: acc, errors });
  acc = {};
  errors = [];
  void fetch('/api/telemetry/call-health', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    credentials: 'same-origin',
    keepalive: final,
  }).catch(() => {});
}

// ---------- conexões ----------

const peers = new Map<string, { created: number; done: boolean; timer: ReturnType<typeof setTimeout> }>();

/** Conexão nova com alguém da call (conta como falha se não conectar em 20 s). */
export function healthPeerCreated(id: string) {
  const timer = setTimeout(() => healthPeerState(id, 'failed'), 20_000);
  peers.set(id, { created: performance.now(), done: false, timer });
}

export function healthPeerState(id: string, state: RTCPeerConnectionState) {
  const p = peers.get(id);
  if (!p || p.done) return;
  if (state === 'connected') {
    p.done = true;
    clearTimeout(p.timer);
    add('conn_ok');
    add('conn_ms', performance.now() - p.created);
  } else if (state === 'failed') {
    p.done = true;
    clearTimeout(p.timer);
    add('conn_fail');
  }
}

export function healthPeerClosed(id: string) {
  const p = peers.get(id);
  if (p) clearTimeout(p.timer);
  peers.delete(id);
}

/** O servidor reiniciou (atualização) e a call continuou. */
export const healthResume = () => add('resume');

// ---------- amostras de 1 minuto durante a call ----------

let sampler: ReturnType<typeof setInterval> | null = null;
/** a conexão escolhida usa um servidor TURN do MEU lado (candidato local do tipo "relay")? */
export function usesOwnRelay(snap: Snap) {
  let own: boolean | null = null;
  snap.forEach((r) => {
    if (r.type !== 'transport' || !r.selectedCandidatePairId) return;
    const pair = snap.get(r.selectedCandidatePairId);
    const local = pair && snap.get(pair.localCandidateId);
    if (local?.candidateType) own = local.candidateType === 'relay';
  });
  // sem as informações da conexão (navegador antigo): conta, como antes
  return own ?? true;
}

let prev = new Map<string, { snap: Snap; at: number }>();

async function sample() {
  const v = useVoice.getState();
  if (v.status === 'idle' || !healthEnabled()) return;
  const now = performance.now();
  const next = new Map<string, { snap: Snap; at: number }>();
  for (const p of voice.diagnosticPeers()) {
    const snap = await snapshot(p.pc);
    next.set(p.socketId, { snap, at: now });
    const before = prev.get(p.socketId);
    if (!before || p.pc.connectionState !== 'connected') continue;
    const secs = (now - before.at) / 1000;
    const d = peerDiag('', p.pc.connectionState, p.relayed, before.snap, snap, secs);
    add('voice_samples');
    if (d.rttMs !== null) add('voice_rtt', d.rttMs);
    if (d.voiceIn) {
      add('voice_loss', d.voiceIn.lossPct);
      if (d.voiceIn.lossPct >= 5 || d.voiceIn.concealedPct >= 5) add('voice_bad');
    }
    if (p.relayed) {
      add('relayed_samples');
      // tráfego que passou pelo TURN neste minuto (cota do provedor de TURN). Só conta quem usa o TURN
      // pelo próprio lado: se só o outro aparelho precisa do TURN, o tráfego é o mesmo e já é contado
      // por ele (antes os dois lados contavam e o total saía em dobro).
      if (usesOwnRelay(snap)) {
        let bytes = 0;
        snap.forEach((r) => {
          if (r.type !== 'transport') return;
          const a = before.snap.get(r.id) ?? {};
          bytes += (r.bytesSent ?? 0) - (a.bytesSent ?? 0) + (r.bytesReceived ?? 0) - (a.bytesReceived ?? 0);
        });
        add('turn_mb', Math.max(0, bytes) / 1e6, 0);
      }
    }
    // transmissão que estou assistindo desta pessoa
    if (v.watching[p.socketId]) {
      const t = voice.turboRecvStats(p.socketId);
      let fps = t?.fps ?? null;
      if (fps === null) {
        snap.forEach((r) => {
          if (r.type === 'inbound-rtp' && r.kind === 'video' && r.framesPerSecond !== undefined) fps = Math.max(fps ?? 0, r.framesPerSecond);
        });
      }
      if (fps !== null) {
        add('watch_samples');
        add('watch_fps', fps);
        if (fps < 30) add('watch_low');
      }
    }
  }
  prev = next;

  // minha transmissão
  if (v.screen) {
    const st = await voice.screenSendStats();
    if (st && st.fps) {
      const info = voice.streamInfo;
      add('stream_samples');
      add('stream_capture', st.captureFps);
      add('stream_sent', st.fps);
      if (st.viewerFps !== undefined) add('stream_viewer', st.viewerFps);
      if ((st.viewerFps ?? st.fps) >= 40) add('stream_ok40');
      if (st.turbo) add('stream_turbo');
      if (st.encodeMs !== undefined) add('stream_encode_ms', st.encodeMs);
      if (info.lightLevel > 0) add('stream_light');
    }
  }
  flushHealth();
}

export function startHealthSampler() {
  if (sampler) return;
  prev = new Map();
  // (os testes automáticos encurtam o intervalo; no uso normal é 1 minuto)
  let every = 60_000;
  try {
    every = Number(localStorage.getItem('resenha.healthEveryMs')) || 60_000;
  } catch {
    /* padrão */
  }
  sampler = setInterval(() => void sample().catch(() => {}), every);
}

export function stopHealthSampler() {
  if (sampler) clearInterval(sampler);
  sampler = null;
  prev = new Map();
  flushHealth();
}

// ---------- erros do site ----------

let version: string | undefined;
export function initHealth() {
  void fetch('/api/version')
    .then((r) => r.json())
    .then((j: { version?: string }) => (version = j.version))
    .catch(() => {});
  const onError = (message: string) => {
    if (!healthEnabled() || !message || sentErrors >= 30) return;
    const key = message.slice(0, 200);
    if (seenErrors.has(key)) return;
    seenErrors.add(key);
    sentErrors++;
    errors.push({ message: key, version });
    if (errors.length >= 10) flushHealth();
  };
  window.addEventListener('error', (e) => onError(`${e.message || 'erro'}${e.filename ? ` @${e.filename.split('/').pop()}:${e.lineno}` : ''}`));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string; name?: string } | undefined;
    // erros esperados (sem internet, permissão negada) não contam
    if (r?.name === 'AbortError' || r?.name === 'NotAllowedError') return;
    onError(`Promise: ${r?.message ?? String(e.reason)}`);
  });
  window.addEventListener('pagehide', () => flushHealth(true));
  setInterval(() => flushHealth(), 120_000);
}
