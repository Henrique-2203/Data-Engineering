// Registro de auditoria do servidor: ações de moderação/administração ficam registradas, só quem tem
// permissão vê, o conteúdo das mensagens apagadas não é guardado.
// Uso: npm run build && node e2e/audit.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3171;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: mkdtempSync(path.join(tmpdir(), 'resenha-audit-')) },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
async function api(p, body, token, method) {
  const res = await fetch(`${BASE}/api${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const reg = (u, d) => api('/auth/register', { username: u, password: 'Cor-Forte-Xis-42', displayName: d, acceptTerms: true });
  const ana = await reg('ana', 'Ana');
  const bia = await reg('bia', 'Bia');
  const caio = await reg('caio', 'Caio');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, caio.token);
  const geral = guild.channels.find((c) => c.type === 'text');

  // ações da dona
  await api(`/guilds/${guild.id}`, { name: 'Galera do Rift' }, ana.token, 'PATCH');
  const { roleId } = await api(`/guilds/${guild.id}/roles`, { name: 'Moderação', color: '#5865f2', permissions: 1 << 6 }, ana.token);
  await api(`/roles/${roleId}`, { permissions: (1 << 6) | (1 << 15) }, ana.token, 'PATCH');
  await api(`/guilds/${guild.id}/members/${bia.user.id}/roles`, { roleIds: [roleId] }, ana.token, 'PUT');
  await api(`/guilds/${guild.id}/members/${caio.user.id}/timeout`, { minutes: 60 }, ana.token);
  const msg = await api(`/channels/${geral.id}/messages`, { content: 'mensagem secreta que não pode vazar' }, bia.token);
  await api(`/messages/${msg.message.id}`, null, ana.token, 'DELETE');
  const own = await api(`/channels/${geral.id}/messages`, { content: 'minha própria' }, ana.token);
  await api(`/messages/${own.message.id}`, null, ana.token, 'DELETE');
  const { channel } = await api(`/guilds/${guild.id}/channels`, { name: 'clips', type: 'text' }, ana.token);
  await api(`/channels/${channel.id}`, { name: 'melhores-clips', allowedRoleIds: [roleId] }, ana.token, 'PATCH');
  await api(`/channels/${channel.id}`, null, ana.token, 'DELETE');
  await api(`/guilds/${guild.id}/bans`, { userId: caio.user.id, reason: 'spam no chat' }, ana.token);
  await api(`/guilds/${guild.id}/bans/${caio.user.id}`, null, ana.token, 'DELETE');
  await api(`/guilds/${guild.id}/invite`, {}, ana.token);

  const log = await api(`/guilds/${guild.id}/audit`, null, ana.token);
  const actions = log.entries.map((e) => e.action);
  for (const a of [
    'member_join',
    'guild_update',
    'role_create',
    'role_update',
    'member_roles',
    'member_timeout',
    'message_delete',
    'channel_create',
    'channel_update',
    'channel_delete',
    'member_ban',
    'member_unban',
    'guild_invite_reset',
  ]) {
    assert(actions.includes(a), `registro tem ${a}`);
  }
  assert(actions.filter((a) => a === 'message_delete').length === 1, 'apagar a PRÓPRIA mensagem não entra no registro');
  assert(!JSON.stringify(log).includes('mensagem secreta'), 'o conteúdo da mensagem apagada não é guardado');
  const ban = log.entries.find((e) => e.action === 'member_ban');
  assert(ban.targetLabel.includes('Caio') && ban.details.reason === 'spam no chat' && ban.actor.username === 'ana', 'banimento com alvo, motivo e autor');
  const upd = log.entries.find((e) => e.action === 'channel_update');
  assert(upd.details.name?.[1] === 'melhores-clips' && upd.details.privacy === 'privado', 'edição de canal com o que mudou');
  step(`${log.entries.length} ações registradas (${[...new Set(actions)].length} tipos); apagar a própria mensagem não entra; conteúdo não é guardado`);

  // quem pode ver
  assert([403, 404].includes((await api(`/guilds/${guild.id}/audit`, null, caio.token)).status), 'quem não tem permissão (ou saiu) não vê o registro');
  const biaLog = await api(`/guilds/${guild.id}/audit?action=member_`, null, bia.token);
  assert(biaLog.entries?.length > 0 && biaLog.entries.every((e) => e.action.startsWith('member_')), 'cargo com "Ver o registro" vê (e o filtro funciona)');
  step('só quem tem "Ver o registro de auditoria" (ou administra) vê; filtro por tipo funciona');

  // tela
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), ana.token);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e));
  await page.goto(`${BASE}/app`);
  await page.getByRole('button', { name: 'Galera do Rift' }).first().click().catch(() => {});
  await page.locator('.guild-name').click();
  await page.getByRole('button', { name: 'Configurações do servidor' }).click();
  await page.getByRole('button', { name: 'Registro', exact: true }).click();
  await page.getByText(/^Ana baniu Caio \(@caio\)$/).waitFor().catch(async (e) => {
    await page.screenshot({ path: path.join(shots, 'registro-falha.png') });
    throw e;
  });
  await page.getByText('motivo: spam no chat').waitFor();
  await page.getByText(/pôs Caio \(@caio\) de castigo por 1 hora$/).waitFor();
  await page.getByText(/deu: Castigar membros|deu: Ver o registro de auditoria/).first().waitFor();
  await page.screenshot({ path: path.join(shots, 'registro-auditoria.png') });
  step('tela: Configurações do servidor → Registro, em frases ("Ana baniu Caio", motivo, castigo de 1 hora, permissões dadas)');
  console.log('\nTUDO CERTO (registro de auditoria)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
