import { useEffect, useState, type FormEvent } from 'react';
import { EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { SOURCE_URL } from './LegalPage';
import { Turnstile } from './Turnstile';

interface Props {
  hasInvite: boolean;
  onAuthenticated(): Promise<void>;
}

/** recover = código de recuperação guardado; forgot/reset = código enviado por e-mail */
type Mode = 'login' | 'register' | 'recover' | 'forgot' | 'reset';

/** Força da senha (só uma dica visual; quem decide é o servidor). */
export function passwordStrength(pw: string): {
  score: 0 | 1 | 2 | 3;
  label: string;
} {
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
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [emailOn, setEmailOn] = useState(false);
  /** o servidor pediu o captcha (login depois de erros) */
  const [needCaptcha, setNeedCaptcha] = useState(false);
  const [captcha, setCaptcha] = useState('');
  /** cada resposta do captcha vale uma vez: muda a chave para gerar outra */
  const [captchaRound, setCaptchaRound] = useState(0);
  const [emailCode, setEmailCode] = useState('');

  useEffect(() => {
    api<{
      registrationRequiresCode: boolean;
      turnstileSiteKey: string | null;
      emailEnabled: boolean;
    }>('/config')
      .then((c) => {
        setNeedsCode(c.registrationRequiresCode);
        setSiteKey(c.turnstileSiteKey);
        setEmailOn(c.emailEnabled);
      })
      .catch(() => {});
  }, []);

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setInfo(null);
    setNeeds2fa(false);
    setOtp('');
    setCaptcha('');
    setCaptchaRound((n) => n + 1);
  }

  const showCaptcha = !!siteKey && (mode === 'register' || mode === 'forgot' || (mode === 'login' && needCaptcha));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      let res: { codesLeft?: number; passwordLeaked?: boolean };
      if (mode === 'forgot') {
        const r = await api<{ message: string }>('/auth/forgot', {
          body: { login: username, captcha: captcha || undefined },
        });
        setMode('reset');
        setInfo(r.message);
        setBusy(false);
        return;
      }
      if (mode === 'login') {
        res = await api('/auth/login', {
          body: {
            username,
            password,
            captcha: captcha || undefined,
            ...(needs2fa ? { code: otp } : {}),
          },
        });
      } else if (mode === 'register') {
        res = await api('/auth/register', {
          body: {
            username,
            password,
            displayName: displayName || undefined,
            registrationCode: code || undefined,
            acceptTerms: accept,
            captcha: captcha || undefined,
          },
        });
      } else if (mode === 'reset') {
        res = await api('/auth/reset', {
          body: {
            login: username,
            code: emailCode,
            password,
            ...(needs2fa ? { totp: otp } : {}),
          },
        });
      } else {
        res = await api('/auth/recover', {
          body: { username, code: recoveryCode, password },
        });
        if (res.codesLeft !== undefined && res.codesLeft <= 2) {
          alert(`Senha trocada! Restam ${res.codesLeft} códigos de recuperação. Gere novos em Configurações → Segurança e privacidade.`);
        }
      }
      if (res.passwordLeaked) {
        alert(
          '⚠️ Atenção: a senha que você usou apareceu em vazamentos de dados de OUTROS sites.\n\nCriminosos testam essas senhas em todo lugar. Troque agora em Configurações → Segurança e privacidade (e não repita senhas entre sites).',
        );
      }
      await onAuthenticated();
    } catch (err) {
      if (err instanceof ApiError && err.data.needCaptcha) setNeedCaptcha(true);
      if (err instanceof ApiError && err.data.need2fa) {
        setNeeds2fa(true);
        if (needs2fa) setError(err.message);
      } else setError((err as Error).message);
      // a resposta do captcha já foi usada: gera outra
      setCaptcha('');
      setCaptchaRound((n) => n + 1);
      setBusy(false);
    }
  }

  const title = mode === 'recover' || mode === 'forgot' || mode === 'reset' ? 'Recuperar a conta' : null;
  const subtitle =
    mode === 'recover'
      ? 'Use um dos códigos de recuperação que você guardou para criar uma senha nova.'
      : mode === 'forgot'
        ? 'Digite seu usuário ou o e-mail confirmado na conta. Vamos enviar um código para o e-mail.'
        : 'Digite o código que chegou no seu e-mail e escolha uma senha nova.';
  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <img src="/icon.svg" alt="" width={48} height={48} />
          <h1>Resenha</h1>
        </div>
        <p className="muted">
          {title
            ? subtitle
            : hasInvite
              ? 'Você recebeu um convite! Crie sua conta ou entre para aceitar.'
              : 'Chat, voz e transmissão de tela em alta qualidade com os amigos.'}
        </p>

        {!title && (
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => switchMode('login')}>
              Entrar
            </button>
            <button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => switchMode('register')}>
              Criar conta
            </button>
          </div>
        )}

        {needs2fa && (mode === 'login' || mode === 'reset') ? (
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
              {mode === 'forgot' || mode === 'reset' ? 'Usuário ou e-mail' : 'Usuário'}
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                placeholder={mode === 'forgot' || mode === 'reset' ? 'ex.: joao_silva ou joao@email.com' : 'ex.: joao_silva'}
              />
            </label>
            {mode === 'reset' && (
              <label>
                Código do e-mail
                <input
                  value={emailCode}
                  onChange={(e) => setEmailCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  placeholder="6 dígitos"
                  maxLength={12}
                />
              </label>
            )}
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
            {mode !== 'forgot' && (
              <label>
                {mode === 'recover' || mode === 'reset' ? 'Nova senha' : 'Senha'}
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
            )}
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

        {showCaptcha && <Turnstile key={captchaRound} siteKey={siteKey!} onToken={setCaptcha} onError={setError} />}
        {info && <p className="notice">{info}</p>}
        {error && <p className="error">{error}</p>}
        <button className="btn primary block" disabled={busy || (mode === 'register' && !accept) || (showCaptcha && !captcha)}>
          {busy
            ? 'Aguarde…'
            : showCaptcha && !captcha
              ? 'Verificando que você não é um robô…'
              : mode === 'login'
                ? needs2fa
                  ? 'Confirmar'
                  : 'Entrar'
                : mode === 'register'
                  ? 'Criar conta'
                  : mode === 'forgot'
                    ? 'Enviar código'
                    : 'Trocar senha e entrar'}
        </button>
        {mode === 'login' && !needs2fa && (
          <button type="button" className="link-btn auth-forgot" onClick={() => switchMode(emailOn ? 'forgot' : 'recover')}>
            Esqueci minha senha
          </button>
        )}
        {(mode === 'forgot' || mode === 'reset') && (
          <button type="button" className="link-btn auth-forgot" onClick={() => switchMode('recover')}>
            Tenho um código de recuperação
          </button>
        )}
        {mode === 'recover' && emailOn && (
          <button type="button" className="link-btn auth-forgot" onClick={() => switchMode('forgot')}>
            Receber um código por e-mail
          </button>
        )}
        {(title || needs2fa) && (
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
