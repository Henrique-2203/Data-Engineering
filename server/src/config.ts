import { fileURLToPath } from 'node:url';

const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL || null,
  dataDir: process.env.DATA_DIR || './data/pglite',
  registrationCode: process.env.REGISTRATION_CODE || null,
  maxVoicePeers: Number(process.env.MAX_VOICE_PEERS ?? 10),
  turn: {
    urls: list(process.env.TURN_URLS),
    username: process.env.TURN_USERNAME || undefined,
    credential: process.env.TURN_CREDENTIAL || undefined,
  },
  cloudflareTurn: {
    keyId: process.env.CLOUDFLARE_TURN_KEY_ID || null,
    apiToken: process.env.CLOUDFLARE_TURN_API_TOKEN || null,
  },
  clientDist: fileURLToPath(new URL('../../client/dist', import.meta.url)),
};
