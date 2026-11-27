import { useApp, findChannel, findMember } from '../store/app';
import { useVoice } from '../store/voice';
import { desktop } from '../lib/desktop';
import { voice } from './engine';
import { screenPresetFor } from './settings';
import { type Stat, isNum, stat } from './limits';
import { FALLBACK_TEXT, type TransportEvent } from './transport';

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
    /** taxa do microfone (Hz) e se o nome parece de fone Bluetooth (o nome em si não vai) */
    micRate?: number | null;
    bluetoothMic?: boolean;
    /** quanto o filtro de ruído ficou atrás do tempo real (%): alto = voz picotada para os outros */
    denoiseSlowPct?: number | null;
  };
  peers: PeerDiag[];
  /**
   * minha transmissão (se estou transmitindo).
   * `null` = NÃO medido; `0` = medido e deu zero. Relatórios antigos (antes desta versão) não têm os campos opcionais
   * e traziam 0 no lugar de "não medido".
   */
  stream: null | {
    turbo: boolean;
    performanceMode: boolean;
    lightLevel: number;
    /** por que a resolução baixou (modo desempenho), se baixou */
    lightReason?: string | null;
    targetFps: number;
    captureFps: number | null;
    sentFps: number | null;
    width: number | null;
    height: number | null;
    codec: string;
    /** latência entrada→saída do codificador (não é só tempo de processamento; nome mantido por compatibilidade) */
    encodeMs: number | null;
    limitedBy: string;
    viewers: number;
    viewerFps: number | null;
    mbps: number | null;
    /** true = placa de vídeo pedida/aceita... false = foi PRECISO usar software; null = o navegador não informa */
    hardware?: boolean | null;
    /** de onde vem a imagem (monitor, janela ou aba) e o tamanho da faixa capturada antes de qualquer redução */
    source?: { kind: string | null; width: number | null; height: number | null };
    /** onde o FPS escolhido ficou para trás, com a evidência (só afirma o que foi medido) */
    limit?: { where: string; evidence: string };
    /** a janela inteira da medição (não só a última amostra) */
    window?: {
      samples: number;
      configuredFps: number | null;
      captureFps: Stat | null;
      encodeFps: Stat | null;
      encoderLatencyMs: Stat | null;
      encoderBusyPerSec: Stat | null;
      encodeQueueMax: Stat | null;
      viewerShownFps: Stat | null;
      netDrops: number;
    };
    /** transporte de cada pessoa que assiste (turbo ou WebRTC) */
    transport?: { viewer: string; mode: string; state: string; reason: string | null; codec: string | null; rtcVideo: boolean; rtcAudio: boolean; bufferedBytes: number | null; shownFps: number | null }[];
  };
  /** transmissões que estou assistindo */
  watching: {
    name: string;
    turbo: boolean;
    /** FPS apresentado (média da janela); null = sem medida */
    fps: number | null;
    width: number;
    height: number;
    lossPct: number | null;
    freezes: number | null;
    mbps: number | null;
    /** transporte desta transmissão e o motivo de um fallback */
    transport?: { mode: string; state: string; reason: string | null };
    /** recebido pelo canal / decodificado / apresentado (turbo, média da janela) e a janela completa do FPS apresentado */
    receivedFps?: number | null;
    decodedFps?: number | null;
    presentedFps?: Stat | null;
    frameIntervalMs?: { avg: number; max: number } | null;
    freezeMs?: number | null;
    /** quadros descartados na janela, por motivo */
    dropped?: Record<string, number>;
    /** como o som da transmissão é capturado no PC de quem transmite ('old' = app antigo, não informa) */
    audio?: 'clean' | 'system' | 'tab' | 'none' | 'old' | 'off';
  }[];
  /** últimos eventos da conexão (sem dados pessoais) */
  log: string[];
  /** eventos estruturados do transporte da transmissão (turbo/WebRTC), sem IP, token, mensagem, áudio ou imagem */
  transportEvents?: { tMs: number; ev: string; viewer: string | null; detail?: Record<string, string | number | boolean | null> }[];
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
    const vs = app.voiceStates[p.socketId];
    const audio = vs?.screenAudioOff ? 'off' : (vs?.screenAudioMode ?? 'old');
    const t = voice.turboRecvStats(p.socketId);
    if (t) {
      // a janela inteira da medição (o receptor mede sozinho a cada segundo), não só a última amostra
      const win = voice.turboRecvHistory(p.socketId, ms + 1500);
      const presented = stat(win.map((x) => x.presentedFps));
      const drop: Record<string, number> = {};
      for (const x of win) for (const [k, n] of Object.entries(x.dropped)) drop[k] = (drop[k] ?? 0) + n;
      watching.push({
        name: nameOf(p.userId),
        turbo: true,
        fps: presented ? Math.round(presented.avg) : null,
        width: t.width,
        height: t.height,
        lossPct: null,
        freezes: win.reduce((a, x) => a + x.freezes, 0),
        freezeMs: win.reduce((a, x) => a + x.freezeMs, 0),
        mbps: stat(win.map((x) => x.mbps))?.avg ?? round(t.mbps),
        transport: voice.watchTransport(p.socketId),
        receivedFps: stat(win.map((x) => x.receivedFps))?.avg ?? null,
        decodedFps: stat(win.map((x) => x.decodedFps))?.avg ?? null,
        presentedFps: presented,
        frameIntervalMs: win.length ? { avg: round(win.reduce((a, x) => a + (x.frameIntervalMs?.avg ?? 0), 0) / win.length), max: Math.max(...win.map((x) => x.frameIntervalMs?.max ?? 0)) } : null,
        dropped: drop,
        audio,
      });
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
        transport: voice.watchTransport(p.socketId),
        fps: isNum(r.framesPerSecond) ? Math.round(r.framesPerSecond) : null,
        width: r.frameWidth ?? 0,
        height: r.frameHeight ?? 0,
        lossPct: recv + lost > 0 ? round((lost / (recv + lost)) * 100) : 0,
        freezes: (r.freezeCount ?? 0) - (a.freezeCount ?? 0),
        mbps: round((((r.bytesReceived ?? 0) - (a.bytesReceived ?? 0)) * 8) / secs / 1e6),
        audio,
      });
    });
  }

  // minha transmissão
  let stream: CallDiagnostics['stream'] = null;
  if (v.screen) {
    const st = await voice.screenSendStats();
    const info = voice.streamInfo;
    const src = voice.captureSource;
    // janela da medição inteira (o transmissor mede 1x por segundo): média, mínimo, máximo e quantos zeros
    const win = voice.turboSendHistory(ms + 1500);
    const raw = st?.raw;
    const snap = voice.transportSnapshot();
    const ordinal = new Map(snap.map((x, i) => [x.id, `espectador ${i + 1}`]));
    const shownById = new Map((raw?.viewers ?? []).map((x) => [x.id.slice(0, 6), x.shownFps]));
    stream = {
      turbo: !!st?.turbo,
      performanceMode: v.settings.performanceMode,
      lightLevel: info.lightLevel,
      lightReason: info.lightReason,
      targetFps: info.target?.fps ?? screenPresetFor(v.settings).fps,
      captureFps: isNum(st?.captureFps) ? Math.round(st!.captureFps!) : null,
      sentFps: isNum(st?.fps) ? Math.round(st!.fps!) : null,
      width: st?.width ?? null,
      height: st?.height ?? null,
      codec: st?.codec ?? '',
      encodeMs: isNum(st?.encodeMs) ? st!.encodeMs! : null,
      limitedBy: st?.limitedBy ?? 'none',
      viewers: voice.uploadPeers,
      viewerFps: isNum(st?.viewerFps) ? st!.viewerFps! : null,
      mbps: st?.mbps !== undefined ? round(st.mbps) : null,
      hardware: st ? st.hardware : null,
      source: src ? { kind: src.kind, width: src.width, height: src.height } : undefined,
      limit: st?.limit,
      window: win.length
        ? {
            samples: win.length,
            configuredFps: win[win.length - 1].configuredFps,
            captureFps: stat(win.map((x) => x.captureFps)),
            encodeFps: stat(win.map((x) => x.encodeFps)),
            encoderLatencyMs: stat(win.map((x) => x.encoderLatencyMs)),
            encoderBusyPerSec: stat(win.map((x) => x.dropped.encoderBusy)),
            encodeQueueMax: stat(win.map((x) => x.encodeQueueMax)),
            viewerShownFps: stat(win.flatMap((x) => x.viewers.map((y) => y.shownFps))),
            netDrops: win.reduce((a, x) => a + x.viewers.reduce((b, y) => b + y.netDrops, 0), 0),
          }
        : undefined,
      transport: snap.map((x) => ({ viewer: ordinal.get(x.id)!, mode: x.mode, state: x.state, reason: x.reason, codec: x.codec, rtcVideo: x.rtcVideo, rtcAudio: x.rtcAudio, bufferedBytes: x.bufferedBytes, shownFps: shownById.get(x.id) ?? null })),
    };
  }
  const ordinalAll = new Map(voice.transportSnapshot().map((x, i) => [x.id, `espectador ${i + 1}`]));
  const t0ev = Date.now();
  const transportEvents = voice.transportEvents.slice(-60).map((e: TransportEvent) => ({ tMs: e.at - t0ev, ev: e.ev, viewer: e.peer ? (ordinalAll.get(e.peer) ?? 'outro') : null, ...(e.detail ? { detail: Object.fromEntries(Object.entries(e.detail).map(([k, x]) => [k, typeof x === 'string' ? noIps(x) : x])) } : {}) }));

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
      micRate: voice.micInfo?.sampleRate ?? null,
      bluetoothMic: voice.micInfo?.bluetooth ?? false,
      denoiseSlowPct: voice.denoiseSlowPct(),
    },
    peers: peerDiags,
    stream,
    watching,
    log: voice.debugLog.slice(-60).map(noIps),
    transportEvents,
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
  const brave = /brave/i.test(d.app.gpu ?? '');
  for (const p of d.peers) {
    if (p.state !== 'connected') {
      out.push({ level: 'bad', text: `Sem conexão com ${p.name} (${p.state}). Saia e entre na call de novo.` });
      if (p.relayed) out.push({ level: 'warn', text: `A conexão com ${p.name} estava passando pelo servidor TURN (sem caminho direto) quando caiu: é o caso mais frágil, comum no 4G/5G e em navegadores que escondem dados de rede.` });
      continue; // com a conexão caída, perda/atraso/voz remendada são só consequência: não mostrar como causa
    }
    if (p.relayed) out.push({ level: 'warn', text: `Com ${p.name} a conexão passa pelo servidor TURN (sem caminho direto, comum no 4G/5G): voz e tela vão em qualidade reduzida.` });
    if (p.rttMs !== null && p.rttMs > 250) out.push({ level: 'warn', text: `Atraso alto com ${p.name}: ${p.rttMs} ms (o ideal é abaixo de 150 ms).` });
    if (p.voiceIn) {
      if (p.voiceIn.lossPct >= 5) out.push({ level: 'bad', text: `A voz de ${p.name} está chegando com ${p.voiceIn.lossPct}% de perda: a internet de alguém de vocês está instável (Wi-Fi fraco?).` });
      else if (p.voiceIn.concealedPct >= 5) out.push({ level: 'warn', text: `A voz de ${p.name} está sendo "remendada" (${p.voiceIn.concealedPct}% do tempo): pode soar robótica ou picotada.` });
    }
  }
  if (brave && d.peers.some((p) => p.relayed || p.state !== 'connected'))
    out.push({
      level: 'warn',
      text: 'O navegador parece ser o Brave. Os "Shields" dele escondem dados de rede e podem forçar a call pelo servidor TURN e derrubar a conexão. Clique no leão na barra de endereço e desligue os Shields para o Resenha (ou use Chrome, Edge ou o app de Windows). Obs.: o Brave também mascara núcleos e memória, então esses números do aparelho podem não ser os reais.',
    });
  const s = d.stream;
  if (s) {
    if (s.limit) {
      // relatório novo: só afirma uma causa quando há medida que a sustente
      const ev = s.limit.evidence;
      if (s.limit.where === 'capture')
        out.push({
          level: 'bad',
          text: `A captura da tela está em ${s.captureFps ?? '?'} FPS (${ev}): o gargalo é capturar a imagem. Deixe o jogo em "janela sem bordas" e use o app de Windows (ele dá prioridade de placa de vídeo para a captura). Tela parada ou menu também geram FPS baixo na captura.`,
        });
      else if (s.limit.where === 'encoder')
        out.push({
          level: 'warn',
          text: `O codificador não acompanha a captura (${ev}${isNum(s.encodeMs) ? `; latência do codificador ${s.encodeMs} ms` : ''}). ${s.hardware === false ? 'Ele está rodando no processador (nenhuma placa de vídeo aceitou a configuração). ' : ''}Deixe o "Modo desempenho" ligado (ele baixa a resolução e mantém o FPS).`,
        });
      else if (s.limit.where === 'transport') out.push({ level: 'warn', text: `A fila de envio de alguém que assiste encheu (${ev}): pode ser a internet dessa pessoa ou o seu upload.` });
      else if (s.limit.where === 'receiver') out.push({ level: 'warn', text: `Quem assiste mostra menos quadros do que você envia (${ev}).` });
      else if (s.limit.where === 'unknown' && s.sentFps !== null && s.sentFps < Math.min(40, s.targetFps) * 0.85)
        out.push({ level: 'warn', text: `O FPS ficou abaixo do alvo (${s.sentFps} FPS enviados), mas faltam medidas para apontar a causa (${ev}). Meça de novo com alguém assistindo.` });
      if (s.lightLevel && s.lightReason) out.push({ level: 'ok', text: `A resolução foi reduzida pelo Modo desempenho (motivo: ${s.lightReason}).` });
    } else {
      // relatório antigo (sem `limit`): as contas de antes, sem tratar "não medido" como zero
      if (s.captureFps !== null && s.captureFps > 0 && s.captureFps < Math.min(40, s.targetFps) * 0.9)
        out.push({
          level: 'bad',
          text: `A captura da tela está em ${s.captureFps} FPS: o gargalo é capturar a imagem do jogo. Deixe o jogo em "janela sem bordas" e use o app de Windows (ele dá prioridade de placa de vídeo para a captura).`,
        });
      else if (s.sentFps !== null && s.captureFps !== null && s.sentFps > 0 && s.sentFps < Math.min(s.captureFps, s.targetFps) * 0.85)
        out.push({ level: 'warn', text: `O codificador não acompanha a captura (${s.captureFps} → ${s.sentFps} FPS${s.encodeMs ? `, ${s.encodeMs} ms de latência do codificador` : ''}). Deixe o "Modo desempenho" ligado (ele baixa a resolução e mantém o FPS).` });
      if (s.limitedBy === 'bandwidth') out.push({ level: 'warn', text: 'A internet de alguém que assiste (ou o seu upload) não está acompanhando a transmissão.' });
    }
    if (s.window?.viewerShownFps && s.window.viewerShownFps.zero > 0)
      out.push({ level: 'bad', text: `Quem assiste chegou a mostrar 0 FPS (${s.window.viewerShownFps.zero} de ${s.window.viewerShownFps.n} medidas): a imagem congelou para ela.` });
    if (s.transport?.length) {
      for (const t of s.transport) {
        if (t.state === 'fallback') out.push({ level: t.reason === 'sender-disabled' || t.reason === 'viewer-disabled' ? 'ok' : 'warn', text: `${t.viewer} recebe pela transmissão normal (WebRTC), não pelo turbo: ${FALLBACK_TEXT[t.reason ?? ''] ?? t.reason ?? 'motivo não registrado'}.` });
        else if (t.state === 'recovering') out.push({ level: 'warn', text: `O canal turbo de ${t.viewer} caiu e está sendo refeito.` });
        if (t.mode === 'turbo' && t.rtcVideo) out.push({ level: 'bad', text: `${t.viewer} está recebendo vídeo pelos DOIS caminhos (turbo e WebRTC): isso dobra a carga no seu PC.` });
      }
    } else if (!s.turbo && s.viewers > 1) out.push({ level: 'warn', text: 'A transmissão não está no modo turbo: cada amigo assistindo é uma codificação a mais no seu PC.' });
    if (s.viewerFps !== null && s.viewerFps > 0 && s.viewerFps < 40) out.push({ level: 'warn', text: `Na tela de quem assiste a transmissão está em ${s.viewerFps} FPS.` });
  }
  for (const w of d.watching) {
    if (w.fps !== null && w.fps === 0) out.push({ level: 'bad', text: `A transmissão de ${w.name} está parada para você (0 FPS apresentados na medição).` });
    else if (w.fps !== null && w.fps < 30) out.push({ level: 'warn', text: `A transmissão de ${w.name} está chegando em ${w.fps} FPS para você.` });
    if (w.freezes) out.push({ level: 'warn', text: `A transmissão de ${w.name} travou ${w.freezes} vez(es)${w.freezeMs ? ` (${Math.round(w.freezeMs)} ms no total)` : ''} durante a medição.` });
    if (w.transport?.state === 'fallback' && w.transport.reason) out.push({ level: 'ok', text: `Você assiste ${w.name} pela transmissão normal (WebRTC): ${FALLBACK_TEXT[w.transport.reason] ?? w.transport.reason}.` });
    if (w.lossPct !== null && w.lossPct >= 3) out.push({ level: 'warn', text: `A tela de ${w.name} chega com ${w.lossPct}% de perda (internet instável).` });
    if (w.audio === 'old')
      out.push({
        level: 'warn',
        text: `${w.name} está transmitindo com um app antigo (ou um navegador que não separa o som): o "som do computador" leva junto a voz da call, e por isso você ouve a sua própria voz de volta. Peça para ${w.name} atualizar o app de Windows para a versão 0.3.9 ou mais nova (Configurações → Atalhos e app → Procurar atualizações).`,
      });
    if (w.audio === 'system')
      out.push({
        level: 'warn',
        text: `A transmissão de ${w.name} manda o som do PC inteiro, com a voz da call junto (por isso o eco). Se ${w.name} usa o app de Windows 0.3.9, o Windows dele é antigo demais para separar: precisa do Windows 10 versão 2004 ou mais novo. No navegador, transmita uma aba em vez da tela inteira, ou use o app.`,
      });
  }
  if ((d.call.denoiseSlowPct ?? 0) >= 3)
    out.push({
      level: 'bad',
      text: `O aparelho não está dando conta da supressão de ruído (o áudio está ${d.call.denoiseSlowPct}% atrasado): é isso que deixa a SUA voz picotada ou robótica para os outros. Em Configurações → Voz e vídeo, escolha a supressão "Leve (IA)" ou "Básica" e feche abas e programas pesados.`,
    });
  if (d.call.bluetoothMic)
    out.push({
      level: 'warn',
      text: 'O microfone é de um fone Bluetooth (AirPods ou parecido). Quando o microfone do fone liga, o Bluetooth troca para um modo de baixa qualidade e a voz fica robótica, para você e para os outros. Use o microfone do computador (Configurações → Voz e vídeo → Microfone) e deixe o fone só para ouvir.',
    });
  if (d.call.noise === 'off') out.push({ level: 'warn', text: 'A supressão de ruído está desligada: teclado e ventilador vão para a call.' });
  if (!d.peers.length && d.call.people <= 1)
    out.push({ level: 'warn', text: 'Você estava sozinho na call na hora da medição, então não deu para medir a voz de ninguém. Meça de novo com outra pessoa na call, no momento em que o problema acontecer.' });
  if (!out.length) out.push({ level: 'ok', text: 'Nada fora do normal nos números deste momento. Conte na mensagem o que aconteceu (e quando) para a equipe olhar.' });
  return out;
}
