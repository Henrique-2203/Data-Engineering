import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, Eye, EyeOff, Loader2, Lock, MailCheck, ShieldCheck, X } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { SOURCE_URL } from './LegalPage';
import { Turnstile } from './Turnstile';

interface Props {
  hasInvite: boolean;
  onAuthenticated(): Promise<void>;
}

/**
 * register → verify: cadastro com e-mail confirmado (a conta só nasce depois do código)
 * recover = código de recuperação guardado; forgot/reset = código enviado por e-mail
 */
type Mode = 'login' | 'register' | 'verify' | 'recover' | 'forgot' | 'reset';

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

export function StrengthMeter({ password, id }: { password: string; id?: string }) {
  const { score, label } = passwordStrength(password);
  if (!password) return null;
  return (
    <div className={`strength s${score}`} aria-live="polite" id={id}>
      <span className="strength-bar">
        <i />
        <i />
        <i />
      </span>
      <span className="small">{label}</span>
    </div>
  );
}

/** link de convite com código: /app?convite=LARI-7K3P (já abre o cadastro com o código preenchido) */
const codeFromUrl = (() => {
  try {
    return (new URLSearchParams(location.search).get('convite') ?? '').trim().slice(0, 24);
  } catch {
    return '';
  }
})();

export function AuthScreen({ hasInvite, onAuthenticated }: Props) {
  const [mode, setMode] = useState<Mode>(hasInvite || codeFromUrl ? 'register' : 'login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState(codeFromUrl);
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
  /** cadastro aguardando o código do e-mail */
  const [pending, setPending] = useState<{ id: string; sentTo: string } | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [nameCheck, setNameCheck] = useState<{ name: string; available: boolean; reason?: string } | null>(null);

  useEffect(() => {
    api<{ registrationRequiresCode: boolean; turnstileSiteKey: string | null; emailEnabled: boolean }>('/config')
      .then((c) => {
        setNeedsCode(c.registrationRequiresCode);
        setSiteKey(c.turnstileSiteKey);
        setEmailOn(c.emailEnabled);
      })
      .catch(() => {});
  }, []);

  // nome de usuário disponível? (confere enquanto a pessoa digita, com uma pequena espera)
  const cleanName = username.trim().toLowerCase().replace(/^@/, '');
  useEffect(() => {
    if (mode !== 'register' || cleanName.length < 3) return setNameCheck(null);
    const t = setTimeout(() => {
      void api<{ available: boolean; reason?: string }>(`/auth/username-available?u=${encodeURIComponent(cleanName)}`).then(
        (r) => setNameCheck({ name: cleanName, ...r }),
        () => {},
      );
    }, 350);
    return () => clearTimeout(t);
  }, [cleanName, mode]);

  // contagem para "reenviar código"
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

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

  async function finish(res: { codesLeft?: number; passwordLeaked?: boolean }) {
    if (res.codesLeft !== undefined && res.codesLeft <= 2) {
      alert(`Senha trocada! Restam ${res.codesLeft} códigos de recuperação. Gere novos em Configurações → Segurança.`);
    }
    if (res.passwordLeaked) {
      alert(
        '⚠️ Atenção: a senha que você usou apareceu em vazamentos de dados de OUTROS sites.\n\nCriminosos testam essas senhas em todo lugar. Troque agora em Configurações → Segurança (e não repita senhas entre sites).',
      );
    }
    await onAuthenticated();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'forgot') {
        const r = await api<{ message: string }>('/auth/forgot', { body: { login: username, captcha: captcha || undefined } });
        setMode('reset');
        setInfo(r.message);
        setBusy(false);
        return;
      }
      if (mode === 'register' && emailOn) {
        const r = await api<{ pendingId: string; sentTo: string }>('/auth/register/start', {
          body: {
            email,
            username: cleanName,
            password,
            displayName: displayName || undefined,
            registrationCode: code || undefined,
            acceptTerms: accept,
            captcha: captcha || undefined,
          },
        });
        setPending({ id: r.pendingId, sentTo: r.sentTo });
        setEmailCode('');
        setResendIn(45);
        setMode('verify');
        setBusy(false);
        return;
      }
      if (mode === 'verify') {
        return await finish(await api('/auth/register/confirm', { body: { pendingId: pending!.id, code: emailCode } }));
      }
      if (mode === 'login') {
        return await finish(await api('/auth/login', { body: { username, password, captcha: captcha || undefined, ...(needs2fa ? { code: otp } : {}) } }));
      }
      if (mode === 'register') {
        return await finish(
          await api('/auth/register', {
            body: { username: cleanName, password, displayName: displayName || undefined, registrationCode: code || undefined, acceptTerms: accept, captcha: captcha || undefined },
          }),
        );
      }
      if (mode === 'reset') {
        return await finish(await api('/auth/reset', { body: { login: username, code: emailCode, password, ...(needs2fa ? { totp: otp } : {}) } }));
      }
      await finish(await api('/auth/recover', { body: { username, code: recoveryCode, password } }));
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

  async function resend() {
    if (!pending || resendIn > 0) return;
    setError(null);
    try {
      const r = await api<{ sentTo: string }>('/auth/register/resend', { body: { pendingId: pending.id } });
      setInfo(`Enviamos um código novo para ${r.sentTo}.`);
      setResendIn(45);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const recovering = mode === 'recover' || mode === 'forgot' || mode === 'reset';
  const subtitle =
    mode === 'recover'
      ? 'Use um dos códigos de recuperação que você guardou para criar uma senha nova.'
      : mode === 'forgot'
        ? 'Digite seu usuário ou e-mail. Vamos enviar um código para o e-mail da conta.'
        : mode === 'reset'
          ? 'Digite o código que chegou no seu e-mail e escolha uma senha nova.'
          : hasInvite
            ? 'Você recebeu um convite! Crie sua conta ou entre para aceitar.'
            : 'Chat, voz e transmissão de tela em alta qualidade com os amigos.';

  const passwordField = (label: string, autoComplete: string) => (
    <label>
      {label}
      <span className="input-with-action">
        <input
          type={showPassword ? 'text' : 'password'}
          aria-label={label}
          aria-describedby={mode !== 'login' ? 'password-strength' : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={autoComplete}
          required
          minLength={mode === 'login' ? undefined : 8}
        />
        <button
          type="button"
          className="icon-btn"
          aria-label={showPassword ? 'Esconder senha' : 'Mostrar senha'}
          title={showPassword ? 'Esconder senha' : 'Mostrar senha'}
          onClick={() => setShowPassword((v) => !v)}
        >
          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
      {mode !== 'login' && <StrengthMeter password={password} id="password-strength" />}
    </label>
  );

  const submitLabel = busy
    ? 'Aguarde…'
    : showCaptcha && !captcha
      ? 'Verificando que você não é um robô…'
      : mode === 'login'
        ? needs2fa
          ? 'Confirmar'
          : 'Entrar'
        : mode === 'register'
          ? emailOn
            ? 'Continuar'
            : 'Criar conta'
          : mode === 'verify'
            ? 'Confirmar e criar conta'
            : mode === 'forgot'
              ? 'Enviar código'
              : 'Trocar senha e entrar';

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <img src="/icon.svg" alt="" width={48} height={48} />
          <h1>Resenha</h1>
        </div>

        {mode === 'verify' && pending ? (
          <>
            <div className="auth-verify">
              <MailCheck size={40} />
              <h2>Confirme seu e-mail</h2>
              <p className="muted">
                Enviamos um código de 6 dígitos para <strong>{pending.sentTo}</strong>. Ele vale por 15 minutos.
              </p>
            </div>
            <label>
              Código
              <input
                className="code-input"
                value={emailCode}
                onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                placeholder="000000"
                maxLength={6}
              />
            </label>
            <p className="muted small">Não chegou? Confira a pasta de spam ou promoções.</p>
          </>
        ) : (
          <>
            <p className="muted">{subtitle}</p>
            {!recovering && (
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
            ) : mode === 'register' ? (
              <>
                {emailOn && (
                  <label>
                    E-mail
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      required
                      placeholder="voce@email.com"
                    />
                    <span className="muted small">Para confirmar que é você e recuperar a conta. Nunca mandamos propaganda.</span>
                  </label>
                )}
                <label>
                  Nome de usuário
                  <span className="input-with-action">
                    <span className="input-prefix">@</span>
                    <input
                      value={username}
                      onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      required
                      placeholder="joao_silva"
                      maxLength={24}
                    />
                    {nameCheck?.name === cleanName && (
                      <span className={`name-check ${nameCheck.available ? 'ok' : 'bad'}`} aria-hidden>
                        {nameCheck.available ? <Check size={16} /> : <X size={16} />}
                      </span>
                    )}
                    {cleanName.length >= 3 && nameCheck?.name !== cleanName && <Loader2 size={16} className="spin name-check" aria-hidden />}
                  </span>
                  <span className={`small ${nameCheck?.name === cleanName && !nameCheck.available ? 'error-text' : 'muted'}`} aria-live="polite">
                    {nameCheck?.name === cleanName && !nameCheck.available
                      ? nameCheck.reason
                      : nameCheck?.name === cleanName
                        ? `@${cleanName} está disponível.`
                        : 'Letras minúsculas, números, _ ou ponto. É como seus amigos te encontram.'}
                  </span>
                </label>
                <label>
                  Nome de exibição <span className="muted">(opcional)</span>
                  <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Como seus amigos te veem" maxLength={32} />
                </label>
                {passwordField('Senha', 'new-password')}
                {needsCode && (
                  <label>
                    Código de convite
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      required
                      autoCapitalize="characters"
                      spellCheck={false}
                      maxLength={24}
                      placeholder="Ex.: LARI-7K3P"
                    />
                    <span className="muted small">Peça para um amigo que já usa o Resenha.</span>
                  </label>
                )}
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
              </>
            ) : (
              <>
                <label>
                  {mode === 'recover' ? 'Usuário' : 'Usuário ou e-mail'}
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    required
                    placeholder={mode === 'recover' ? 'ex.: joao_silva' : 'ex.: joao_silva ou joao@email.com'}
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
                {mode !== 'forgot' && passwordField(mode === 'login' ? 'Senha' : 'Nova senha', mode === 'login' ? 'current-password' : 'new-password')}
              </>
            )}
          </>
        )}

        {showCaptcha && <Turnstile key={captchaRound} siteKey={siteKey!} onToken={setCaptcha} onError={setError} />}
        {info && <p className="notice">{info}</p>}
        {error && <p className="error">{error}</p>}
        <button
          className="btn primary block"
          disabled={
            busy ||
            (mode === 'register' && (!accept || (nameCheck?.name === cleanName && !nameCheck.available))) ||
            (mode === 'verify' && emailCode.length !== 6) ||
            (showCaptcha && !captcha)
          }
        >
          {submitLabel}
        </button>

        {mode === 'verify' && (
          <div className="auth-links">
            <button type="button" className="link-btn" disabled={resendIn > 0} onClick={() => void resend()}>
              {resendIn > 0 ? `Reenviar código em ${resendIn}s` : 'Reenviar código'}
            </button>
            <button type="button" className="link-btn" onClick={() => switchMode('register')}>
              <ArrowLeft size={14} /> Corrigir o e-mail
            </button>
          </div>
        )}
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
        {(recovering || needs2fa) && (
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
          <a href="/seguranca" target="_blank" rel="noopener">
            Segurança
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
