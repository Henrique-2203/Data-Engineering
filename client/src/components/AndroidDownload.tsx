import { useEffect, useState, type ReactNode } from 'react';
import { Bell, Check, Download, Lock, Settings, Smartphone, X } from 'lucide-react';
import { api } from '../lib/api';
import { isAndroidApp } from '../lib/android';

/**
 * App Android (APK) baixado direto do site: botão, passo a passo de instalação (com o "permitir desta fonte",
 * onde as pessoas mais travam) e um aviso dentro do Resenha para quem usa pelo navegador do Android.
 * O link /api/download/android sempre leva à versão mais nova (android/release.json).
 */
export const isAndroidPhone = () => /Android/i.test(navigator.userAgent) && !isAndroidApp();

interface Release {
  versionCode: number;
  versionName: string;
}
let cached: Promise<Release | null> | null = null;
const release = () => (cached ??= api<Release>('/app/android').then((r) => (r.versionCode > 0 ? r : null), () => null));

/** undefined = carregando; null = nenhuma versão publicada */
export function useAndroidRelease() {
  const [r, setR] = useState<Release | null | undefined>(undefined);
  useEffect(() => {
    void release().then(setR);
  }, []);
  return r;
}

/** Baixa o APK e já mostra como instalar. */
export function AndroidDownloadButton({ className = 'lp-btn primary', label }: { className?: string; label?: string }) {
  const r = useAndroidRelease();
  const [help, setHelp] = useState(false);
  if (!r) return null;
  return (
    <>
      <a className={className} href="/api/download/android" onClick={() => setHelp(true)}>
        <Download size={18} /> {label ?? `Baixar app para Android (v${r.versionName})`}
      </a>
      {help && <AndroidSteps onClose={() => setHelp(false)} />}
    </>
  );
}

const STEPS: { icon: ReactNode; title: string; text: string; mock: ReactNode }[] = [
  {
    icon: <Download size={20} />,
    title: 'Baixe o app',
    text: 'O download começa sozinho. Se o celular perguntar, toque em "Baixar mesmo assim": é o app oficial do Resenha.',
    mock: (
      <div className="as-mock">
        <div className="as-notif">
          <Download size={16} /> <span>Resenha.apk</span> <small>Download concluído</small>
        </div>
      </div>
    ),
  },
  {
    icon: <Bell size={20} />,
    title: 'Abra o arquivo',
    text: 'Toque na notificação "Download concluído" (ou abra a pasta Downloads e toque em Resenha.apk).',
    mock: (
      <div className="as-mock">
        <div className="as-notif tap">
          <Download size={16} /> <span>Resenha.apk</span> <small>Toque para abrir</small>
        </div>
      </div>
    ),
  },
  {
    icon: <Lock size={20} />,
    title: 'Permita instalar desta fonte',
    text: 'Na primeira vez, o Android avisa que o app não veio da Play Store. Toque em Configurações e ligue "Permitir desta fonte". Depois volte.',
    mock: (
      <div className="as-mock">
        <div className="as-setting">
          <Settings size={16} /> <span>Permitir desta fonte</span>
          <span className="as-switch on" aria-hidden />
        </div>
      </div>
    ),
  },
  {
    icon: <Check size={20} />,
    title: 'Instale e entre',
    text: 'Toque em Instalar, abra o Resenha e entre com a sua conta. Na primeira call, permita o microfone e as notificações.',
    mock: (
      <div className="as-mock">
        <div className="as-install">
          <img src="/icon.svg" alt="" width={28} height={28} /> <span>Resenha</span>
          <span className="as-btn">Instalar</span>
        </div>
      </div>
    ),
  },
];

export function AndroidSteps({ onClose }: { onClose(): void }) {
  return (
    <div className="lp-modal" role="dialog" aria-modal="true" aria-label="Instalar o app Android" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lp-modal-box as-box">
        <button className="lp-modal-x" aria-label="Fechar" onClick={onClose}>
          <X size={20} />
        </button>
        <img src="/icon.svg" alt="" width={56} height={56} />
        <h3>Instalar o app no Android</h3>
        <ol className="as-steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="as-n">{i + 1}</span>
              <div>
                <strong>{s.title}</strong>
                <p>{s.text}</p>
                {s.mock}
              </div>
            </li>
          ))}
        </ol>
        <p className="lp-small">
          As próximas versões chegam pelo próprio app: ele avisa, baixa e instala por cima, sem perder o login. Não está na Play Store ainda,
          por isso o Android pede essa permissão.
        </p>
      </div>
    </div>
  );
}

const DISMISS = 'resenha.androidBanner';

/** Dentro do Resenha, no navegador do Android: card no menu lateral, acima do perfil (não cobre nada). */
export function AndroidAppBanner() {
  const r = useAndroidRelease();
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(DISMISS) === '1';
    } catch {
      return false;
    }
  });
  const [help, setHelp] = useState(false);
  if (!isAndroidPhone() || !r || hidden) return null;
  const close = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS, '1');
    } catch {}
  };
  return (
    <>
      <div className="android-banner" role="region" aria-label="App do Resenha para Android">
        <Smartphone size={20} />
        <span>
          <strong>Baixe o app para Android:</strong> a call continua com a tela bloqueada ou em outro app.
        </span>
        <a className="btn small primary" href="/api/download/android" onClick={() => setHelp(true)}>
          Baixar
        </a>
        <button className="icon-btn" aria-label="Fechar aviso do app" onClick={close}>
          <X size={16} />
        </button>
      </div>
      {help && <AndroidSteps onClose={() => setHelp(false)} />}
    </>
  );
}
