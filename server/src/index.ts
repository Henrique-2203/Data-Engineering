import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config.ts';
import { createDb } from './db.ts';
import { Realtime } from './realtime.ts';
import { HttpError, createRoutes } from './routes.ts';
import { securityHeaders } from './security.ts';
import { sameOriginOnly } from './auth.ts';
import { startStorageJobs } from './storage.ts';
import { startBackups } from './backup.ts';

const db = await createDb();
const app = express();
const http = createServer(app);
const rt = new Realtime(http, db);
startStorageJobs(db);
startBackups(db);

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(express.json({ limit: '100kb' }));
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
  rt.io.close();
  http.close();
  await db.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
