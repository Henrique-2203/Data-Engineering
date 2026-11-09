// Migração: arquivos antigos (guardados no banco, como no site atual) vão sozinhos para o R2 quando ele é configurado,
// e continuam abrindo durante e depois da mudança.
// Uso: node e2e/files-migrate.mjs   (precisa do moto_server, como o files.mjs --r2)
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { AwsClient } = require('aws4fetch');
const PORT = 3153;
const S3 = 5056;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'resenha-migr-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const step = (m) => console.log(`✓ ${m}`);
const R2 = { R2_ENDPOINT: `http://localhost:${S3}`, R2_BUCKET: 'resenha', R2_ACCESS_KEY_ID: 'teste', R2_SECRET_ACCESS_KEY: 'teste', R2_REGION: 'us-east-1' };
const aws = new AwsClient({ accessKeyId: 'teste', secretAccessKey: 'teste', service: 's3', region: 'us-east-1' });

const start = (env) => {
  const p = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { env: { ...process.env, PORT: String(PORT), DATA_DIR, ...env }, stdio: ['ignore', 'ignore', 'pipe'] });
  p.stderr.on('data', (d) => /\[ice\]/.test(d) || process.stderr.write(`[server] ${d}`));
  return p;
};
const ready = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {}
    await sleep(500);
  }
};
const stop = (p) => new Promise((r) => (p.once('exit', r), p.kill()));
async function api(p, body, token) {
  const res = await fetch(`${BASE}/api${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}

const moto = spawn(process.env.MOTO_SERVER ?? 'moto_server', ['-p', String(S3)], { stdio: 'ignore' });
let server;
try {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`http://localhost:${S3}/`);
      break;
    } catch {
      await sleep(500);
    }
  }
  await aws.fetch(`http://localhost:${S3}/resenha`, { method: 'PUT' });

  // 1) site como está hoje: tudo no banco
  server = start({});
  await ready();
  const ana = await api('/auth/register', { username: 'ana', password: 'segredo123', displayName: 'Ana', acceptTerms: true });
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  const geral = guild.channels.find((c) => c.type === 'text');
  const png = readFileSync('e2e/fixtures/limpa.png');
  const up = await fetch(`${BASE}/api/attachments?channelId=${geral.id}`, { method: 'POST', headers: { authorization: `Bearer ${ana.token}`, 'x-filename': 'antiga.png' }, body: png }).then((r) => r.json());
  await api(`/channels/${geral.id}/messages`, { content: 'foto antiga', attachmentIds: [up.attachment.id] }, ana.token);
  const avatar = await fetch(`${BASE}/api/me/avatar`, { method: 'POST', headers: { authorization: `Bearer ${ana.token}` }, body: png }).then((r) => r.json());
  await stop(server);

  // simula os dados do jeito antigo (conteúdo dentro das próprias linhas, coluna data)
  process.env.DATA_DIR = DATA_DIR;
  const { config } = await import('../server/src/config.ts');
  config.dataDir = DATA_DIR;
  const { createDb } = await import('../server/src/db.ts');
  const db = await createDb();
  await db.query(`update attachments a set data = b.data, storage_key = null from blobs b where b.key = a.storage_key`);
  await db.query(`update images i set data = b.data, storage_key = null from blobs b where b.key = i.storage_key`);
  await db.query('delete from blobs');
  const [legacy] = await db.query('select (select count(*) from attachments where data is not null) + (select count(*) from images where data is not null) as n');
  assert(Number(legacy.n) === 2, 'dois arquivos no formato antigo');
  await db.close();
  step('arquivos guardados do jeito antigo (dentro do banco)');

  // 2) liga o R2: os arquivos continuam abrindo e vão sozinhos para lá
  server = start(R2);
  await ready();
  const msgs = await api(`/channels/${geral.id}/messages`, null, ana.token);
  const att = msgs.messages[0].attachments[0];
  const during = await fetch(`${BASE}${att.url}`);
  assert(during.ok && Buffer.from(await during.arrayBuffer()).equals(png), 'antes de migrar, a foto antiga abre');
  // a migração começa 20 s depois de ligar
  let moved = false;
  for (let i = 0; i < 40 && !moved; i++) {
    await sleep(1000);
    const list = await aws.fetch(`http://localhost:${S3}/resenha?list-type=2`).then((r) => r.text());
    moved = list.includes(`att/${att.id}`) && list.includes(`img/${avatar.imageId}`);
  }
  assert(moved, 'arquivos levados para o R2');
  const afterRes = await fetch(`${BASE}${att.url}`);
  assert(afterRes.ok && Buffer.from(await afterRes.arrayBuffer()).equals(png), 'depois de migrar, a foto abre (agora pelo R2)');
  const av = await fetch(`${BASE}/api/images/${avatar.imageId}`);
  assert(av.ok && Buffer.from(await av.arrayBuffer()).equals(png), 'foto de perfil abre pelo R2');
  step('com o R2 ligado, os arquivos antigos migram sozinhos e nunca deixam de abrir');

  const sys = await api('/admin/system', null, ana.token);
  assert(sys.status === 404, 'painel Sistema só para a equipe');
  console.log('\nTUDO CERTO (migração)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  if (server) await stop(server);
  moto.kill();
}
