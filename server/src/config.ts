import { fileURLToPath } from 'node:url';

const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  /**
   * 'staging' = site de TESTE (aviso no topo, e-mails com [TESTE], fora do Google). Qualquer outro
   * valor (ou nada) = site oficial. O site de teste usa banco, arquivos e chaves próprios.
   */
  appEnv: (process.env.APP_ENV === 'staging' ? 'staging' : 'production') as 'staging' | 'production',
  /** endereço do site oficial (o site de teste mostra um link para ele) */
  officialUrl: process.env.OFFICIAL_URL || 'https://resenha-m2bt.onrender.com',
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL || null,
  dataDir: process.env.DATA_DIR || './data/pglite',
  registrationCode: process.env.REGISTRATION_CODE || null,
  /** contato de privacidade (LGPD) mostrado na Política de Privacidade, ex.: privacidade@seudominio.com */
  privacyContact: process.env.PRIVACY_CONTACT || 'resenha.brasilgames@gmail.com',
  /** equipe do Resenha (nomes de usuário, separados por vírgula): recebe e trata as denúncias */
  platformAdmins: list(process.env.PLATFORM_ADMINS).map((u) => u.toLowerCase().replace(/^@/, '')),
  maxVoicePeers: Number(process.env.MAX_VOICE_PEERS ?? 10),
  /** quanto tempo uma ligação de DM toca antes de virar "não atendeu" */
  ringTimeoutMs: Number(process.env.RING_TIMEOUT_MS ?? 30_000),
  /** tamanho máximo de cada imagem enviada (o navegador já reduz fotos grandes antes) */
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 8),
  /** tamanho máximo do banco: acima disso novos arquivos guardados NO BANCO são recusados (Neon grátis = 512 MB) */
  maxStorageMb: Number(process.env.MAX_STORAGE_MB ?? 450),
  /**
   * Armazenamento de arquivos compatível com S3 (Cloudflare R2: 10 GB grátis, sem custo de download).
   * Sem isso, os arquivos ficam no próprio banco (bom para testar, ruim para crescer).
   */
  r2: {
    endpoint: (process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '')).replace(/\/+$/, ''),
    bucket: process.env.R2_BUCKET || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    region: process.env.R2_REGION || 'auto',
  },
  /** arquivos que não são imagem (vídeo, áudio, PDF, zip...): limite por arquivo */
  maxFileMb: Number(process.env.MAX_FILE_MB ?? 25),
  /** cota de cada pessoa (tudo que ela enviou e ainda existe) */
  userQuotaMb: Number(process.env.USER_QUOTA_MB ?? 500),
  /** cota de cada servidor (arquivos enviados nos canais dele) */
  guildQuotaMb: Number(process.env.GUILD_QUOTA_MB ?? 2048),
  /** quanto cada pessoa pode enviar por dia (contra abuso) */
  userDailyMb: Number(process.env.USER_DAILY_MB ?? 300),
  /** trava de segurança do armazenamento inteiro (R2 grátis = 10 GB) */
  storageLimitGb: Number(process.env.STORAGE_LIMIT_GB ?? 9.5),
  /** chave para criptografar os backups (guarde uma cópia fora do Render!). Sem ela, não há backup. */
  backupKey: process.env.BACKUP_KEY || '',
  /** e-mails de segurança (veja server/src/email.ts) */
  email: {
    provider: (process.env.EMAIL_PROVIDER || '').toLowerCase() as '' | 'brevo' | 'resend' | 'file',
    apiKey: process.env.EMAIL_API_KEY || '',
    from: process.env.EMAIL_FROM || '',
    fromName: process.env.EMAIL_FROM_NAME || 'Resenha',
    outbox: process.env.EMAIL_OUTBOX || './data/outbox.jsonl',
  },
  /** Cloudflare Turnstile: captcha invisível contra robôs no cadastro, login suspeito e recuperação de senha */
  turnstile: {
    siteKey: process.env.TURNSTILE_SITE_KEY || '',
    secret: process.env.TURNSTILE_SECRET_KEY || '',
    verifyUrl: process.env.TURNSTILE_VERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  },
  /** recusa senhas que já apareceram em vazamentos (Have I Been Pwned, sem enviar a senha: k-anonimato) */
  pwnedCheck: process.env.PWNED_CHECK !== 'off',
  pwnedApiUrl: process.env.PWNED_API_URL || 'https://api.pwnedpasswords.com/range/',
  /** quantos dias de backup manter */
  backupKeepDays: Number(process.env.BACKUP_KEEP_DAYS ?? 30),
  turn: {
    urls: list(process.env.TURN_URLS),
    username: process.env.TURN_USERNAME || undefined,
    credential: process.env.TURN_CREDENTIAL || undefined,
  },
  meteredTurn: {
    domain: process.env.METERED_TURN_DOMAIN || null,
    apiKey: process.env.METERED_TURN_API_KEY || null,
  },
  cloudflareTurn: {
    keyId: process.env.CLOUDFLARE_TURN_KEY_ID || null,
    apiToken: process.env.CLOUDFLARE_TURN_API_TOKEN || null,
    /** limite de segurança do mês (MB): ao chegar nele, o TURN da Cloudflare pausa até o mês virar (1.000 GB grátis; padrão 500 GB) */
    limitMb: Number(process.env.CLOUDFLARE_TURN_LIMIT_MB) || 500_000,
  },
  clientDist: fileURLToPath(new URL('../../client/dist', import.meta.url)),
};
