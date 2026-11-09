import { useEffect, useState, type FormEvent } from 'react';
import { EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { SOURCE_URL } from './LegalPage';

interface Props {
  hasInvite: boolean;
  onAuthenticated(token: string): Promise<void>;
}

type Mode = 'login' | 'register' | 'recover';

/** Força da senha (só uma dica visual; quem decide é o servidor). */
export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (!pw) return { score: 0, label: '' };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  if (pw.length < 8) return { score: 0, label: 'Curta demais (mínimo 8)' };
  if (s <= 2) return { score: 1, label: 'Fraca' };
  if (s <= 3) return { score: 2, label: 'Boa' };
  return { score: 3, label: 'Forte' };
}

export function StrengthMeter({ password }: { password: string }) {
  const { score, label } = passwordStrength(password);
  if (!password) return null;
  return (
    <div className={`strength s${score}`} aria-live="polite">
      <span className="strength-bar">
        <i />
        <i />
        <i />
      </span>
      <span className="small">{label}</span>
    </div>
  );
}

export function AuthScreen({ hasInvite, onAuthenticated }: Props) {
  const [mode, setMode] = useState<Mode>(hasInvite ? 'register' : 'login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [otp, setOtp] = useState('');
  const [needs2fa, setNeeds2fa] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [accept, setAccept] = useState(false);
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ registrationRequiresCode: boolean }>('/config')
      .then((c) => setNeedsCode(c.registrationRequiresCode))
      .catch(() => {});
  }, []);

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setNeeds2fa(false);
    setOtp('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      let res: { token: string; codesLeft?: number };
      if (mode === 'login') {
        res = await api('/auth/login', { body: { username, password, ...(needs2fa ? { code: otp } : {}) } });
      } else if (mode === 'register') {
        res = await api('/auth/register', {
          body: { username, password, displayName: displayName || undefined, registrationCode: code || undefined, acceptTerms: accept },
        });
      } else {
        res = await api('/auth/recover', { body: { username, code: recoveryCode, password } });
        if (res.codesLeft !== undefined && res.codesLeft <= 2) {
          alert(`Senha trocada! Restam ${res.codesLeft} códigos de recuperação. Gere novos em Configurações → Segurança e privacidade.`);
        }
      }
      await onAuthenticated(res.token);
    } catch (err) {
      if (err instanceof ApiError && err.data.need2fa) {
        setNeeds2fa(true);
        if (needs2fa) setError(err.message);
      } else setError((err as Error).message);
      setBusy(false);
    }
  }

  const title = mode === 'recover' ? 'Recuperar a conta' : null;
  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <img src="/icon.svg" alt="" width={48} height={48} />
          <h1>Resenha</h1>
        </div>
        <p className="muted">
          {title
            ? 'Use um dos códigos de recuperação que você guardou para criar uma senha nova.'
            : hasInvite
              ? 'Você recebeu um convite! Crie sua conta ou entre para aceitar.'
              : 'Chat, voz e transmissão de tela em alta qualidade com os amigos.'}
        </p>

        {mode !== 'recover' && (
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => switchMode('login')}>
              Entrar
            </button>
            <button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => switchMode('register')}>
              Criar conta
            </button>
          </div>
        )}

        {needs2fa && mode === 'login' ? (
          <label>
            Código de verificação
            <input
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              placeholder="6 dígitos do app autenticador"
              maxLength={12}
            />
            <span className="muted small">Perdeu o celular? Digite um dos seus códigos de recuperação (ex.: ABCD-EFGH).</span>
          </label>
        ) : (
          <>
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
            {mode === 'recover' && (
              <label>
                Código de recuperação
                <input
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value)}
                  autoCapitalize="characters"
                  autoComplete="off"
                  required
                  placeholder="ex.: ABCD-EFGH"
                />
              </label>
            )}
            <label>
              {mode === 'recover' ? 'Nova senha' : 'Senha'}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={mode === 'login' ? undefined : 8}
              />
              {mode !== 'login' && <StrengthMeter password={password} />}
            </label>
            {mode === 'register' && needsCode && (
              <label>
                Código de cadastro
                <input value={code} onChange={(e) => setCode(e.target.value)} required placeholder="Peça para quem criou o site" />
              </label>
            )}
            {mode === 'register' && (
              <label className="check terms-check">
                <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} required />
                <span>
                  Tenho 13 anos ou mais e li e aceito os{' '}
                  <a href="/termos" target="_blank" rel="noopener">
                    Termos de uso
                  </a>{' '}
                  e a{' '}
                  <a href="/privacidade" target="_blank" rel="noopener">
                    Política de Privacidade
                  </a>
                  .
                </span>
              </label>
            )}
          </>
        )}

        {error && <p className="error">{error}</p>}
        <button className="btn primary block" disabled={busy || (mode === 'register' && !accept)}>
          {busy ? 'Aguarde…' : mode === 'login' ? (needs2fa ? 'Confirmar' : 'Entrar') : mode === 'register' ? 'Criar conta' : 'Trocar senha e entrar'}
        </button>
        {mode === 'login' && !needs2fa && (
          <button type="button" className="link-btn auth-forgot" onClick={() => switchMode('recover')}>
            Esqueci minha senha
          </button>
        )}
        {(mode === 'recover' || needs2fa) && (
          <button type="button" className="link-btn auth-forgot" onClick={() => switchMode('login')}>
            Voltar para o login
          </button>
        )}

        <ul className="trust" aria-label="Sua privacidade">
          <li>
            <Lock size={14} /> Senha criptografada, ninguém consegue ver
          </li>
          <li>
            <EyeOff size={14} /> Sem anúncios, sem rastreadores, não vendemos dados
          </li>
          <li>
            <ShieldCheck size={14} /> Chamadas criptografadas e não gravadas
          </li>
        </ul>
        <p className="trust-links small">
          <a href="/privacidade" target="_blank" rel="noopener">
            Privacidade
          </a>
          <span>·</span>
          <a href="/termos" target="_blank" rel="noopener">
            Termos
          </a>
          <span>·</span>
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
            Código público
          </a>
        </p>
      </form>
    </div>
  );
}
