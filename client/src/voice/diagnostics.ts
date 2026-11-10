import { useApp, findChannel, findMember } from '../store/app';
import { useVoice } from '../store/voice';
import { desktop } from '../lib/desktop';
import { voice } from './engine';
import { screenPresetFor } from './settings';

/**
 * Diagnóstico da call ("Relatar problema da call"): mede a chamada por alguns segundos e junta só
 * NÚMEROS — qualidade da conexão com cada pessoa, da voz e da transmissão, e o aparelho. Nunca vai
 * áudio, vídeo, mensagens ou endereço IP. A pessoa vê tudo antes de mandar.
 */
export interface PeerDiag {
  name: string;
  state: string;
  /** passa pelo servidor TURN (sem conexão direta) */
  relayed: boolean;
  rttMs: number | null;
  /** banda de envio que o navegador estima para esta pessoa */
  outKbps: number | null;
  voiceIn: { lossPct: number; jitterMs: number; concealedPct: number; kbps: number } | null;
}

export interface CallDiagnostics {
  v: 1;
  at: string;
  measuredMs: number;
  app: { site: string | null; desktop: string | null; browser: string; os: string; cores: number | null; memoryGb: number | null; gpu: string | null; screen: string };
  call: {
    kind: 'servidor' | 'conversa direta';
    people: number;
    muted: boolean;
    deafened: boolean;
    inputMode: string;
    noise: string | null;
    vadThresholdDb: number;
  };
  peers: PeerDiag[];
  /** minha transmissão (se estou transmitindo) */
  stream: null | {
    turbo: boolean;
    performanceMode: boolean;
    lightLevel: number;
    targetFps: number;
    captureFps: number;
    sentFps: number;
    width: number;
    height: number;
    codec: string;
    encodeMs: number | null;
    limitedBy: string;
    viewers: number;
    viewerFps: number | null;
    mbps: number | null;
  };
  /** transmissões que estou assistindo */
  watching: { name: string; turbo: boolean; fps: number; width: number; height: number; lossPct: number | null; freezes: number | null; mbps: number | null }[];
  /** últimos eventos da conexão (sem dados pessoais) */
  log: string[];
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

function browserInfo() {
  const ua = navigator.userAgent;
  const browser = /Edg\/(\d+)/.exec(ua)
    ? `Edge ${/Edg\/(\d+)/.exec(ua)![1]}`
    : /OPR\/(\d+)/.exec(ua)
      ? `Opera ${/OPR\/(\d+)/.exec(ua)![1]}`
      : /Firefox\/(\d+)/.exec(ua)
        ? `Firefox ${/Firefox\/(\d+)/.exec(ua)![1]}`
        : /Chrome\/(\d+)/.exec(ua)
          ? `${desktop ? 'Electron/Chrome' : 'Chrome'} ${/Chrome\/(\d+)/.exec(ua)![1]}`
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'outro';
  const os = /Windows NT 10/.test(ua) ? 'Windows 10/11' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'outro';
  return { browser, os };
}

/** Nome da placa de vídeo (o navegador já entrega simplificado). */
function gpuName(): string | null {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    return name.slice(0, 120) || null;
  } catch {
    return null;
  }
}

/** Remove qualquer coisa parecida com endereço IP dos eventos. */
const noIps = (line: string) => line.replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, '[ip]').replace(/\b[0-9a-f]{1,4}(:[0-9a-f]{0,4}){3,7}\b/gi, '[ip]');

export type Snap = Map<string, Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function snapshot(pc: RTCPeerConnection): Promise<Snap> {
  const out: Snap = new Map();
  try {
    (await pc.getStats()).forEach((r) => out.set(r.id, r));
  } catch {
    /* conexão fechando */
  }
  return out;
}

export function peerDiag(name: string, state: string, relayed: boolean, a: Snap, b: Snap, secs: number): PeerDiag {
  let rttMs: number | null = null;
  let outKbps: number | null = null;
  b.forEach((r) => {
    if (r.type === 'transport' && r.selectedCandidatePairId) {
      const pair = b.get(r.selectedCandidatePairId);
      if (pair?.currentRoundTripTime !== undefined) rttMs = Math.round(pair.currentRoundTripTime * 1000);
      if (pair?.availableOutgoingBitrate !== undefined) outKbps = Math.round(pair.availableOutgoingBitrate / 1000);
    }
  });
  if (rttMs === null) {
    b.forEach((r) => {
      if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded' && r.currentRoundTripTime !== undefined) rttMs = Math.round(r.currentRoundTripTime * 1000);
    });
  }
  let voiceIn: PeerDiag['voiceIn'] = null;
  b.forEach((r) => {
    if (r.type !== 'inbound-rtp' || r.kind !== 'audio') return;
    const p = a.get(r.id) ?? {};
    const recv = (r.packetsReceived ?? 0) - (p.packetsReceived ?? 0);
    const lost = Math.max(0, (r.packetsLost ?? 0) - (p.packetsLost ?? 0));
    const samples = (r.totalSamplesReceived ?? 0) - (p.totalSamplesReceived ?? 0);
    const concealed = (r.concealedSamples ?? 0) - (p.concealedSamples ?? 0);
    const kbps = (((r.bytesReceived ?? 0) - (p.bytesReceived ?? 0)) * 8) / secs / 1000;
    // a voz de microfone (a do áudio da transmissão também chega como áudio: fica com a de maior tráfego)
    if (!voiceIn || kbps > voiceIn.kbps) {
      voiceIn = {
        lossPct: recv + lost > 0 ? round((lost / (recv + lost)) * 100) : 0,
        jitterMs: Math.round((r.jitter ?? 0) * 1000),
        concealedPct: samples > 0 ? round((concealed / samples) * 100) : 0,
        kbps: Math.round(kbps),
      };
    }
  });
  return { name, state, relayed, rttMs, outKbps, voiceIn };
}

/** Mede a call por `ms` milissegundos e monta o relatório. */
export async function collectDiagnostics(ms = 5000): Promise<CallDiagnostics> {
  const v = useVoice.getState();
  const app = useApp.getState();
  const channel = v.channelId ? findChannel(v.channelId) : undefined;
  const guildId = channel && channel.type !== 'dm' ? channel.guildId : null;
  const peers = voice.diagnosticPeers();
  const first = await Promise.all(peers.map((p) => snapshot(p.pc)));
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, ms));
  const second = await Promise.all(peers.map((p) => snapshot(p.pc)));
  const secs = (performance.now() - t0) / 1000;
  const nameOf = (userId: string) => findMember(guildId, userId)?.displayName ?? 'alguém';

  const peerDiags = peers.map((p, i) => peerDiag(nameOf(p.userId), p.pc.connectionState, p.relayed, first[i], second[i], secs));

  // transmissões que estou assistindo
  const watching: CallDiagnostics['watching'] = [];
  for (const [i, p] of peers.entries()) {
    if (!v.watching[p.socketId]) continue;
    const t = voice.turboRecvStats(p.socketId);
    if (t) {
      watching.push({ name: nameOf(p.userId), turbo: true, fps: t.fps, width: t.width, height: t.height, lossPct: null, freezes: null, mbps: round(t.mbps) });
      continue;
    }
    second[i].forEach((r) => {
      if (r.type !== 'inbound-rtp' || r.kind !== 'video') return;
      const a = first[i].get(r.id) ?? {};
      const recv = (r.packetsReceived ?? 0) - (a.packetsReceived ?? 0);
      const lost = Math.max(0, (r.packetsLost ?? 0) - (a.packetsLost ?? 0));
      watching.push({
        name: nameOf(p.userId),
        turbo: false,
        fps: Math.round(r.framesPerSecond ?? 0),
        width: r.frameWidth ?? 0,
        height: r.frameHeight ?? 0,
        lossPct: recv + lost > 0 ? round((lost / (recv + lost)) * 100) : 0,
        freezes: (r.freezeCount ?? 0) - (a.freezeCount ?? 0),
        mbps: round((((r.bytesReceived ?? 0) - (a.bytesReceived ?? 0)) * 8) / secs / 1e6),
      });
    });
  }

  // minha transmissão
  let stream: CallDiagnostics['stream'] = null;
  if (v.screen) {
    const st = await voice.screenSendStats();
    const info = voice.streamInfo;
    stream = {
      turbo: !!st?.turbo,
      performanceMode: v.settings.performanceMode,
      lightLevel: info.lightLevel,
      targetFps: info.target?.fps ?? screenPresetFor(v.settings).fps,
      captureFps: Math.round(st?.captureFps ?? 0),
      sentFps: Math.round(st?.fps ?? 0),
      width: st?.width ?? 0,
      height: st?.height ?? 0,
      codec: st?.codec ?? '',
      encodeMs: st?.encodeMs ?? null,
      limitedBy: st?.limitedBy ?? 'none',
      viewers: voice.uploadPeers,
      viewerFps: st?.viewerFps ?? null,
      mbps: st?.mbps !== undefined ? round(st.mbps) : null,
    };
  }

  const desk = desktop ? await desktop.getSettings().catch(() => null) : null;
  const site = await fetch('/api/version', { cache: 'no-store' })
    .then((r) => r.json())
    .then((j: { version?: string }) => j.version ?? null)
    .catch(() => null);
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    v: 1,
    at: new Date().toISOString(),
    measuredMs: Math.round(secs * 1000),
    app: {
      site,
      desktop: desk?.version ?? null,
      ...browserInfo(),
      cores: navigator.hardwareConcurrency ?? null,
      memoryGb: nav.deviceMemory ?? null,
      gpu: gpuName(),
      screen: `${screen.width}×${screen.height}`,
    },
    call: {
      kind: channel?.type === 'dm' ? 'conversa direta' : 'servidor',
      people: Object.values(app.voiceStates).filter((s) => s.channelId === v.channelId).length,
      muted: v.muted,
      deafened: v.deafened,
      inputMode: v.settings.inputMode === 'ptt' ? 'aperte para falar' : 'ativação por voz',
      noise: v.noiseActive,
      vadThresholdDb: v.settings.vadThresholdDb,
    },
    peers: peerDiags,
    stream,
    watching,
    log: voice.debugLog.slice(-60).map(noIps),
  };
}

export interface Finding {
  level: 'ok' | 'warn' | 'bad';
  text: string;
}

/**
 * O que os números indicam, em português simples (aparece para quem relata e para a equipe).
 * Os limites são os usados no resto do app: 40 FPS de transmissão, 5% de perda, 250 ms de atraso.
 */
export function explain(d: CallDiagnostics): Finding[] {
  const out: Finding[] = [];
  for (const p of d.peers) {
    if (p.state !== 'connected') out.push({ level: 'bad', text: `Sem conexão com ${p.name} (${p.state}). Saia e entre na call de novo.` });
    if (p.relayed) out.push({ level: 'warn', text: `Com ${p.name} a conexão passa pelo servidor TURN (sem caminho direto, comum no 4G/5G): voz e tela vão em qualidade reduzida.` });
    if (p.rttMs !== null && p.rttMs > 250) out.push({ level: 'warn', text: `Atraso alto com ${p.name}: ${p.rttMs} ms (o ideal é abaixo de 150 ms).` });
    if (p.voiceIn) {
      if (p.voiceIn.lossPct >= 5) out.push({ level: 'bad', text: `A voz de ${p.name} está chegando com ${p.voiceIn.lossPct}% de perda: a internet de alguém de vocês está instável (Wi-Fi fraco?).` });
      else if (p.voiceIn.concealedPct >= 5) out.push({ level: 'warn', text: `A voz de ${p.name} está sendo "remendada" (${p.voiceIn.concealedPct}% do tempo): pode soar robótica ou picotada.` });
    }
  }
  const s = d.stream;
  if (s) {
    if (s.captureFps > 0 && s.captureFps < Math.min(40, s.targetFps) * 0.9)
      out.push({
        level: 'bad',
        text: `A captura da tela está em ${s.captureFps} FPS: o gargalo é capturar a imagem do jogo. Deixe o jogo em "janela sem bordas" e use o app de Windows (ele dá prioridade de placa de vídeo para a captura).`,
      });
    else if (s.sentFps > 0 && s.sentFps < Math.min(s.captureFps, s.targetFps) * 0.85)
      out.push({ level: 'warn', text: `O codificador não acompanha a captura (${s.captureFps} → ${s.sentFps} FPS${s.encodeMs ? `, ${s.encodeMs} ms por quadro` : ''}). Deixe o "Modo desempenho" ligado (ele baixa a resolução e mantém o FPS).` });
    if (s.limitedBy === 'bandwidth') out.push({ level: 'warn', text: 'A internet de alguém que assiste (ou o seu upload) não está acompanhando a transmissão.' });
    if (!s.turbo && s.viewers > 1) out.push({ level: 'warn', text: 'A transmissão não está no modo turbo: cada amigo assistindo é uma codificação a mais no seu PC.' });
    if (s.viewerFps !== null && s.viewerFps > 0 && s.viewerFps < 40) out.push({ level: 'warn', text: `Na tela de quem assiste a transmissão está em ${s.viewerFps} FPS.` });
  }
  for (const w of d.watching) {
    if (w.fps > 0 && w.fps < 30) out.push({ level: 'warn', text: `A transmissão de ${w.name} está chegando em ${w.fps} FPS para você.` });
    if (w.lossPct !== null && w.lossPct >= 3) out.push({ level: 'warn', text: `A tela de ${w.name} chega com ${w.lossPct}% de perda (internet instável).` });
  }
  if (d.call.noise === 'off') out.push({ level: 'warn', text: 'A supressão de ruído está desligada: teclado e ventilador vão para a call.' });
  if (!out.length) out.push({ level: 'ok', text: 'Nada fora do normal nos números deste momento. Conte na mensagem o que aconteceu (e quando) para a equipe olhar.' });
  return out;
}
