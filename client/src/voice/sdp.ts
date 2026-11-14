/**
 * Ajustes na SDP recebida do outro participante (aplicados antes de setRemoteDescription):
 *  - Opus em estéreo e com bitrate alto (áudio da transmissão com qualidade de música);
 *  - x-google-start-bitrate para o Chrome começar o vídeo já em alta qualidade
 *    em vez de subir devagar a partir de ~300 kbps.
 * Navegadores que não conhecem esses parâmetros simplesmente os ignoram.
 */
const VIDEO_CODECS = new Set(['VP8', 'VP9', 'H264', 'AV1']);

/** `opusKbps`: qualidade de voz do canal (32-510 kbps). */
export function tuneRemoteSdp(sdp: string, startBitrateKbps = 4000, opusKbps = 128): string {
  const lines = sdp.split('\r\n');
  const codecByPt = new Map<string, string>();
  for (const line of lines) {
    const m = /^a=rtpmap:(\d+) ([\w-]+)\//.exec(line);
    if (m) codecByPt.set(m[1], m[2].toUpperCase());
  }

  const hasFmtp = new Set<string>();
  const out = lines.map((line) => {
    const m = /^a=fmtp:(\d+) (.*)$/.exec(line);
    if (!m) return line;
    const [, pt, params] = m;
    hasFmtp.add(pt);
    const codec = codecByPt.get(pt);
    if (codec === 'OPUS') {
      return `a=fmtp:${pt} ${addParams(params, { stereo: '1', 'sprop-stereo': '1', maxaveragebitrate: String(opusKbps * 1000) })}`;
    }
    if (codec && VIDEO_CODECS.has(codec)) {
      return `a=fmtp:${pt} ${addParams(params, { 'x-google-start-bitrate': String(startBitrateKbps) })}`;
    }
    return line;
  });

  // Codecs de vídeo sem linha fmtp (ex.: VP8) ganham uma logo após o rtpmap.
  const result: string[] = [];
  for (const line of out) {
    result.push(line);
    const m = /^a=rtpmap:(\d+) ([\w-]+)\//.exec(line);
    if (m && !hasFmtp.has(m[1]) && VIDEO_CODECS.has(m[2].toUpperCase())) {
      result.push(`a=fmtp:${m[1]} x-google-start-bitrate=${startBitrateKbps}`);
    }
  }
  return result.join('\r\n');
}

function addParams(params: string, add: Record<string, string>): string {
  const existing = new Set(params.split(';').map((p) => p.split('=')[0].trim().toLowerCase()));
  const extra = Object.entries(add)
    .filter(([k]) => !existing.has(k.toLowerCase()))
    .map(([k, v]) => `${k}=${v}`);
  return extra.length ? `${params};${extra.join(';')}` : params;
}

/** Coloca o codec preferido na frente da lista de negociação do transceiver. */
export function preferCodec(transceiver: RTCRtpTransceiver, mime: string) {
  if (typeof transceiver.setCodecPreferences !== 'function') return;
  const caps = RTCRtpReceiver.getCapabilities?.('video');
  if (!caps) return;
  const wanted = caps.codecs.filter((c) => c.mimeType.toLowerCase() === mime.toLowerCase());
  if (!wanted.length) return; // navegador não suporta: deixa o padrão
  const rest = caps.codecs.filter((c) => c.mimeType.toLowerCase() !== mime.toLowerCase());
  try {
    transceiver.setCodecPreferences([...wanted, ...rest]);
  } catch (err) {
    console.warn('setCodecPreferences falhou', err);
  }
}
