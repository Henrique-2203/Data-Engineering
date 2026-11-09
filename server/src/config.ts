import { fileURLToPath } from 'node:url';

const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
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
  /** tamanho máximo do banco: acima disso novos arquivos são recusados (Neon grátis = 512 MB) */
  maxStorageMb: Number(process.env.MAX_STORAGE_MB ?? 450),
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
  },
  clientDist: fileURLToPath(new URL('../../client/dist', import.meta.url)),
};
