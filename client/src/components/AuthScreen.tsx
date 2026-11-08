import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';

interface Props {
  hasInvite: boolean;
  onAuthenticated(token: string): Promise<void>;
}

export function AuthScreen({ hasInvite, onAuthenticated }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>(hasInvite ? 'register' : 'login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ registrationRequiresCode: boolean }>('/config')
      .then((c) => setNeedsCode(c.registrationRequiresCode))
      .catch(() => {});
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body =
        mode === 'login'
          ? { username, password }
          : { username, password, displayName: displayName || undefined, registrationCode: code || undefined };
      const res = await api<{ token: string }>(`/auth/${mode}`, { body });
      await onAuthenticated(res.token);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <img src="/icon.svg" alt="" width={48} height={48} />
          <h1>Resenha</h1>
        </div>
        <p className="muted">
          {hasInvite
            ? 'Você recebeu um convite! Crie sua conta ou entre para aceitar.'
            : 'Chat, voz e transmissão de tela em alta qualidade com os amigos.'}
        </p>

        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => setMode('login')}>
            Entrar
          </button>
          <button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => setMode('register')}>
            Criar conta
          </button>
        </div>

        <label>
          Usuário
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            placeholder="ex.: joao_silva"
          />
        </label>
        {mode === 'register' && (
          <label>
            Nome de exibição <span className="muted">(opcional)</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Como seus amigos te veem" maxLength={32} />
          </label>
        )}
        <label>
          Senha
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'register' ? 6 : undefined}
          />
        </label>
        {mode === 'register' && needsCode && (
          <label>
            Código de cadastro
            <input value={code} onChange={(e) => setCode(e.target.value)} required placeholder="Peça para quem criou o site" />
          </label>
        )}

        {error && <p className="error">{error}</p>}
        <button className="btn primary block" disabled={busy}>
          {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
        </button>
      </form>
    </div>
  );
}
