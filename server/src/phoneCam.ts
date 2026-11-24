import { randomBytes } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import QRCode from 'qrcode';
import type { Db } from './db.ts';
import { betaFeaturesFor } from './beta.ts';
import { limit } from './security.ts';
import type { PublicUser, RtcSignal } from '../../shared/types.ts';

/**
 * Câmera do celular como câmera do computador na call (em teste: recurso "phonecam").
 *
 * 1. No computador (já numa call) a pessoa pede o QR Code: o servidor cria um código de uso único,
 *    preso à CONTA e ao aparelho do computador, que vale 2 minutos e fica só na memória.
 * 2. O celular, logado na MESMA conta, abre o link do QR e "resgata" o código.
 * 3. Os dois aparelhos trocam a negociação do WebRTC por aqui (phonecam:signal) e a imagem vai direto do
 *    celular para o computador. O celular NÃO entra na call (o servidor expulsaria o computador, que é
 *    a regra de uma call por conta): quem leva a imagem para a call é o computador.
 */
type Ack = (res: any) => void;
interface Pairing {
  userId: string;
  pc: string;
  phone: string | null;
  exp: number;
}

const PAIR_MS = 2 * 60_000;
const allow = (key: string, max: number, windowMs: number) => {
  try {
    limit(key, max, windowMs);
    return true;
  } catch {
    return false;
  }
};

export class PhoneCamHub {
  private pairings = new Map<string, Pairing>();

  constructor(
    private io: Server,
    private db: Db,
    /** o aparelho (socket) está numa call agora? */
    private inCall: (socketId: string) => boolean,
  ) {
    // códigos que ninguém usou somem sozinhos
    setInterval(() => {
      for (const [t, p] of this.pairings) if (!p.phone && p.exp < Date.now()) this.pairings.delete(t);
    }, 30_000).unref();
  }

  private involving(socketId: string) {
    return [...this.pairings.entries()].filter(([, p]) => p.pc === socketId || p.phone === socketId);
  }

  /** encerra os pareamentos do aparelho e avisa a outra ponta */
  end(socketId: string, reason: string) {
    for (const [token, p] of this.involving(socketId)) {
      this.pairings.delete(token);
      const other = p.pc === socketId ? p.phone : p.pc;
      if (other) this.io.to(other).emit('phonecam:ended', { reason });
    }
  }

  attach(socket: Socket, user: PublicUser) {
    // 1) computador: pede o QR Code
    socket.on('phonecam:create', async (_payload: unknown, ack?: Ack) => {
      try {
        if (!(await betaFeaturesFor(this.db, user.username)).includes('phonecam')) return ack?.({ ok: false, error: 'Recurso ainda não liberado para esta conta.' });
        if (!this.inCall(socket.id)) return ack?.({ ok: false, error: 'Entre numa call primeiro para usar a câmera do celular.' });
        if (!allow(`phonecam:create:${socket.id}`, 6, 60_000)) return ack?.({ ok: false, error: 'Calma: muitos códigos seguidos. Espere um minuto.' });
        this.end(socket.id, 'replaced'); // só um celular por vez
        const token = randomBytes(24).toString('base64url');
        this.pairings.set(token, { userId: user.id, pc: socket.id, phone: null, exp: Date.now() + PAIR_MS });
        // endereço do próprio site (o Origin vem do navegador e não dá para a página forjar)
        const origin = String(socket.handshake.headers.origin ?? `https://${socket.handshake.headers.host ?? ''}`);
        if (!/^https?:\/\/[\w.:-]+$/.test(origin)) return ack?.({ ok: false, error: 'Não foi possível montar o link.' });
        const url = `${origin}/app?camera=${token}`;
        const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
        ack?.({ ok: true, url, qrSvg, expiresInSec: PAIR_MS / 1000 });
      } catch (err) {
        console.warn('[phonecam]', err);
        ack?.({ ok: false, error: 'Não foi possível gerar o QR Code.' });
      }
    });

    // 2) celular: abriu o link e resgata o código
    socket.on('phonecam:claim', (payload: { token?: unknown }, ack?: Ack) => {
      if (!allow(`phonecam:claim:${socket.id}`, 10, 60_000)) return ack?.({ ok: false, error: 'Muitas tentativas. Gere um QR Code novo no computador.' });
      const p = typeof payload?.token === 'string' ? this.pairings.get(payload.token) : undefined;
      if (!p || p.phone || p.exp < Date.now()) return ack?.({ ok: false, error: 'Este QR Code expirou ou já foi usado. Gere outro no computador.' });
      if (p.userId !== user.id) return ack?.({ ok: false, error: 'Este QR Code é de outra conta. Entre com a mesma conta do computador.' });
      if (!this.io.sockets.sockets.has(p.pc) || !this.inCall(p.pc)) return ack?.({ ok: false, error: 'O computador não está mais numa call.' });
      p.phone = socket.id;
      p.exp = Number.POSITIVE_INFINITY;
      ack?.({ ok: true, pc: p.pc });
      this.io.to(p.pc).emit('phonecam:paired', { phone: socket.id });
    });

    // 3) negociação do WebRTC: só entre os dois aparelhos do pareamento
    socket.on('phonecam:signal', (payload: { to?: unknown; data?: RtcSignal }) => {
      const to = typeof payload?.to === 'string' ? payload.to : null;
      if (!to || !payload.data || typeof payload.data !== 'object') return;
      if (!allow(`phonecam:signal:${socket.id}`, 300, 10_000)) return;
      if (JSON.stringify(payload.data).length > 30_000) return;
      const ok = this.involving(socket.id).some(([, p]) => (p.pc === socket.id ? p.phone === to : p.phone === socket.id && p.pc === to));
      if (ok) this.io.to(to).emit('phonecam:signal', { from: socket.id, data: payload.data });
    });

    socket.on('phonecam:stop', () => this.end(socket.id, 'stopped'));
  }
}
