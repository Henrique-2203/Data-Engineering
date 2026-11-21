import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import compression from 'compression';
import { config } from './config.ts';
import { createDb } from './db.ts';
import { Realtime } from './realtime.ts';
import { HttpError, createRoutes } from './routes.ts';
import { startEventReminders } from './community.ts';
import { startCapacityAlerts } from './capacity.ts';
import { securityHeaders } from './security.ts';
import { sameOriginOnly } from './auth.ts';
import { startStorageJobs } from './storage.ts';
import { startBackups } from './backup.ts';

const db = await createDb();
const app = express();
const http = createServer(app);
const rt = new Realtime(http, db);
startEventReminders(db, rt);
startCapacityAlerts(db, rt);
startStorageJobs(db);
startBackups(db);

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(securityHeaders);
// Respostas da API compactadas (JSON de mensagens, membros, servidores...): bem menos internet gasta no Render.
// Os arquivos do site já vão compactados de antemão (abaixo); imagens e vídeos não passam por aqui.
app.use(compression({ threshold: 1024, filter: (req, res) => !res.getHeader('Content-Encoding') && compression.filter(req, res) }));
app.use(express.json({ limit: '100kb' }));
// canal oficial para reportar falhas de segurança (RFC 9116)
app.get('/.well-known/security.txt', (req, res) => {
  const origin = `${req.protocol}://${req.headers.host}`;
  const expires = new Date(Date.now() + 300 * 86400_000).toISOString().replace(/\.\d{3}Z$/, '.000Z');
  res.type('text/plain').send(
    [
      `Contact: mailto:${config.privacyContact}`,
      `Expires: ${expires}`,
      'Preferred-Languages: pt, en',
      `Policy: ${origin}/seguranca#reportar`,
      `Canonical: ${origin}/.well-known/security.txt`,
      '',
    ].join('\n'),
  );
});
app.use('/api', sameOriginOnly);
app.use('/api', createRoutes(db, rt));
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

// Frontend compilado (client/dist) + fallback de SPA para rotas como /invite/:code
if (existsSync(config.clientDist)) {
  const indexHtml = path.join(config.clientDist, 'index.html');
  /** cópia compactada no build (client/scripts/precompress.mjs): .br (brotli) ou .gz, se o navegador aceitar */
  const precompressed = (req: Request, file: string): { file: string; encoding: string } | null => {
    const accept = String(req.headers['accept-encoding'] ?? '');
    if (/\bbr\b/.test(accept) && existsSync(`${file}.br`)) return { file: `${file}.br`, encoding: 'br' };
    if (/\bgzip\b/.test(accept) && existsSync(`${file}.gz`)) return { file: `${file}.gz`, encoding: 'gzip' };
    return null;
  };
  const sendPrecompressed = (req: Request, res: Response, file: string, cacheControl: string) => {
    const hit = precompressed(req, file);
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Cache-Control', cacheControl);
    if (!hit) return res.sendFile(file);
    res.setHeader('Content-Encoding', hit.encoding);
    res.type(path.extname(file));
    res.sendFile(hit.file);
  };
  app.get(/\.(js|mjs|css|html|svg|json|webmanifest|wasm|txt)$/, (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return next();
    let rel: string;
    try {
      rel = path.normalize(decodeURIComponent(req.path)).replace(/^([/\\])+/, '');
    } catch {
      return next();
    }
    const file = path.join(config.clientDist, rel);
    if (!file.startsWith(config.clientDist + path.sep) || !existsSync(file)) return next();
    const immutable = file.includes(`${path.sep}assets${path.sep}`);
    sendPrecompressed(req, res, file, immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
  });
  app.use(
    express.static(config.clientDist, {
      index: false,
      setHeaders: (res, file) => {
        if (file.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (file.includes(`${path.sep}landing${path.sep}`)) {
          // vídeo e imagens do site de apresentação: quem volta no mesmo dia não baixa de novo
          res.setHeader('Cache-Control', 'public, max-age=86400');
        }
      },
    }),
  );
  app.get(/^\/(?!api|socket\.io).*/, (req, res) => sendPrecompressed(req, res, indexHtml, 'no-cache'));
} else {
  app.get('/', (_req, res) => {
    res.send('Frontend não compilado. Rode "npm run build" ou use "npm run dev".');
  });
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

http.listen(config.port, () => {
  console.log(`[resenha] rodando em http://localhost:${config.port}`);
});

const shutdown = async () => {
  // atualização (o Render troca o servidor): avisa os apps, que mantêm a voz e reconectam sozinhos
  rt.shuttingDown = true;
  rt.io.emit('server:restarting');
  await new Promise((r) => setTimeout(r, 300));
  rt.io.close();
  http.close();
  await db.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
