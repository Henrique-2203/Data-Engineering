import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { onSocketReady } from '../lib/socket';
import { useVoice } from '../store/voice';

/**
 * Avisa quando há versão nova do site publicada (o app de desktop e abas abertas há muito tempo
 * continuariam com a página antiga). Confere ao reconectar (o servidor reinicia ao publicar) e a
 * cada 10 minutos.
 */
async function fetchVersion(): Promise<string | null> {
  try {
    const res = await fetch('/api/version', { cache: 'no-store' });
    return res.ok ? ((await res.json()) as { version: string }).version : null;
  } catch {
    return null;
  }
}

export function UpdateNotice() {
  const [loaded, setLoaded] = useState<string | null>(null);
  const [latest, setLatest] = useState<string | null>(null);
  const inCall = useVoice((s) => s.status !== 'idle');

  useEffect(() => {
    let mine: string | null = null;
    const check = async () => {
      const v = await fetchVersion();
      if (!v) return;
      if (!mine) {
        mine = v;
        setLoaded(v);
      }
      setLatest(v);
    };
    void check();
    const off = onSocketReady(() => void check());
    const t = setInterval(() => void check(), 10 * 60_000);
    return () => {
      off();
      clearInterval(t);
    };
  }, []);

  if (!loaded || !latest || loaded === latest) return null;
  return (
    <div className="update-banner site-update" role="status">
      <RefreshCw size={16} />
      <span>{inCall ? 'Nova versão do Resenha: atualize quando sair da call (nada muda até lá).' : 'Nova versão do Resenha disponível.'}</span>
      {!inCall && (
        <button className="btn small primary" onClick={() => location.reload()}>
          Atualizar
        </button>
      )}
    </div>
  );
}
