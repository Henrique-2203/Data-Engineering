// SFU de mentira para os testes (mesma API do Cloudflare Realtime SFU que o server/src/sfu.ts usa):
// roda dentro de uma página do Chromium, que recebe a tela de quem transmite e repassa para quem assiste.
// Não faz simulcast (o Chromium não recebe várias qualidades), mas guarda os pedidos para conferir.
import { createServer } from 'node:http';

export async function startMockSfu(browser, { port, appId, token }) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[mock-sfu]', e.message));
  await page.goto('about:blank');
  await page.evaluate(() => {
    const sessions = new Map();
    const published = new Map();
    const gathered = (pc) =>
      new Promise((ok) => {
        if (pc.iceGatheringState === 'complete') return ok();
        pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && ok());
        setTimeout(ok, 3000);
      });
    window.mock = {
      newSession() {
        const id = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
        sessions.set(id, new RTCPeerConnection());
        return id;
      },
      async push(id, offer, tracks) {
        const pc = sessions.get(id);
        await pc.setRemoteDescription(offer);
        await pc.setLocalDescription(await pc.createAnswer());
        await gathered(pc);
        for (const t of tracks) {
          const tr = pc.getTransceivers().find((x) => x.mid === t.mid);
          if (tr) published.set(`${id}/${t.trackName}`, tr.receiver.track);
        }
        return { sessionDescription: { type: 'answer', sdp: pc.localDescription.sdp }, tracks: tracks.map((t) => ({ mid: t.mid, trackName: t.trackName })) };
      },
      async pull(id, tracks) {
        const pc = sessions.get(id);
        const out = [];
        for (const t of tracks) {
          const src = published.get(`${t.sessionId}/${t.trackName}`);
          if (!src) return { errorCode: 'not_found', errorDescription: 'track not found' };
          out.push({ t, tr: pc.addTransceiver(src, { direction: 'sendonly' }) });
        }
        await pc.setLocalDescription(await pc.createOffer());
        await gathered(pc);
        return {
          requiresImmediateRenegotiation: true,
          sessionDescription: { type: 'offer', sdp: pc.localDescription.sdp },
          tracks: out.map(({ t, tr }) => ({ trackName: t.trackName, sessionId: t.sessionId, mid: tr.mid })),
        };
      },
      async renegotiate(id, answer) {
        await sessions.get(id).setRemoteDescription(answer);
        return {};
      },
      close(id) {
        sessions.get(id)?.close();
        sessions.delete(id);
        for (const k of published.keys()) if (k.startsWith(`${id}/`)) published.delete(k);
        return { tracks: [] };
      },
    };
  });

  const state = { requests: [], fail: false };
  const server = createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    let raw = '';
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : undefined;
    const path = new URL(req.url, 'http://x').pathname;
    state.requests.push({ method: req.method, path, body, auth: req.headers.authorization });
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { errorCode: 'unauthorized' });
    if (state.fail) return send(500, { errorCode: 'internal', errorDescription: 'mock quebrado de propósito' });
    const m = path.match(new RegExp(`^/v1/apps/${appId}/sessions/(new|[^/]+)(?:/(.*))?$`));
    if (!m) return send(404, { errorCode: 'not_found' });
    try {
      const [, id, rest] = m;
      if (id === 'new') return send(201, { sessionId: await page.evaluate(() => window.mock.newSession()) });
      if (rest === 'tracks/new') {
        const local = body.tracks.every((t) => t.location === 'local');
        const r = local
          ? await page.evaluate(([id, sd, t]) => window.mock.push(id, sd, t), [id, body.sessionDescription, body.tracks])
          : await page.evaluate(([id, t]) => window.mock.pull(id, t), [id, body.tracks]);
        return send(r.errorCode ? 404 : 200, r);
      }
      if (rest === 'renegotiate') return send(200, await page.evaluate(([id, sd]) => window.mock.renegotiate(id, sd), [id, body.sessionDescription]));
      if (rest === 'tracks/update') return send(200, { tracks: body.tracks });
      if (rest === 'tracks/close') return send(200, await page.evaluate((id) => window.mock.close(id), id));
      return send(404, { errorCode: 'not_found' });
    } catch (err) {
      return send(500, { errorCode: 'mock', errorDescription: String(err) });
    }
  }).listen(port);
  return {
    state,
    close: async () => {
      server.close();
      await ctx.close();
    },
  };
}
