import { useEffect, useMemo, useState } from 'react';
import { Download, KeyRound, LogOut, MonitorSmartphone, ShieldCheck, Trash2 } from 'lucide-react';
import { api, getToken } from '../lib/api';
import { toast } from '../store/app';
import { StrengthMeter } from './AuthScreen';

interface SecurityInfo {
  totpEnabled: boolean;
  codesLeft: number;
  passwordChangedAt: string | null;
  createdAt: string;
}
interface Session {
  id: string;
  device: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

const when = (iso: string) => {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 15) return 'agora';
  if (mins < 60 * 24) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
};

/** Mostra os códigos de recuperação uma única vez, com botões para copiar e baixar. */
function CodesBox({ codes, onDone }: { codes: string[]; onDone(): void }) {
  const text = `Códigos de recuperação do Resenha\nCada código funciona uma vez. Guarde em lugar seguro.\n\n${codes.join('\n')}\n`;
  const href = useMemo(() => URL.createObjectURL(new Blob([text], { type: 'text/plain' })), [text]);
  useEffect(() => () => URL.revokeObjectURL(href), [href]);
  return (
    <div className="codes-box" role="region" aria-label="Códigos de recuperação">
      <p>
        <strong>Guarde estes códigos agora.</strong> Eles não serão mostrados de novo. Se você esquecer a senha ou perder o celular do
        autenticador, cada código permite entrar uma vez.
      </p>
      <ul className="codes">
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ul>
      <div className="row gap-s">
        <button className="btn small" onClick={() => void navigator.clipboard?.writeText(text).then(() => toast('Códigos copiados.'))}>
          Copiar
        </button>
        <a className="btn small" href={href} download="resenha-codigos-de-recuperacao.txt">
          Baixar .txt
        </a>
        <button className="btn small primary" onClick={onDone}>
          Já guardei
        </button>
      </div>
    </div>
  );
}

export function SecuritySettings({ onLogout }: { onLogout(): void }) {
  const [info, setInfo] = useState<SecurityInfo | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [panel, setPanel] = useState<'password' | '2fa' | 'disable2fa' | 'codes' | 'delete' | null>(null);

  const load = () => {
    void api<SecurityInfo>('/me/security').then(setInfo, () => {});
    void api<{ sessions: Session[] }>('/me/sessions').then((r) => setSessions(r.sessions), () => {});
  };
  useEffect(load, []);

  async function endSession(id: string) {
    try {
      await api(`/me/sessions/${id}`, { method: 'DELETE' });
      toast('Aparelho desconectado.');
      load();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function endOthers() {
    try {
      const r = await api<{ ended: number }>('/me/sessions/logout-others', { method: 'POST', body: {} });
      toast(r.ended ? `${r.ended} aparelho(s) desconectado(s).` : 'Nenhum outro aparelho estava conectado.');
      load();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function exportData() {
    try {
      const res = await fetch('/api/me/export', { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Não foi possível baixar.');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'resenha-meus-dados.json';
      a.click();
      toast('Seus dados foram baixados.');
    } catch (err) {
      toast((err as Error).message);
    }
  }

  const others = sessions.filter((s) => !s.current).length;
  return (
    <div className="security">
      <h3 className="subhead">
        <ShieldCheck size={18} /> Segurança e privacidade
      </h3>

      {codes && (
        <CodesBox
          codes={codes}
          onDone={() => {
            setCodes(null);
            load();
          }}
        />
      )}

      <div className="sec-row">
        <div>
          <strong>Senha</strong>
          <p className="muted small">{info?.passwordChangedAt ? `Trocada em ${new Date(info.passwordChangedAt).toLocaleDateString('pt-BR')}` : 'Guardada criptografada (ninguém consegue ver).'}</p>
        </div>
        <button className="btn small" onClick={() => setPanel(panel === 'password' ? null : 'password')}>
          <KeyRound size={15} /> Trocar senha
        </button>
      </div>
      {panel === 'password' && <ChangePassword onDone={() => (setPanel(null), load())} />}

      <div className="sec-row">
        <div>
          <strong>Verificação em duas etapas</strong>
          <p className="muted small">
            {info?.totpEnabled ? '✅ Ativada: além da senha, pedimos o código do app autenticador.' : 'Proteja a conta mesmo se alguém descobrir sua senha (Google Authenticator, Authy, Microsoft Authenticator…).'}
          </p>
        </div>
        {info?.totpEnabled ? (
          <button className="btn small ghost danger" onClick={() => setPanel(panel === 'disable2fa' ? null : 'disable2fa')}>
            Desativar
          </button>
        ) : (
          <button className="btn small primary" onClick={() => setPanel(panel === '2fa' ? null : '2fa')}>
            Ativar
          </button>
        )}
      </div>
      {panel === '2fa' && (
        <TwoFactorSetup
          onDone={(c) => {
            setPanel(null);
            setCodes(c);
            load();
          }}
        />
      )}
      {panel === 'disable2fa' && <DisableTwoFactor onDone={() => (setPanel(null), load())} />}

      <div className="sec-row">
        <div>
          <strong>Códigos de recuperação</strong>
          <p className="muted small">
            {info && info.codesLeft > 0
              ? `${info.codesLeft} códigos disponíveis. Servem para entrar se você esquecer a senha.`
              : '⚠️ Você ainda não tem códigos. Sem eles, não dá para recuperar a conta se esquecer a senha.'}
          </p>
        </div>
        <button className="btn small" onClick={() => setPanel(panel === 'codes' ? null : 'codes')}>
          {info && info.codesLeft > 0 ? 'Gerar novos' : 'Gerar códigos'}
        </button>
      </div>
      {panel === 'codes' && (
        <PasswordConfirm
          label="Gerar códigos (os antigos deixam de valer)"
          onConfirm={async (password) => {
            const r = await api<{ codes: string[] }>('/me/recovery-codes', { body: { password } });
            setPanel(null);
            setCodes(r.codes);
          }}
        />
      )}

      <div className="sec-row column">
        <div className="row spread">
          <strong>
            <MonitorSmartphone size={16} /> Aparelhos conectados
          </strong>
          {others > 0 && (
            <button className="btn small ghost" onClick={() => void endOthers()}>
              <LogOut size={15} /> Sair de todos os outros
            </button>
          )}
        </div>
        <ul className="sessions">
          {sessions.map((s) => (
            <li key={s.id}>
              <span>
                <strong>{s.device}</strong>
                {s.current && <span className="badge-current">este aparelho</span>}
                <span className="muted small"> · último acesso {when(s.lastSeenAt)} · desde {new Date(s.createdAt).toLocaleDateString('pt-BR')}</span>
              </span>
              {s.current ? (
                <button className="btn small ghost" onClick={onLogout}>
                  Sair
                </button>
              ) : (
                <button className="btn small ghost" aria-label={`Desconectar ${s.device}`} onClick={() => void endSession(s.id)}>
                  Desconectar
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="muted small">Não reconhece algum aparelho? Desconecte e troque sua senha.</p>
      </div>

      <div className="sec-row">
        <div>
          <strong>Seus dados</strong>
          <p className="muted small">
            Baixe uma cópia de tudo que o Resenha guarda sobre você. Veja a{' '}
            <a href="/privacidade" target="_blank" rel="noopener">
              Política de Privacidade
            </a>
            .
          </p>
        </div>
        <button className="btn small" onClick={() => void exportData()}>
          <Download size={15} /> Baixar meus dados
        </button>
      </div>

      <div className="sec-row danger-zone">
        <div>
          <strong>Excluir minha conta</strong>
          <p className="muted small">Apaga para sempre seu perfil, mensagens, imagens, amizades e os servidores de que você é dono.</p>
        </div>
        <button className="btn small danger" onClick={() => setPanel(panel === 'delete' ? null : 'delete')}>
          <Trash2 size={15} /> Excluir conta
        </button>
      </div>
      {panel === 'delete' && <DeleteAccount needs2fa={!!info?.totpEnabled} onDeleted={onLogout} />}
    </div>
  );
}

function PasswordConfirm({ label, onConfirm }: { label: string; onConfirm(password: string): Promise<void> }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="sec-panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onConfirm(password);
        } catch (err) {
          toast((err as Error).message);
        }
        setBusy(false);
      }}
    >
      <label>
        Confirme sua senha
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </label>
      <button className="btn small primary" disabled={busy || !password}>
        {label}
      </button>
    </form>
  );
}

function ChangePassword({ onDone }: { onDone(): void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="sec-panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const r = await api<{ endedOtherSessions: number }>('/me/password', { body: { current, next } });
          toast(r.endedOtherSessions ? `Senha trocada. ${r.endedOtherSessions} outro(s) aparelho(s) foram desconectados.` : 'Senha trocada.');
          onDone();
        } catch (err) {
          toast((err as Error).message);
        }
        setBusy(false);
      }}
    >
      <label>
        Senha atual
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
      </label>
      <label>
        Nova senha
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required />
        <StrengthMeter password={next} />
      </label>
      <p className="muted small">Por segurança, os outros aparelhos serão desconectados.</p>
      <button className="btn small primary" disabled={busy}>
        Salvar nova senha
      </button>
    </form>
  );
}

function TwoFactorSetup({ onDone }: { onDone(codes: string[]): void }) {
  const [setup, setSetup] = useState<{ secret: string; otpauth: string; qrSvg: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  if (!setup) {
    return (
      <PasswordConfirm
        label="Continuar"
        onConfirm={async (password) => {
          setSetup(await api('/me/2fa/setup', { body: { password } }));
        }}
      />
    );
  }
  return (
    <form
      className="sec-panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const r = await api<{ codes: string[] }>('/me/2fa/enable', { body: { code } });
          toast('Verificação em duas etapas ativada.');
          onDone(r.codes);
        } catch (err) {
          toast((err as Error).message);
        }
        setBusy(false);
      }}
    >
      <ol className="steps">
        <li>Abra o app autenticador no celular (Google Authenticator, Authy, Microsoft Authenticator…).</li>
        <li>Toque em adicionar e escaneie o QR code:</li>
      </ol>
      <img className="qr" alt="QR code para o app autenticador" src={`data:image/svg+xml;base64,${btoa(setup.qrSvg)}`} />
      <p className="muted small">
        Não dá para escanear? Digite a chave: <code className="secret">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
      </p>
      <label>
        3. Digite o código de 6 dígitos que aparece no app
        <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={7} required />
      </label>
      <button className="btn small primary" disabled={busy}>
        Ativar verificação em duas etapas
      </button>
    </form>
  );
}

function DisableTwoFactor({ onDone }: { onDone(): void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  return (
    <form
      className="sec-panel"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api('/me/2fa/disable', { body: { password, code } });
          toast('Verificação em duas etapas desativada.');
          onDone();
        } catch (err) {
          toast((err as Error).message);
        }
      }}
    >
      <label>
        Senha
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </label>
      <label>
        Código do app autenticador (ou de recuperação)
        <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required />
      </label>
      <button className="btn small danger">Desativar</button>
    </form>
  );
}

function DeleteAccount({ needs2fa, onDeleted }: { needs2fa: boolean; onDeleted(): void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="sec-panel danger-zone"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api('/me/delete', { body: { password, confirm, ...(needs2fa ? { code } : {}) } });
          alert('Sua conta foi excluída. Obrigado por ter usado o Resenha.');
          onDeleted();
        } catch (err) {
          toast((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <p>
        <strong>Isso não pode ser desfeito.</strong> Dica: baixe seus dados antes. Os servidores de que você é dono serão excluídos para
        todos os membros.
      </p>
      <label>
        Senha
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </label>
      {needs2fa && (
        <label>
          Código do app autenticador
          <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required />
        </label>
      )}
      <label>
        Digite <strong>EXCLUIR</strong> para confirmar
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" required />
      </label>
      <button className="btn small danger" disabled={busy || confirm !== 'EXCLUIR'}>
        Excluir minha conta para sempre
      </button>
    </form>
  );
}
