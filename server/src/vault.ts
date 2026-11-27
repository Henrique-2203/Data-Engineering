import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Segredos guardados no banco criptografados (DB-07): o segredo do app autenticador (2FA) e o segredo de
 * assinatura dos bots. A chave vem de SECRETS_KEY (variável do servidor, que NÃO fica no banco): quem roubar só
 * o banco (um backup, um acesso indevido) não consegue usar esses segredos.
 * Sem SECRETS_KEY nada muda (continua como antes). Valores antigos, sem criptografia, continuam funcionando.
 */
const PREFIX = 'enc:v1:';
const key = (): Buffer | null => {
  const raw = process.env.SECRETS_KEY ?? '';
  return raw.length >= 16 ? createHash('sha256').update(`resenha-vault|${raw}`).digest() : null;
};

export const vaultEnabled = () => !!key();

export function sealSecret(plain: string): string {
  const k = key();
  if (!k) return plain;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), data]).toString('base64url');
}

/** devolve o segredo em texto, ou null se não der para abrir (chave errada/ausente ou valor adulterado) */
export function openSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) return stored; // valor antigo, sem criptografia
  const k = key();
  if (!k) return null;
  try {
    const buf = Buffer.from(stored.slice(PREFIX.length), 'base64url');
    const d = createDecipheriv('aes-256-gcm', k, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
