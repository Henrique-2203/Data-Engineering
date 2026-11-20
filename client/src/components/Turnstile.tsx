import { useEffect, useRef } from 'react';

/**
 * Captcha invisível da Cloudflare (Turnstile): sem "clique nos semáforos". Na maioria das vezes ninguém
 * vê nada; só aparece uma caixinha se a Cloudflare desconfiar de robô. Cada resposta vale uma vez.
 */
declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, opts: Record<string, unknown>): string;
      remove(id: string): void;
    };
  }
}

let loader: Promise<void> | null = null;
function loadScript() {
  loader ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loader = null;
      reject(new Error('Não foi possível carregar a verificação anti-robô.'));
    };
    document.head.appendChild(s);
  });
  return loader;
}

export function Turnstile({ siteKey, onToken, onError }: { siteKey: string; onToken(token: string): void; onError?(msg: string): void }) {
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  cb.current = onToken;
  const err = useRef(onError);
  err.current = onError;
  const fail = () => {
    cb.current('');
    err.current?.('Não foi possível carregar a verificação anti-robô. Se usa bloqueador de anúncios, libere o Resenha e recarregue a página.');
  };
  useEffect(() => {
    let id: string | null = null;
    let gone = false;
    void loadScript()
      .then(() => {
        if (gone || !box.current || !window.turnstile) return;
        id = window.turnstile.render(box.current, {
          sitekey: siteKey,
          theme: 'dark',
          language: 'pt-br',
          appearance: 'interaction-only',
          callback: (t: string) => cb.current(t),
          'expired-callback': () => cb.current(''),
          'error-callback': fail,
        });
      })
      .catch(fail);
    return () => {
      gone = true;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [siteKey]);
  return <div ref={box} className="turnstile" />;
}
