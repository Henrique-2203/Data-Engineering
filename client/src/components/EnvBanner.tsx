import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * Faixa "SITE DE TESTE" (só aparece no site de teste, APP_ENV=staging): as contas, mensagens e
 * arquivos de lá são separados do Resenha oficial. O título da aba também ganha [TESTE].
 */
export function EnvBanner() {
  const [official, setOfficial] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    api<{ env?: string; officialUrl?: string | null }>('/config').then(
      (c) => {
        if (c.env !== 'staging') return;
        setOfficial(c.officialUrl ?? null);
        document.documentElement.classList.add('env-staging');
        const tag = '[TESTE] ';
        const fix = () => {
          if (!document.title.startsWith(tag)) document.title = tag + document.title;
        };
        fix();
        new MutationObserver(fix).observe(document.querySelector('title') ?? document.head, { childList: true, subtree: true, characterData: true });
      },
      () => {},
    );
  }, []);
  if (official === undefined) return null;
  return (
    <div className="env-banner" role="note">
      🧪 <strong>SITE DE TESTE</strong> · contas, mensagens e arquivos daqui são separados do Resenha oficial.
      {official && (
        <>
          {' '}
          <a href={official}>Ir para o oficial</a>
        </>
      )}
    </div>
  );
}
