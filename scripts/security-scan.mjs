// Varredura de segredos (checklist SEC-01/02/03/10): arquivos do repositório, HISTÓRICO inteiro do git e o site compilado.
//   node scripts/security-scan.mjs            (roda no CI a cada envio)
//   node scripts/security-scan.mjs --self-test (prova que o detector pega segredos de mentira)
// Se achar algo: NÃO basta apagar o commit — troque (rotacione) a chave no provedor.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const PATTERNS = [
  ['chave da Anthropic', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['chave da Brevo', /xkeysib-[a-f0-9]{30,}/],
  ['chave secreta (sk_live/sk_test)', /sk_(live|test)_[A-Za-z0-9]{16,}/],
  ['chave AWS/R2 (AKIA)', /AKIA[0-9A-Z]{16}/],
  ['token do GitHub', /(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|gho_[A-Za-z0-9]{30,})/],
  ['chave privada', /-----BEGIN (RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/],
  ['URL de banco com senha', /postgres(ql)?:\/\/[^\s"'<>:@/]+:(?!SENHA|senha|password|\*+|\$|\{|<|%)[^\s"'<>@]{6,}@(?!localhost|127\.)/],
  ['Turnstile/Cloudflare secret', /\b0x4[A-Za-z0-9_-]{30,}\b/],
  ['segredo do Slack/Discord', /(xox[baprs]-[A-Za-z0-9-]{20,}|[MN][A-Za-z0-9]{23}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27})/],
  ['JWT assinado', /eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,}/],
];
// nomes que NUNCA devem existir no site compilado (vazam permissões de servidor)
const BUNDLE_WORDS = [/service_role/i, /BEGIN [A-Z ]*PRIVATE KEY/, /sk-ant-/, /xkeysib-/, /ANTHROPIC_API_KEY\s*[:=]\s*["'][^"']+["']/, /BACKUP_KEY\s*[:=]\s*["'][^"']+["']/];

export function scanText(text) {
  const hits = [];
  for (const [name, re] of PATTERNS) if (re.test(text)) hits.push(name);
  return hits;
}

if (process.argv.includes('--self-test')) {
  const fake = [
    `ANTHROPIC=${'sk-ant-'}${'a'.repeat(30)}`, `k=${'xkeysib-'}${'a1'.repeat(20)}`, `x=${'AKIA'}${'ABCDEFGHIJKLMNOP'}`,
    `token=${'ghp_'}${'A1'.repeat(20)}`, `-----BEGIN ${'RSA '}PRIVATE KEY-----`, `postgresql://usuario:${'Xy12ab34zz'}@db.exemplo.com/app`,
  ];
  for (const f of fake) if (!scanText(f).length) throw new Error(`FALHOU: o detector não pegou: ${f.slice(0, 24)}…`);
  for (const ok of ['postgresql://usuario:SENHA@localhost/app', 'const a = 1', 'DATABASE_URL=', 'postgresql://u:senha@host/x']) if (scanText(ok).length) throw new Error(`FALHOU: falso alarme: ${ok}`);
  console.log('✓ detector de segredos: pega 6 tipos de segredo falso e não dá alarme falso em exemplos de documentação');
  process.exit(0);
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
const problems = [];

// 1) .env nunca no repositório (só o .env.example, que tem só nomes)
for (const f of git('ls-files').split('\n').filter(Boolean)) {
  if (/(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.env.example')) problems.push(`arquivo .env no repositório: ${f}`);
  if (/\.(pem|key|p12|pfx|keystore|jks)$/i.test(f)) problems.push(`arquivo de chave no repositório: ${f}`);
}

// 2) conteúdo dos arquivos atuais
for (const f of git('ls-files').split('\n').filter(Boolean)) {
  if (/\.(png|jpe?g|webp|gif|ico|mp4|webm|wav|mp3|woff2?|wasm|zip|gz|br|jar|apk|y4m)$/i.test(f) || !existsSync(f)) continue;
  let text;
  try {
    if (statSync(f).size > 3_000_000) continue;
    text = readFileSync(f, 'utf8');
  } catch { continue; }
  if (f === 'scripts/security-scan.mjs') continue;
  for (const h of scanText(text)) problems.push(`${h} em ${f}`);
}

// 3) histórico inteiro do git (todas as versões de todos os arquivos)
const hist = git('log', '--all', '-p', '--no-color', '--pretty=format:@@%h', '--', '.', ':(exclude)package-lock.json', ':(exclude)promo/out');
let commit = '';
for (const line of hist.split('\n')) {
  if (line.startsWith('@@')) { commit = line.slice(2); continue; }
  if (!line.startsWith('+') || line.startsWith('+++')) continue;
  for (const h of scanText(line)) problems.push(`${h} no histórico (commit ${commit})`);
}

// 4) o site compilado (se existir)
const dist = 'client/dist';
if (existsSync(dist)) {
  const walk = (d) => readdirSync(d).flatMap((n) => (statSync(path.join(d, n)).isDirectory() ? walk(path.join(d, n)) : [path.join(d, n)]));
  for (const f of walk(dist).filter((x) => /\.(js|css|html|map|json|webmanifest)$/.test(x))) {
    const t = readFileSync(f, 'utf8');
    for (const re of BUNDLE_WORDS) if (re.test(t)) problems.push(`no site compilado (${f}): ${re}`);
    for (const h of scanText(t)) problems.push(`${h} no site compilado (${f})`);
  }
}

const unique = [...new Set(problems)];
if (unique.length) {
  console.error(`✗ ${unique.length} problema(s) de segredo:\n- ${unique.join('\n- ')}\nSe for uma chave de verdade: TROQUE a chave no provedor (apagar o commit não basta).`);
  process.exit(1);
}
console.log('✓ varredura de segredos: repositório, histórico do git e site compilado sem chaves nem arquivos .env');
