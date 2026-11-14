// "Apoie o Resenha": a equipe configura a chave Pix no painel; a pessoa vê o QR Code + Pix copia e
// cola com o código dela, avisa que pagou; a equipe confere e confirma; o selo de Apoiador Fundador
// aparece no perfil (e some se a pessoa esconder). Depois da data limite, ninguém novo consegue apoiar.
// Uso: npm run build && node e2e/apoio.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 3193;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const step = (m) => console.log(`✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => {
  if (!c) throw new Error(`FALHOU: ${m}`);
};
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-apoio-'), PLATFORM_ADMINS: 'equipe' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => /\[ice\]|BACKUP_KEY/.test(d) || process.stderr.write(`[server] ${d}`));
const api = async (p, body, token, method) => {
  const res = await fetch(`${BASE}/api${p}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
/** confere o CRC do Pix copia e cola (os 4 últimos caracteres) */
const crcOk = (payload) => {
  const body = payload.slice(0, -4);
  let crc = 0xffff;
  for (const b of Buffer.from(body)) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0') === payload.slice(-4);
};
const KEY = '7d3c2a1b-4e5f-4a6b-8c9d-0e1f2a3b4c5d'; // chave aleatória de mentira

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const reg = (u, d) => api('/auth/register', { username: u, password: 'Cor-Forte-Xis-42', displayName: d, acceptTerms: true });
  const equipe = await reg('equipe', 'Equipe');
  const ana = await reg('ana', 'Ana');
  const bia = await reg('bia', 'Bia');
  const { guild } = await api('/guilds', { name: 'Galera' }, ana.token);
  await api(`/invites/${guild.inviteCode}/join`, {}, bia.token);

  // desligado: ninguém vê, e só a equipe acessa o painel
  let a = await api('/apoio', null, ana.token);
  assert(a.open === false && a.pix === null, 'começa desligado');
  assert((await api('/admin/apoio', null, ana.token)).status === 404, 'quem não é da equipe não acessa o painel de apoios');

  browser = await chromium.launch();
  const open = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await ctx.addInitScript((t) => localStorage.setItem('resenha.token', t), token);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await page.goto(`${BASE}/app`);
    await page.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 2500 }).catch(() => {});
    return page;
  };
  const pa = await open(ana.token);
  await pa.getByRole('button', { name: 'Suporte' }).waitFor();
  assert((await pa.getByRole('button', { name: 'Apoie o Resenha' }).count()) === 0, 'botão de apoio escondido enquanto está desligado');

  // a equipe configura: avisa quando a chave não é aleatória
  const pe = await open(equipe.token);
  await pe.getByRole('button', { name: /^Denúncias/ }).click();
  await pe.getByRole('tab', { name: /Apoios/ }).click();
  await pe.getByLabel('Chave Pix (use a chave aleatória)').fill('12345678900');
  await pe.getByText('Isso não parece uma chave aleatória').waitFor();
  await pe.getByLabel('Chave Pix (use a chave aleatória)').fill(KEY);
  assert((await pe.getByText('Isso não parece uma chave aleatória').count()) === 0, 'chave aleatória não dá aviso');
  await pe.getByLabel('Nome de quem recebe (como no banco)').fill('Henrique Ação');
  await pe.getByLabel('Cidade').fill('São Paulo');
  await pe.getByLabel('Mostrar o "Apoie o Resenha" para as pessoas').check();
  await pe.getByRole('button', { name: 'Salvar' }).click();
  await pe.getByText('Aberto até 17 de dezembro').waitFor();
  // quem já estava com o Resenha aberto vê o botão aparecer sem recarregar
  await pa.getByRole('button', { name: 'Apoie o Resenha' }).waitFor({ timeout: 5000 });
  step('equipe configura a chave Pix aleatória no painel (com aviso se for CPF/telefone/e-mail) e liga o apoio até 17/12; quem está com o app aberto vê o botão na hora');

  // a pessoa: QR Code + copia e cola com o código dela
  a = await api('/apoio', null, ana.token);
  assert(a.open && a.deadline === '2026-12-17' && a.minCents === 500, 'aberto até 17/12, mínimo R$ 5');
  assert(/^RSN-[A-Z2-9]{5}$/.test(a.me.code), `código da pessoa (${a.me.code})`);
  const p = a.pix.payload;
  assert(p.startsWith('000201') && p.includes('br.gov.bcb.pix') && p.includes(KEY) && p.includes('5913HENRIQUE ACAO') && p.includes('6009SAO PAULO'), 'Pix copia e cola no padrão do Banco Central');
  assert(!/54\d\d\d/.test(p.split('5802BR')[0].split('5303986')[1] ?? ''), 'sem valor fixo (a pessoa escolhe quanto dar)');
  assert(p.includes(a.me.code.replace('-', '')) && crcOk(p), 'código da pessoa no identificador e CRC certo');
  assert(a.pix.qrSvg.startsWith('<svg'), 'QR Code em SVG');
  await pa.getByRole('button', { name: 'Apoie o Resenha' }).click();
  const dlg = pa.getByRole('dialog', { name: 'Apoie o Resenha 💚' });
  await dlg.getByRole('img', { name: 'QR Code do Pix' }).waitFor();
  assert((await dlg.locator('.apoio-qr svg').count()) === 1, 'QR Code na tela');
  assert((await dlg.getByLabel('Pix copia e cola').inputValue()) === p, 'copia e cola na tela');
  await dlg.getByText(a.me.code).first().waitFor();
  await dlg.getByText('Tudo que é grátis hoje continua grátis para sempre.').waitFor();
  await dlg.getByText('O apoio não libera nenhuma função').waitFor();
  await pa.screenshot({ path: path.join(shots, 'apoio-janela.png') });
  // clicar sem querer não avisa a equipe: pede confirmação e dá para voltar
  await dlg.getByRole('button', { name: 'Já fiz o Pix' }).click();
  await dlg.getByText('Você já fez o Pix?').waitFor();
  await dlg.getByRole('button', { name: 'Ainda não' }).click();
  assert((await api('/admin/apoio', null, equipe.token)).totals.pending === 0, '"Ainda não" não avisa a equipe');
  await dlg.getByRole('button', { name: 'Já fiz o Pix' }).click();
  await dlg.getByRole('button', { name: 'Sim, já paguei' }).click();
  await dlg.getByText('Recebemos o seu aviso!').waitFor();
  step(`pessoa vê o QR Code e o Pix copia e cola (CRC certo, sem valor fixo, código ${a.me.code}) e avisa "Já fiz o Pix" (com confirmação, para não avisar sem querer)`);

  // a equipe confere e confirma (valor só para a meta)
  await pe.getByRole('tab', { name: /Apoios\s*1/ }).waitFor({ timeout: 5000 });
  await pe.getByText(a.me.code).waitFor();
  // o cartão do pedido aparece inteiro (antes ficava espremido num quadrado de 84 px)
  const card = pe.locator('.apoio-item').first();
  const box = await card.boundingBox();
  assert(box && box.width > 500, `cartão do apoio com largura normal (${box?.width}px)`);
  await card.getByText('⏳ Para conferir').waitFor();
  await pe.screenshot({ path: path.join(shots, 'apoio-painel-conferir.png') });
  await pe.getByLabel('Valor recebido de @ana').fill('10,00');
  await pe.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await pe.getByText('Selo entregue para @ana').waitFor();
  await pe.getByText('Apoiadores: 1 de 10').waitFor();
  await pe.getByText('R$ 10 de R$ 100').waitFor();
  await pe.screenshot({ path: path.join(shots, 'apoio-painel.png') });
  await pa.getByText('Seu selo de Apoiador Fundador chegou!').waitFor({ timeout: 5000 });
  await dlg.getByText('Obrigado de verdade!').waitFor();
  step('equipe confirma no painel (meta 1/10 e R$ 10/R$ 100, só a equipe vê) e a pessoa recebe o aviso na hora');

  // o selo no perfil (visto pela Bia), e a opção de esconder
  let prof = await api(`/users/${ana.user.id}/profile`, null, bia.token);
  assert(prof.profile.supporter === true, 'selo aparece no perfil para os outros');
  assert(JSON.stringify(prof).indexOf('amount') === -1 && JSON.stringify(prof).indexOf('cents') === -1, 'o perfil não mostra valor nenhum');
  await dlg.getByLabel('Mostrar o selo no meu perfil').uncheck();
  await sleep(400);
  prof = await api(`/users/${ana.user.id}/profile`, null, bia.token);
  assert(prof.profile.supporter === false, 'escondeu o selo: some do perfil');
  await dlg.getByLabel('Mostrar o selo no meu perfil').check();
  await sleep(400);
  assert((await api(`/users/${ana.user.id}/profile`, null, bia.token)).profile.supporter === true, 'mostrou de novo');
  const expRes = await fetch(`${BASE}/api/me/export`, { headers: { authorization: `Bearer ${ana.token}` } });
  const exp = await expRes.json().catch(() => null);
  assert(expRes.ok && exp?.apoio?.status === 'confirmed', `"Baixar meus dados" inclui o apoio (${expRes.status})`);
  step('selo "Apoiador Fundador" no perfil (sem valor nenhum), a pessoa pode esconder e mostrar; aparece em "Baixar meus dados"');

  // depois da data limite: fecha para quem não apoiou; quem apoiou continua com o selo
  const s = (await api('/admin/apoio', null, equipe.token)).settings;
  await api('/admin/apoio', { ...s, deadline: '2026-01-01' }, equipe.token, 'PUT');
  const b = await api('/apoio', null, bia.token);
  assert(b.open === false && b.pix === null, 'depois da data limite fecha');
  assert((await api('/apoio/claim', {}, bia.token)).status === 400, 'não dá para pedir o selo depois da data');
  assert((await api(`/users/${ana.user.id}/profile`, null, bia.token)).profile.supporter === true, 'quem apoiou continua com o selo');
  const pb = await open(bia.token);
  await pb.getByRole('button', { name: 'Suporte' }).waitFor();
  assert((await pb.getByRole('button', { name: 'Apoie o Resenha' }).count()) === 0, 'botão some para quem não apoiou');
  step('depois da data limite ninguém novo consegue apoiar e o selo de quem apoiou continua');

  // Termos e Privacidade
  const pt = await (await browser.newContext()).newPage();
  await pt.goto(`${BASE}/termos`);
  await pt.getByRole('heading', { name: '7. Grátis para sempre e apoio voluntário' }).waitFor();
  await pt.goto(`${BASE}/privacidade`);
  await pt.getByText('Apoio ao Resenha (só se você apoiar)').waitFor();
  step('Termos com a promessa "grátis para sempre" e Privacidade explicando o apoio');
  console.log('\nTUDO CERTO (Apoie o Resenha)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
