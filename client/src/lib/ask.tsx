import { useState } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * Caixinha para digitar um texto, no lugar do prompt() do navegador: o app de Windows (Electron) não
 * tem prompt() — ele dá erro ("prompt() is not supported") e a ação simplesmente não acontecia.
 * Abre por cima de qualquer janela do app (inclusive de outra janela aberta) e devolve o texto, ou
 * null se a pessoa cancelar.
 */
export interface AskOptions {
  title: string;
  message?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  danger?: boolean;
  maxLength?: number;
  /** campo de número (ex.: limite de contas) */
  number?: boolean;
  /** o botão de confirmar só libera quando o texto for exatamente este (ex.: nome do servidor) */
  mustMatch?: string;
}

function AskDialog({ o, done }: { o: AskOptions; done(v: string | null): void }) {
  const [value, setValue] = useState(o.initial ?? '');
  const blocked = o.mustMatch !== undefined && value.trim() !== o.mustMatch;
  const submit = () => !blocked && done(value);
  return (
    <div className="modal-backdrop ask-backdrop" onMouseDown={(e) => e.target === e.currentTarget && done(null)}>
      <div className="modal ask-modal" role="dialog" aria-modal="true" aria-label={o.title}>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), done(null))}
        >
          <h2>{o.title}</h2>
          {o.message && <p className="muted ask-message">{o.message}</p>}
          <input
            autoFocus
            type={o.number ? 'number' : 'text'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={o.placeholder}
            maxLength={o.maxLength}
            aria-label={o.title}
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => done(null)}>
              Cancelar
            </button>
            <button type="submit" className={`btn ${o.danger ? 'danger' : 'primary'}`} disabled={blocked}>
              {o.confirmLabel ?? 'Confirmar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function askText(o: AskOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: string | null) => {
      root.unmount();
      host.remove();
      resolve(v);
    };
    root.render(<AskDialog o={o} done={done} />);
  });
}
