// Teste dos códigos de convite pessoais: cada pessoa ganha o seu código com limite de contas, a equipe
// vê quem trouxe quem, dois cadastros ao mesmo tempo não passam do limite, código geral pode ser
// desligado, link /app?convite= já preenche o código, e a pessoa vê "Seus convites" em Minha conta.
// Uso: npm run build && node e2e/invite-codes.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tempDir } from './_tmp.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 3247;
const BASE = `http://localhost:${PORT}`;
const shots = path.resolve('e2e/screenshots');
mkdirSync(shots, { recursive: true });
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tempDir('resenha-convites-'), PLATFORM_ADMINS: 'equipe', REGISTRATION_CODE: 'galera2026' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

const step = (msg) => console.log(`✓ ${msg}`);
let ipN = 1;
async function api(p, body, token, method) {
  const res = await fetch(`${BASE}/api${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    // cada cadastro "vem" de um aparelho diferente (o limite de cadastros por IP é outro teste)
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${ipN++ % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
const reg = (username, registrationCode) => api('/auth/register', { username, password: 'Pao-de-Queijo-77', registrationCode, acceptTerms: true });
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  // ---------- código geral ----------
  const cfg = await api('/config');
  expect(cfg.registrationRequiresCode === true, 'o cadastro deveria pedir código');
  const noCode = await reg('semcodigo');
  expect(noCode.status === 403, `sem código deveria falhar: ${noCode.status}`);
  const equipe = await reg('equipe', 'Galera2026'); // maiúsculas/minúsculas tanto faz
  expect(equipe.status === 200 && equipe.token, `cadastro com o código geral: ${JSON.stringify(equipe)}`);
  const lari = await reg('lari', 'galera2026');
  expect(lari.status === 200, 'lari');
  step('cadastro pede código; o código geral antigo continua valendo (sem diferenciar maiúsculas)');

  // ---------- código pessoal com limite ----------
  const created = await api('/admin/signup-codes', { owner: '@lari', label: 'veio pelo Instagram', maxUses: 2 }, equipe.token);
  expect(created.status === 200 && /^LARI-[A-Z2-9]{4}$/.test(created.code), `criar código: ${JSON.stringify(created)}`);
  const code = created.code;
  const notAdmin = await api('/admin/signup-codes', null, lari.token);
  expect(notAdmin.status === 404, 'quem não é da equipe não vê o painel de convites');
  const a1 = await reg('amigo1', code.toLowerCase());
  const a2 = await reg('amigo2', ` ${code} `);
  expect(a1.status === 200 && a2.status === 200, `2 amigos com o código: ${a1.status} ${a2.status}`);
  const a3 = await reg('amigo3', code);
  expect(a3.status === 403 && /máximo/.test(a3.error ?? a3.message ?? ''), `3º deveria bater no limite: ${JSON.stringify(a3)}`);
  const wrong = await reg('amigo3', 'LARI-0000');
  expect(wrong.status === 403 && /inválido/.test(wrong.error ?? wrong.message ?? ''), `código errado: ${JSON.stringify(wrong)}`);
  step(`código pessoal ${code} (limite 2): 2 contas entram, a 3ª é barrada; código errado é recusado`);

  // a dona vê os convites dela
  const mine = await api('/me/invite-codes', null, lari.token);
  expect(mine.codes?.length === 1 && mine.codes[0].uses === 2 && mine.codes[0].maxUses === 2, `meus convites: ${JSON.stringify(mine)}`);
  // a equipe vê quem entrou por cada código
  let list = await api('/admin/signup-codes', null, equipe.token);
  const row = list.codes.find((c) => c.code === code);
  expect(row.owner === 'lari' && row.users.map((u) => u.username).sort().join() === 'amigo1,amigo2', `quem entrou: ${JSON.stringify(row)}`);
  const general = list.codes.find((c) => c.isGeneral);
  expect(general?.code === 'GALERA2026' && general.uses === 2 && general.maxUses === null, `código geral na lista: ${JSON.stringify(general)}`);
  expect(list.totals.withCode === 4 && list.totals.total === 4, `totais: ${JSON.stringify(list.totals)}`);
  step('a dona vê "2 de 2" nos convites dela; a equipe vê que @amigo1 e @amigo2 entraram pelo código da @lari');

  // limite: não dá para baixar abaixo do que já foi usado; aumentar libera mais contas
  const low = await api(`/admin/signup-codes/${code}`, { maxUses: 1 }, equipe.token, 'PATCH');
  expect(low.status === 400, 'limite menor que o já usado');
  await api(`/admin/signup-codes/${code}`, { maxUses: 3 }, equipe.token, 'PATCH');
  const a3b = await reg('amigo3', code);
  expect(a3b.status === 200, `depois de aumentar o limite: ${a3b.status}`);
  step('limite aumentado para 3 libera mais um amigo (e não deixa baixar para menos do que já entrou)');

  // ---------- dois cadastros ao mesmo tempo não passam do limite ----------
  const one = await api('/admin/signup-codes', { label: 'teste de corrida', maxUses: 1, code: 'corrida-1' }, equipe.token);
  expect(one.code === 'CORRIDA-1', `código escolhido: ${JSON.stringify(one)}`);
  const race = await Promise.all(['r1', 'r2', 'r3', 'r4'].map((u) => reg(`corrida_${u}`, 'CORRIDA-1')));
  const ok = race.filter((r) => r.status === 200).length;
  expect(ok === 1, `4 cadastros ao mesmo tempo num código de 1 vaga: ${ok} entraram (${race.map((r) => r.status)})`);
  step('4 cadastros ao mesmo tempo num código de 1 vaga: só 1 entra');

  // ---------- desativar, apagar ----------
  await api('/admin/signup-codes/GALERA2026', { active: false }, equipe.token, 'PATCH');
  const offGeneral = await reg('atrasado', 'galera2026');
  expect(offGeneral.status === 403 && /desativado/.test(offGeneral.error ?? offGeneral.message ?? ''), `código geral desligado: ${JSON.stringify(offGeneral)}`);
  const delUsed = await api(`/admin/signup-codes/${code}`, null, equipe.token, 'DELETE');
  expect(delUsed.status === 400, 'código usado não pode ser apagado (histórico)');
  const spare = await api('/admin/signup-codes', { maxUses: 3, label: 'sobrando' }, equipe.token);
  const del = await api(`/admin/signup-codes/${spare.code}`, null, equipe.token, 'DELETE');
  expect(del.status === 200 || del.status === 204, `apagar código sem uso: ${del.status}`);
  step('código geral desligado no painel deixa de valer; código com contas não pode ser apagado, sem uso pode');

  // ---------- telas ----------
  const theo = await api('/admin/signup-codes', { owner: 'lari', label: 'segundo lote', maxUses: 5, code: 'LARI-AMIGOS' }, equipe.token);
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/app?convite=${theo.code}`);
  const codeInput = page.getByLabel('Código de convite');
  await codeInput.waitFor();
  expect((await codeInput.inputValue()) === 'LARI-AMIGOS', 'o link deveria preencher o código');
  await page.screenshot({ path: `${shots}/80-cadastro-com-convite.png` });
  await page.getByLabel('Nome de usuário').fill('theo');
  await page.getByLabel('Senha', { exact: true }).fill('Pao-de-Queijo-77');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /Criar conta/ }).click();
  await page.getByRole('button', { name: 'Configurações', exact: true }).waitFor({ timeout: 15000 });
  list = await api('/admin/signup-codes', null, equipe.token);
  expect(list.codes.find((c) => c.code === 'LARI-AMIGOS').users[0]?.username === 'theo', 'theo entrou pelo LARI-AMIGOS');
  step('link /app?convite=LARI-AMIGOS abre o cadastro com o código preenchido e a conta entra na conta da Lari');
  await ctx.close();

  // Lari: "Seus convites" em Minha conta
  const lctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const lp = await lctx.newPage();
  await lp.goto(`${BASE}/app`);
  await lp.getByLabel(/Usuário ou e-mail|Nome de usuário/).first().fill('lari');
  await lp.getByLabel('Senha', { exact: true }).fill('Pao-de-Queijo-77');
  await lp.getByRole('button', { name: /^Entrar$/ }).click();
  await lp.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 5000 }).catch(() => {});
  await lp.getByRole('button', { name: 'Configurações', exact: true }).click();
  const card = lp.locator('.my-invites');
  await card.getByText('LARI-AMIGOS').waitFor();
  await card.getByText('Ainda dá para chamar 4 amigos.').waitFor();
  await card.screenshot({ path: `${shots}/81-seus-convites.png` });
  step('a Lari vê "Seus convites" em Minha conta: LARI-AMIGOS, 1 de 5, "ainda dá para chamar 4 amigos"');
  await lctx.close();

  // equipe: aba Convites do painel
  const ectx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ep = await ectx.newPage();
  await ep.goto(`${BASE}/app`);
  await ep.getByLabel(/Usuário ou e-mail|Nome de usuário/).first().fill('equipe');
  await ep.getByLabel('Senha', { exact: true }).fill('Pao-de-Queijo-77');
  await ep.getByRole('button', { name: /^Entrar$/ }).click();
  await ep.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 5000 }).catch(() => {});
  await ep.getByRole('button', { name: 'Denúncias' }).click();
  await ep.getByRole('tab', { name: 'Convites' }).click();
  await ep.getByText('Quem mais trouxe amigos').waitFor();
  await ep.getByRole('button', { name: /Quem entrou \(3\)/ }).click();
  await ep.getByText('@amigo1').waitFor();
  await ep.screenshot({ path: `${shots}/82-painel-convites.png` });
  step('painel da equipe → Convites: criar código, ranking de quem mais trouxe e lista de quem entrou');
  await ectx.close();
  if (errors.length) throw new Error(`erros na página: ${errors.join(' | ')}`);

  // ---------- cadastro com e-mail confirmado (2 passos): o uso só é gasto quando a conta nasce ----------
  const DATA2 = tempDir('resenha-convites-mail-');
  const OUTBOX = path.join(DATA2, 'outbox.jsonl');
  const s2 = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
    env: { ...process.env, PORT: String(PORT + 1), DATA_DIR: DATA2, PLATFORM_ADMINS: 'equipe', REGISTRATION_CODE: 'galera2026', EMAIL_PROVIDER: 'file', EMAIL_OUTBOX: OUTBOX },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    const B2 = `http://localhost:${PORT + 1}/api`;
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${B2}/health`)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    const call = async (p, body, token, method) => {
      const res = await fetch(`${B2}${p}`, {
        method: method ?? (body ? 'POST' : 'GET'),
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.1.0.${ipN++ % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, ...(await res.json().catch(() => ({}))) };
    };
    const mailCode = (to) => {
      const { readFileSync } = require('node:fs');
      return readFileSync(OUTBOX, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((m) => m.to === to).at(-1).code;
    };
    const start = (username, registrationCode) =>
      call('/auth/register/start', { email: `${username}@exemplo.com`, username, password: 'Pao-de-Queijo-77', acceptTerms: true, registrationCode });
    const confirm = (st, username) => call('/auth/register/confirm', { pendingId: st.pendingId, code: mailCode(`${username}@exemplo.com`) });
    const eq = await confirm(await start('equipe', 'galera2026'), 'equipe');
    expect(eq.token, `equipe pelo e-mail: ${JSON.stringify(eq)}`);
    await call('/admin/signup-codes', { maxUses: 1, code: 'UMA-VAGA' }, eq.token);
    const p1 = await start('bia', 'uma-vaga');
    const p2 = await start('caio', 'UMA-VAGA'); // os dois começam: o código ainda tem 1 vaga
    expect(p1.pendingId && p2.pendingId, 'os dois cadastros começam');
    let list2 = await call('/admin/signup-codes', null, eq.token);
    expect(list2.codes.find((c) => c.code === 'UMA-VAGA').uses === 0, 'começar o cadastro não gasta o convite');
    const c1 = await confirm(p1, 'bia');
    const c2 = await confirm(p2, 'caio');
    expect(c1.token && c2.status === 403 && /limite/.test(c2.error ?? c2.message ?? ''), `só o primeiro a confirmar entra: ${c1.status} ${c2.status}`);
    list2 = await call('/admin/signup-codes', null, eq.token);
    const uv = list2.codes.find((c) => c.code === 'UMA-VAGA');
    expect(uv.uses === 1 && uv.users[0].username === 'bia', `uso gasto na confirmação: ${JSON.stringify(uv)}`);
    step('com e-mail: começar o cadastro não gasta o convite; só quem confirma primeiro usa a última vaga');

    // ---------- convite pela lista de espera ----------
    const { readFileSync } = require('node:fs');
    const outbox = () => readFileSync(OUTBOX, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    await call('/waitlist', { name: 'Marina Souza', email: 'marina@exemplo.com', platforms: ['windows'], consent: true, source: 'instagram' });
    await call('/waitlist', { name: 'Davi', email: 'davi@exemplo.com', platforms: ['navegador'], consent: true });
    let wl = await call('/admin/waitlist', null, eq.token);
    const marina = wl.entries.find((e) => e.email === 'marina@exemplo.com');
    const inv = await call(`/admin/waitlist/${marina.id}/invite`, { maxUses: 3 }, eq.token);
    expect(inv.emailed && /^MARINA-[A-Z2-9]{4}$/.test(inv.code), `convite da lista: ${JSON.stringify(inv)}`);
    const mail = outbox().filter((m) => m.to === 'marina@exemplo.com').at(-1);
    expect(mail.code === inv.code && /Oi, Marina!/.test(mail.text) && /a sua e mais 2 amigos/.test(mail.text) && /\/app/.test(mail.text), `e-mail do convite: ${mail.text}`);
    const again = await call(`/admin/waitlist/${marina.id}/invite`, { maxUses: 3 }, eq.token);
    expect(again.code === inv.code && outbox().filter((m) => m.to === 'marina@exemplo.com').length === 2, 'reenviar manda o MESMO código');
    step(`lista de espera → "Enviar convite": código ${inv.code} (limite 3) chega no e-mail da Marina; reenviar repete o mesmo código`);
    // ela cria a conta com o código e ele vira dela
    const mar = await confirm(await start('marina', inv.code), 'marina');
    expect(mar.token, `Marina entrou: ${JSON.stringify(mar)}`);
    const hers = await call('/me/invite-codes', null, mar.token);
    expect(hers.codes?.[0]?.code === inv.code && hers.codes[0].uses === 1 && hers.codes[0].maxUses === 3, `o código virou da Marina: ${JSON.stringify(hers)}`);
    wl = await call('/admin/waitlist', null, eq.token);
    const m2 = wl.entries.find((e) => e.email === 'marina@exemplo.com');
    expect(m2.joined === 'marina' && m2.invitedAt && m2.codeUses === 1, `lista mostra que ela entrou: ${JSON.stringify(m2)}`);
    step('a Marina cria a conta com o código: ele vira dela ("Seus convites", 1 de 3) e a lista mostra "entrou como @marina"');

    // pelo painel: botão "Enviar convite por e-mail" do Davi
    const b2 = await chromium.launch();
    try {
      const pg = await (await b2.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
      await pg.addInitScript((t) => localStorage.setItem('resenha.token', t), eq.token);
      await pg.goto(`http://localhost:${PORT + 1}/app`);
      await pg.getByRole('dialog', { name: 'Novidades do Resenha' }).getByRole('button', { name: 'Entendi' }).click({ timeout: 5000 }).catch(() => {});
      await pg.getByRole('button', { name: 'Denúncias' }).click();
      await pg.getByRole('tab', { name: 'Lista de espera' }).click();
      await pg.getByLabel('Código de convite para Davi').fill('davi-vip');
      await pg.getByLabel('Limite de contas para Davi').fill('2');
      await pg.getByRole('button', { name: 'Enviar convite por e-mail' }).click();
      await pg.locator('.wait-invite').getByText('DAVI-VIP').waitFor();
      await pg.getByText('entrou como @marina').waitFor();
      await pg.screenshot({ path: `${shots}/83-lista-de-espera-convite.png` });
      const dm = outbox().filter((m) => m.to === 'davi@exemplo.com').at(-1);
      expect(dm?.code === 'DAVI-VIP' && /a sua e mais 1 amigo\./.test(dm.text), `e-mail do Davi: ${dm?.text}`);
      step('no painel: digita o código DAVI-VIP e o limite 2, clica em "Enviar convite por e-mail" e o e-mail sai');
    } finally {
      await b2.close();
    }
  } finally {
    s2.kill();
  }
  console.log('\nTudo certo com os códigos de convite.');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
