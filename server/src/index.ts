import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config.ts';
import { createDb } from './db.ts';
import { Realtime } from './realtime.ts';
import { HttpError, createRoutes } from './routes.ts';
import { startEventReminders } from './community.ts';
import { securityHeaders } from './security.ts';
import { sameOriginOnly } from './auth.ts';
import { startStorageJobs } from './storage.ts';
import { startBackups } from './backup.ts';

const db = await createDb();
const app = express();
const http = createServer(app);
const rt = new Realtime(http, db);
startEventReminders(db, rt);
startStorageJobs(db);
startBackups(db);

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(securityHeaders);
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
  app.use(
    express.static(config.clientDist, {
      index: false,
      setHeaders: (res, file) => {
        if (file.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );
  app.get(/^\/(?!api|socket\.io).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(config.clientDist, 'index.html'));
  });
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
