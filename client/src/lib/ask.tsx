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

/** Suspender a conta no Resenha inteiro: motivo (a pessoa vê) e por quanto tempo. */
export interface Suspension {
  reason: string;
  /** null = até a equipe reativar */
  days: number | null;
}
const DURATIONS: [string, number | null][] = [
  ['1 dia', 1],
  ['3 dias', 3],
  ['7 dias', 7],
  ['30 dias', 30],
  ['Até a equipe reativar', null],
];

function SuspendDialog({ username, initial, done }: { username: string; initial: string; done(v: Suspension | null): void }) {
  const [reason, setReason] = useState(initial);
  const [days, setDays] = useState<string>('7');
  return (
    <div className="modal-backdrop ask-backdrop" onMouseDown={(e) => e.target === e.currentTarget && done(null)}>
      <div className="modal ask-modal" role="dialog" aria-modal="true" aria-label="Suspender conta">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim().length >= 3) done({ reason: reason.trim(), days: days === 'null' ? null : Number(days) });
          }}
          onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), done(null))}
        >
          <h2>Suspender @{username} no Resenha</h2>
          <p className="muted ask-message">
            A pessoa é desconectada na hora e não entra em nenhum servidor nem aparelho até acabar o prazo. As mensagens dela continuam onde estão.
          </p>
          <label>
            Motivo (a pessoa vê ao tentar entrar)
            <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} aria-label="Motivo da suspensão" />
          </label>
          <label>
            Por quanto tempo
            <select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Duração da suspensão">
              {DURATIONS.map(([label, d]) => (
                <option key={label} value={String(d)}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => done(null)}>
              Cancelar
            </button>
            <button type="submit" className="btn danger" disabled={reason.trim().length < 3}>
              Suspender
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function askSuspension(username: string, initial = ''): Promise<Suspension | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: Suspension | null) => {
      root.unmount();
      host.remove();
      resolve(v);
    };
    root.render(<SuspendDialog username={username} initial={initial} done={done} />);
  });
}

/**
 * Confirmação do próprio app, no lugar do confirm() do navegador. O confirm() some em muitos ambientes (app Android,
 * Electron, janelas embutidas, ferramentas de automação): devolve false SEM mostrar nada e a ação "não acontece" em
 * silêncio. Este modal sempre aparece, tem foco no botão seguro (Cancelar nas ações perigosas), Esc cancela e Enter confirma.
 * Devolve true só se a pessoa clicar em confirmar.
 */
export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

const DANGER_VERB = /^(apagar|excluir|remover|expulsar|bloquear|sair|tirar|desfazer|gerar|fechar|cancelar|desligar|revogar|banir|liberar)\b/i;

function ConfirmDialog({ o, done }: { o: ConfirmOptions; done(v: boolean): void }) {
  return (
    <div className="modal-backdrop ask-backdrop" onMouseDown={(e) => e.target === e.currentTarget && done(false)}>
      <div
        className="modal ask-modal"
        role="alertdialog"
        aria-modal="true"
        aria-label={o.title ?? 'Confirmar'}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.stopPropagation(), done(false));
        }}
      >
        <h2>{o.title ?? 'Tem certeza?'}</h2>
        <p className="muted ask-message" style={{ whiteSpace: 'pre-line' }}>
          {o.message}
        </p>
        <div className="modal-actions">
          <button type="button" className="btn ghost" autoFocus={!!o.danger} onClick={() => done(false)}>
            {o.cancelLabel ?? 'Cancelar'}
          </button>
          <button type="button" className={`btn ${o.danger ? 'danger' : 'primary'}`} autoFocus={!o.danger} onClick={() => done(true)}>
            {o.confirmLabel ?? 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function askConfirm(input: string | ConfirmOptions): Promise<boolean> {
  const o: ConfirmOptions = typeof input === 'string' ? { message: input } : input;
  // texto começando por um verbo de ação (Apagar..., Remover...): o botão leva o verbo e fica vermelho
  const verb = DANGER_VERB.exec(o.message)?.[1];
  const opts: ConfirmOptions = { ...o, danger: o.danger ?? !!verb, confirmLabel: o.confirmLabel ?? (verb ? verb[0].toUpperCase() + verb.slice(1).toLowerCase() : 'Confirmar') };
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: boolean) => {
      root.unmount();
      host.remove();
      resolve(v);
    };
    root.render(<ConfirmDialog o={opts} done={done} />);
  });
}
