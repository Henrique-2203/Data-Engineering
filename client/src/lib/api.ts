/**
 * Login: fica num cookie protegido (HttpOnly) que scripts da página não conseguem ler.
 * O site só guarda um aviso "tem sessão" (sem nada secreto) para saber se mostra a tela de entrada.
 *
 * Versões antigas guardavam o token aqui no localStorage: ele é trocado pelo cookie na primeira
 * abertura (migrateLegacySession) e apagado.
 */
const LEGACY_TOKEN_KEY = 'resenha.token';
const HINT_KEY = 'resenha.session';

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    /* modo privado: segue sem persistir */
  }
};

/** Token antigo (só existe até a migração para o cookie). */
const legacyToken = () => read(LEGACY_TOKEN_KEY);

/** Parece haver uma sessão (para decidir entre "Conectando…" e a tela de entrada). */
export const hasSession = () => read(HINT_KEY) === '1' || !!legacyToken();
export const markSession = (on: boolean) => {
  write(HINT_KEY, on ? '1' : null);
  if (!on) write(LEGACY_TOKEN_KEY, null);
};

/** Cabeçalhos de autenticação: vazio (o cookie vai sozinho), exceto durante a migração do token antigo. */
export const authHeaders = (): Record<string, string> => {
  const t = legacyToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

/** Troca o token antigo do localStorage pelo cookie protegido, e apaga o antigo. */
export async function migrateLegacySession() {
  const t = legacyToken();
  if (!t) return;
  const res = await fetch('/api/auth/cookie', { method: 'POST', headers: { Authorization: `Bearer ${t}` } }).catch(() => null);
  if (res?.ok) {
    write(LEGACY_TOKEN_KEY, null);
    write(HINT_KEY, '1');
  } else if (res?.status === 401) {
    markSession(false);
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** corpo completo da resposta de erro (ex.: { need2fa: true }) */
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: {
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...authHeaders(),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && hasSession() && !path.startsWith('/auth/')) onUnauthorized?.();
    throw new ApiError(res.status, data.error ?? `Erro ${res.status}`, data);
  }
  return data as T;
}
