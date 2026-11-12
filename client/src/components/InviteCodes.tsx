import { useEffect, useState, type FormEvent } from 'react';
import { Copy, Gift, Plus, Share2 } from 'lucide-react';
import { api } from '../lib/api';
import { askText } from '../lib/ask';
import { toast } from '../store/app';

/**
 * Códigos de convite para criar conta: cada pessoa ganha o seu, com limite de contas.
 * - Painel da equipe: criar, aumentar o limite, desativar e ver quem entrou por cada código.
 * - "Minha conta": a pessoa vê os códigos dela e quantos amigos já entraram.
 */

interface CodeUser {
  username: string;
  displayName: string;
  createdAt: string;
}
interface AdminCode {
  code: string;
  label: string;
  maxUses: number | null;
  uses: number;
  active: boolean;
  isGeneral: boolean;
  createdAt: string;
  owner: string | null;
  ownerName: string | null;
  users: CodeUser[];
}

export const inviteLink = (code: string) => `${location.origin}/app?convite=${encodeURIComponent(code)}`;

async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast('Não deu para copiar. Selecione e copie manualmente.');
  }
}

function Usage({ uses, max }: { uses: number; max: number | null }) {
  const pct = max ? Math.min(100, Math.round((uses / max) * 100)) : 0;
  return (
    <span className="invite-usage">
      <span>
        <strong>{uses}</strong> {max ? `de ${max}` : ''} {(max ?? uses) === 1 ? 'conta' : 'contas'}
        {max === null && ' · sem limite'}
      </span>
      {max !== null && (
        <span className={`invite-bar${uses >= max ? ' full' : ''}`} aria-hidden>
          <i style={{ width: `${pct}%` }} />
        </span>
      )}
    </span>
  );
}

/** Painel da equipe → Convites */
export function InviteCodesAdmin() {
  const [data, setData] = useState<{ codes: AdminCode[]; totals: { withCode: number; total: number }; needsCode: boolean } | null>(null);
  const [owner, setOwner] = useState('');
  const [label, setLabel] = useState('');
  const [maxUses, setMaxUses] = useState(5);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const load = () => void api<NonNullable<typeof data>>('/admin/signup-codes').then(setData, (e) => toast(e.message));
  useEffect(load, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { code } = await api<{ code: string }>('/admin/signup-codes', {
        body: { owner: owner.trim() || undefined, label: label.trim(), maxUses, code: custom.trim() || undefined },
      });
      setOwner('');
      setLabel('');
      setCustom('');
      await copyText(inviteLink(code), `Código ${code} criado e link copiado!`);
      load();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function patch(c: AdminCode, body: Record<string, unknown>) {
    try {
      await api(`/admin/signup-codes/${encodeURIComponent(c.code)}`, { method: 'PATCH', body });
      load();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  // ranking por pessoa (soma todos os códigos dela); código sem dono conta pela anotação
  const ranking = [
    ...(data?.codes ?? [])
      .filter((c) => !c.isGeneral && c.uses > 0)
      .reduce((m, c) => {
        const who = c.owner ? `@${c.owner}` : c.label || c.code;
        return m.set(who, (m.get(who) ?? 0) + c.uses);
      }, new Map<string, number>()),
  ]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  return (
    <div className="invite-admin">
      {data && !data.needsCode && (
        <p className="notice small">
          O cadastro está <strong>aberto para todos</strong> (não existe a variável REGISTRATION_CODE no Render), então os códigos não são pedidos. Para
          exigir convite, crie essa variável no Render.
        </p>
      )}
      <p className="muted small">
        {data ? `${data.totals.withCode} de ${data.totals.total} contas entraram com um código de convite.` : 'Carregando…'}
      </p>

      <form className="invite-create" onSubmit={create}>
        <strong>Novo código</strong>
        <div className="invite-create-grid">
          <label>
            Para quem <span className="muted">(usuário, opcional)</span>
            <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="@lari" maxLength={40} />
          </label>
          <label>
            Anotação <span className="muted">(opcional)</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex.: veio pelo Instagram" maxLength={80} />
          </label>
          <label>
            Limite de contas
            <input type="number" min={1} max={1000} value={maxUses} onChange={(e) => setMaxUses(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} />
          </label>
          <label>
            Código <span className="muted">(opcional)</span>
            <input value={custom} onChange={(e) => setCustom(e.target.value.toUpperCase())} placeholder="Gerado sozinho" maxLength={24} spellCheck={false} />
          </label>
        </div>
        <button className="btn primary" disabled={busy}>
          <Plus size={16} /> Criar código
        </button>
      </form>

      {ranking.length > 0 && (
        <div className="invite-ranking">
          <strong>Quem mais trouxe amigos</strong>
          <ol>
            {ranking.map(([who, n]) => (
              <li key={who}>
                {who} <span className="muted">· {n} {n === 1 ? 'conta' : 'contas'}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <ul className="report-list">
        {data?.codes.map((c) => (
          <li key={c.code} className={`report-item invite-item${c.active ? '' : ' off'}`}>
            <div className="report-head">
              <span className="report-reason invite-code">{c.code}</span>
              <span className="muted small">
                {c.isGeneral ? 'Código geral' : c.owner ? `de @${c.owner}` : 'sem dono'}
                {c.label && !c.isGeneral && ` · ${c.label}`}
                {!c.active && ' · desativado'}
              </span>
            </div>
            <Usage uses={c.uses} max={c.maxUses} />
            {c.isGeneral && <p className="muted small">{c.label}. Não tem limite: desative para que só os códigos pessoais funcionem.</p>}
            <div className="report-actions">
              <button className="btn small" onClick={() => void copyText(inviteLink(c.code), 'Link de convite copiado!')}>
                <Copy size={14} /> Copiar link
              </button>
              {!c.isGeneral && (
                <button
                  className="btn small ghost"
                  onClick={async () => {
                    const v = await askText({ title: `Limite de ${c.code}`, message: `Quantas contas esse código pode criar? Já foram usadas ${c.uses}.`, initial: String((c.maxUses ?? 0) + 5), number: true, confirmLabel: 'Salvar limite' });
                    if (v !== null && v.trim()) void patch(c, { maxUses: Number(v) });
                  }}
                >
                  Mudar limite
                </button>
              )}
              <button className="btn small ghost" onClick={() => void patch(c, { active: !c.active })}>
                {c.active ? 'Desativar' : 'Ativar'}
              </button>
              {c.uses > 0 && (
                <button className="btn small ghost" aria-expanded={open === c.code} onClick={() => setOpen(open === c.code ? null : c.code)}>
                  Quem entrou ({c.uses})
                </button>
              )}
              {c.uses === 0 && !c.isGeneral && (
                <button
                  className="btn small ghost danger"
                  onClick={async () => {
                    if (!confirm(`Apagar o código ${c.code}?`)) return;
                    await api(`/admin/signup-codes/${encodeURIComponent(c.code)}`, { method: 'DELETE' }).catch((err) => toast(err.message));
                    load();
                  }}
                >
                  Apagar
                </button>
              )}
            </div>
            {open === c.code && (
              <ul className="invite-users">
                {c.users.map((u) => (
                  <li key={u.username}>
                    {u.displayName} <span className="muted">@{u.username} · {new Date(u.createdAt).toLocaleDateString('pt-BR')}</span>
                  </li>
                ))}
                {c.users.length < c.uses && <li className="muted small">{c.uses - c.users.length} conta(s) já foram excluídas.</li>}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Minha conta → "Seus convites": só aparece para quem ganhou um código */
export function MyInviteCodes() {
  const [codes, setCodes] = useState<{ code: string; maxUses: number | null; uses: number; active: boolean }[]>([]);
  useEffect(() => {
    void api<{ codes: typeof codes }>('/me/invite-codes').then((r) => setCodes(r.codes), () => {});
  }, []);
  const usable = codes.filter((c) => c.active);
  if (!usable.length) return null;
  return (
    <div className="settings-card my-invites">
      <strong>
        <Gift size={18} /> Seus convites
      </strong>
      <p className="muted small">Mande seu código (ou o link) para os amigos criarem conta no Resenha.</p>
      {usable.map((c) => {
        const left = c.maxUses === null ? null : Math.max(0, c.maxUses - c.uses);
        return (
          <div key={c.code} className="my-invite">
            <span className="invite-code">{c.code}</span>
            <Usage uses={c.uses} max={c.maxUses} />
            <span className="muted small">
              {left === null ? '' : left === 0 ? 'Todos os convites foram usados. 🎉' : `Ainda dá para chamar ${left} ${left === 1 ? 'amigo' : 'amigos'}.`}
            </span>
            {left !== 0 && (
              <div className="row">
                <button className="btn small" onClick={() => void copyText(inviteLink(c.code), 'Link de convite copiado!')}>
                  <Copy size={14} /> Copiar link
                </button>
                {'share' in navigator && (
                  <button
                    className="btn small ghost"
                    onClick={() => navigator.share({ title: 'Resenha', text: `Bora pro Resenha! Meu código de convite: ${c.code}`, url: inviteLink(c.code) }).catch(() => {})}
                  >
                    <Share2 size={14} /> Compartilhar
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
