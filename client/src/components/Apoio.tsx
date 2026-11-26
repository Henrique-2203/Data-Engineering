import { useEffect, useState } from 'react';
import { Copy, Heart, X } from 'lucide-react';
import { useVoice } from '../store/voice';
import { callsJoined } from '../lib/apoioCard';
import { api } from '../lib/api';
import { openModal, toast, useApp } from '../store/app';
import { Modal } from './Modals';
import { Avatar } from './Avatar';
import type { FounderRing } from '../../../shared/types';
import { askConfirm } from '../lib/ask';

/**
 * "Apoie o Resenha": apoio voluntário por Pix até a data limite, em troca do selo "Apoiador Fundador"
 * (e mais nada). Nomes e o valor de cada pessoa só a equipe vê; o total do mês aparece numa barra de meta.
 * O card "depois de gostar" (ApoioCard) só aparece para quem já usa o Resenha, uma vez por mês. Ver server/src/apoio.ts.
 */
type Status = 'none' | 'pending' | 'confirmed' | 'rejected';
interface ApoioState {
  open: boolean;
  card?: boolean;
  monthly?: { cents: number; goalCents: number } | null;
  deadline: string;
  minCents: number;
  me: { code: string; status: Status; showBadge: boolean; ring: FounderRing | 'none' | null } | null;
  pix: { payload: string; qrSvg: string; receiver: string } | null;
}

const RINGS: { id: FounderRing | 'none'; name: string; sub: string }[] = [
  { id: 'raiz', name: 'Raiz', sub: 'Dourado e verde girando devagar' },
  { id: 'aurora', name: 'Aurora', sub: 'Anel duplo que respira em dourado' },
  { id: 'selo', name: 'Selo', sub: 'Dourado parado, com a folhinha' },
  { id: 'none', name: 'Nenhum', sub: 'Só a foto, sem anel' },
];

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: cents % 100 ? 2 : 0 });
const dayMonth = (d: string) => new Date(`${d}T12:00:00-03:00`).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
const copy = (text: string, what: string) =>
  navigator.clipboard.writeText(text).then(
    () => toast(`${what} copiado!`),
    () => toast('Não deu para copiar. Selecione e copie manualmente.'),
  );

const monthName = () => new Date().toLocaleDateString('pt-BR', { month: 'long', timeZone: 'America/Sao_Paulo' });

/** barra da meta do mês: só o total (sem nomes nem valores de cada pessoa) */
export function MonthlyGoal({ cents, goalCents }: { cents: number; goalCents: number }) {
  const pct = Math.min(100, Math.round((cents / Math.max(1, goalCents)) * 100));
  return (
    <div className="apoio-month" role="group" aria-label="Meta do mês">
      <div className="apoio-month-top">
        <span>
          Meta de {monthName()}: <strong>{brl(cents)}</strong> de {brl(goalCents)}
        </span>
        <b>{pct}%</b>
      </div>
      <div className="apoio-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${pct}% da meta do mês`}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <span className="muted small">É o custo dos servidores no mês. Mostramos só o total, nunca quem apoiou nem quanto.</span>
    </div>
  );
}

/**
 * Card "depois de gostar": aparece sozinho só para quem já usa o Resenha de verdade (o servidor decide),
 * no máximo uma vez por mês, e some de vez ao fechar. Nunca no primeiro dia, nunca em cima de uma call.
 */
export function ApoioCard() {
  const [st, setSt] = useState<ApoioState | null>(null);
  const inCall = useVoice((s) => s.status !== 'idle');
  useEffect(() => {
    // espera a pessoa usar um pouco antes de perguntar
    const t = setTimeout(() => void api<ApoioState>(`/apoio?calls=${callsJoined()}`).then((r) => r.card && setSt(r), () => {}), 45_000);
    return () => clearTimeout(t);
  }, []);
  if (!st || inCall) return null;
  const seen = () => {
    setSt(null);
    void api('/apoio/card-seen', { body: {} }).catch(() => {});
  };
  return (
    <aside className="apoio-card" role="dialog" aria-label="Apoie o Resenha">
      <button className="apoio-card-x" aria-label="Fechar" onClick={seen}>
        <X size={16} />
      </button>
      <p className="apoio-card-title">Curtindo o Resenha? 💚</p>
      <p className="apoio-card-text">Ele é grátis e vai continuar grátis. Quem mantém os servidores no ar é a própria galera.</p>
      {st.monthly && <MonthlyGoal {...st.monthly} />}
      <div className="apoio-card-btns">
        <button
          className="btn primary"
          onClick={() => {
            seen();
            openModal({ kind: 'apoio' });
          }}
        >
          Quero apoiar
        </button>
        <button className="btn ghost" onClick={seen}>
          Agora não
        </button>
      </div>
    </aside>
  );
}

/** o selo (leve: só texto e cor, sem imagem nem animação) */
export function FounderBadge({ small }: { small?: boolean }) {
  return (
    <span className={`founder-badge${small ? ' small' : ''}`} title="Apoiou o Resenha na campanha de fundadores">
      💚 Apoiador Fundador
    </span>
  );
}

/** Botão na coluna de servidores: aparece enquanto a campanha está aberta (e para quem já apoiou). */
export function ApoioButton() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const load = () => void api<ApoioState>('/apoio').then((r) => setShow(r.open || r.me?.status === 'confirmed'), () => {});
    load();
    window.addEventListener('resenha:apoio-update', load);
    return () => window.removeEventListener('resenha:apoio-update', load);
  }, []);
  if (!show) return null;
  return (
    <button className="rail-item action rail-apoio" title="Apoie o Resenha" aria-label="Apoie o Resenha" onClick={() => openModal({ kind: 'apoio' })}>
      <span className="rail-icon">
        <Heart size={20} />
      </span>
    </button>
  );
}

export function ApoioModal() {
  const me = useApp((s) => s.me);
  const [st, setSt] = useState<ApoioState | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const load = () => void api<ApoioState>('/apoio').then(setSt, (e) => toast(e.message));
  useEffect(() => {
    load();
    window.addEventListener('resenha:apoio-update', load);
    return () => window.removeEventListener('resenha:apoio-update', load);
  }, []);

  async function claim() {
    setBusy(true);
    try {
      await api('/apoio/claim', { body: {} });
      setAsking(false);
      load();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function setBadge(show: boolean) {
    // muda na hora; se o servidor recusar, volta como estava
    setSt((s) => (s?.me ? { ...s, me: { ...s.me, showBadge: show } } : s));
    await api('/apoio/badge', { body: { show } }).catch((e) => {
      toast(e.message);
      load();
    });
  }

  async function setRing(ring: FounderRing | 'none') {
    setSt((s) => (s?.me ? { ...s, me: { ...s.me, ring } } : s));
    await api('/apoio/ring', { body: { ring } }).catch((e) => {
      toast(e.message);
      load();
    });
  }

  if (!st) {
    return (
      <Modal title="Apoie o Resenha">
        <p className="muted">Carregando…</p>
      </Modal>
    );
  }
  const status = st.me?.status ?? 'none';
  const confirmed = status === 'confirmed';
  return (
    <Modal title="Apoie o Resenha 💚" wide>
      <div className="apoio">
        {confirmed ? (
          <div className="apoio-thanks">
            <p className="apoio-big">Obrigado de verdade! 💚</p>
            <p>Seu apoio ajuda a pagar os servidores e a trazer novidades para todo mundo.</p>
            <div className="apoio-badge-row">
              <FounderBadge />
            </div>
            <label className="check">
              <input type="checkbox" checked={st.me!.showBadge} onChange={(e) => void setBadge(e.target.checked)} /> Mostrar o selo no meu perfil
            </label>
            <div className="apoio-rings">
              <strong>Seu anel de Fundador</strong>
              <p className="muted small">Aparece em volta da sua foto no chat, na lista de membros, no perfil e na call. Troque quando quiser.</p>
              <div className="ring-picker" role="group" aria-label="Anel de Fundador">
                {RINGS.map((r) => (
                  <button key={r.id} type="button" className="ring-opt" aria-pressed={(st.me!.ring ?? 'raiz') === r.id} onClick={() => void setRing(r.id)}>
                    <Avatar user={me ?? undefined} size={56} ring={r.id === 'none' ? null : r.id} />
                    <span>{r.name}</span>
                    <span className="ring-opt-sub">{r.sub}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : !st.open ? (
          <p>A campanha de fundadores terminou em {dayMonth(st.deadline)}. Obrigado a todo mundo que apoiou! 💚</p>
        ) : (
          <>
            <div className="apoio-text">
              <p>
                O Resenha é grátis e vai continuar grátis. <strong>Tudo que é grátis hoje continua grátis para sempre.</strong>
              </p>
              <p>
                Os servidores custam dinheiro todo mês. Se você curte o Resenha e quiser ajudar, pode apoiar com um Pix, <strong>por vontade própria, no valor que quiser</strong>, a partir de {brl(st.minCents)}.
              </p>
              <p>
                <strong>Seu apoio paga os servidores e acelera as novidades, para todo mundo</strong>: coisas como enviar arquivos maiores ficam mais perto de sair.
              </p>
            </div>

            {st.monthly && <MonthlyGoal {...st.monthly} />}

            <div className="apoio-reward">
              <div>
                <strong>Quem apoiar até {dayMonth(st.deadline)} ganha</strong>
                <span className="muted small"> o selo de Apoiador Fundador e os 3 anéis de Fundador para a sua foto, para sempre. Depois dessa data eles nunca mais vão ser oferecidos (nem vendidos).</span>
              </div>
              <div className="ring-preview" aria-label="Os 3 anéis de Fundador">
                {(['raiz', 'aurora', 'selo'] as FounderRing[]).map((r) => (
                  <Avatar key={r} user={me ?? undefined} size={48} ring={r} />
                ))}
              </div>
              <FounderBadge />
              <span className="muted small">O apoio não libera nenhuma função: é só um agradecimento nosso. 🙏</span>
            </div>

            {st.pix && st.me && (
              <div className="apoio-pay">
                <div className="apoio-qr" aria-label="QR Code do Pix" role="img" dangerouslySetInnerHTML={{ __html: st.pix.qrSvg }} />
                <div className="apoio-steps">
                  <ol>
                    <li>
                      No app do seu banco, escolha <strong>Pix → Ler QR Code</strong> e aponte para o código (ou use o copia e cola).
                    </li>
                    <li>Digite o valor que quiser (a partir de {brl(st.minCents)}).</li>
                    <li>
                      Se o banco pedir uma mensagem, escreva o seu código: <code className="apoio-code">{st.me.code}</code>
                      <button type="button" className="btn ghost small" onClick={() => void copy(st.me!.code, 'Código')}>
                        <Copy size={14} /> Copiar
                      </button>
                    </li>
                    <li>Depois de pagar, clique em <strong>Já fiz o Pix</strong> aqui embaixo.</li>
                  </ol>
                  <label className="apoio-copia">
                    Pix copia e cola
                    <div className="apoio-copia-row">
                      <input readOnly value={st.pix.payload} onFocus={(e) => e.target.select()} />
                      <button type="button" className="btn" onClick={() => void copy(st.pix!.payload, 'Pix copia e cola')}>
                        <Copy size={14} /> Copiar
                      </button>
                    </div>
                  </label>
                  <p className="muted small">
                    Quem recebe: <strong>{st.pix.receiver}</strong>. Como em qualquer Pix, seu nome aparece para quem recebe. Só a equipe do Resenha vê quem apoiou e quanto cada um deu; para todo mundo aparece só o total do mês.
                  </p>
                </div>
              </div>
            )}

            <div className="apoio-status">
              {status === 'pending' ? (
                <p className="apoio-pending">✅ Recebemos o seu aviso! Assim que a equipe conferir o Pix, o selo e os anéis aparecem no seu perfil (normalmente em até 1 dia).</p>
              ) : (
                <>
                  {status === 'rejected' && (
                    <p className="apoio-rejected">Não encontramos o seu Pix ainda. Se você já pagou, confira se o código foi na mensagem e clique de novo, ou fale com a gente no Suporte (a boia 🛟).</p>
                  )}
                  {asking ? (
                    <div className="apoio-ask" role="group" aria-label="Confirmar que fez o Pix">
                      <p>
                        <strong>Você já fez o Pix?</strong> Só confirme depois de pagar: a equipe vai procurar o seu Pix no extrato.
                      </p>
                      <div className="apoio-ask-btns">
                        <button className="btn primary" disabled={busy} onClick={() => void claim()}>
                          Sim, já paguei
                        </button>
                        <button className="btn ghost" onClick={() => setAsking(false)}>
                          Ainda não
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button className="btn primary" disabled={busy} onClick={() => setAsking(true)}>
                      Já fiz o Pix
                    </button>
                  )}
                </>
              )}
              <p className="muted small">Fez por engano? Fale com o Suporte em até 7 dias que a gente devolve.</p>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------------- painel da equipe ----------------

interface Settings {
  enabled: boolean;
  pixKey: string;
  name: string;
  city: string;
  deadline: string;
  minCents: number;
  goalSupporters: number;
  goalCents: number;
  monthlyGoalCents: number;
  showMonthly: boolean;
}
interface Supporter {
  userId: string;
  username: string;
  displayName: string;
  code: string;
  status: Status;
  claimedAt: string | null;
  confirmedAt: string | null;
  amountCents: number | null;
}
const STATUS_LABEL: Record<Status, string> = { none: '', pending: '⏳ Para conferir', confirmed: '✅ Confirmado', rejected: '✖ Não encontrado' };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const RANDOM_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const toCents = (v: string) => {
  const n = Number(v.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

export function ApoioAdmin() {
  const [data, setData] = useState<{ settings: Settings; open: boolean; supporters: Supporter[]; totals: { confirmed: number; pending: number; cents: number; monthCents: number } } | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const pending = useApp((s) => s.pendingApoio);
  const load = () =>
    void api<NonNullable<typeof data>>('/admin/apoio').then((r) => {
      setData(r);
      setForm((f) => f ?? r.settings);
    }, (e) => toast(e.message));
  useEffect(load, [pending]);
  if (!data || !form) return <p className="muted">Carregando…</p>;

  async function save() {
    try {
      const r = await api<{ settings: Settings; open: boolean }>('/admin/apoio', { method: 'PUT', body: form });
      setForm(r.settings);
      toast(r.open ? 'Salvo. O "Apoie o Resenha" está aberto.' : 'Salvo.');
      load();
    } catch (err) {
      toast((err as Error).message);
    }
  }
  async function act(s: Supporter, action: 'confirm' | 'reject') {
    try {
      await api(`/admin/apoio/${s.userId}/${action}`, { body: action === 'confirm' ? { amountCents: amounts[s.userId] ? toCents(amounts[s.userId]) : null } : {} });
      toast(action === 'confirm' ? `Selo entregue para @${s.username} 💚` : 'Marcado como não encontrado.');
      load();
    } catch (err) {
      toast((err as Error).message);
    }
  }
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm({ ...form, [k]: v });
  const t = data.totals;
  const goal = data.settings;
  const keyWarn = form.pixKey && !RANDOM_KEY.test(form.pixKey.trim());

  return (
    <div className="apoio-admin">
      <section className="apoio-goal">
        <h3>Metas</h3>
        {[
          ['Apoiadores', t.confirmed, goal.goalSupporters, String(t.confirmed)],
          ['Valor anotado', t.cents, goal.goalCents, brl(t.cents)],
        ].map(([label, v, max, text]) => (
          <div key={String(label)} className="apoio-goal-row">
            <span>
              {label}: <strong>{text}</strong> de {label === 'Apoiadores' ? max : brl(Number(max))}
            </span>
            <div className="apoio-bar">
              <i style={{ width: `${Math.min(100, (Number(v) / Math.max(1, Number(max))) * 100)}%` }} />
            </div>
          </div>
        ))}
        <div className="apoio-goal-row">
          <span>
            Este mês (todos veem, sem nomes): <strong>{brl(t.monthCents)}</strong> de {brl(goal.monthlyGoalCents ?? 10_000)}
            {!goal.showMonthly && ' · barra escondida'}
          </span>
          <div className="apoio-bar">
            <i style={{ width: `${Math.min(100, (t.monthCents / Math.max(1, goal.monthlyGoalCents ?? 10_000)) * 100)}%` }} />
          </div>
        </div>
        <p className="muted small">
          {data.open ? `Aberto até ${dayMonth(goal.deadline)} (23:59).` : goal.enabled ? 'Ligado, mas fechado (data passou ou falta preencher algo).' : 'Desligado: ninguém vê o botão de apoio.'} Deu certo se chegar a {goal.goalSupporters} apoiadores ou {brl(goal.goalCents)}.
        </p>
      </section>

      <section>
        <h3>Para conferir e confirmados</h3>
        {data.supporters.length === 0 ? (
          <p className="muted">Ninguém avisou que fez o Pix ainda.</p>
        ) : (
          <div className="apoio-list">
            {data.supporters.map((s) => (
              <div key={s.userId} className={`apoio-item apoio-st-${s.status}`}>
                <div className="apoio-who">
                  <div className="apoio-who-top">
                    <span className={`apoio-chip apoio-chip-${s.status}`}>{STATUS_LABEL[s.status]}</span>
                    <strong>{s.displayName}</strong>
                    <span className="muted">@{s.username}</span>
                  </div>
                  <div className="apoio-who-meta muted small">
                    <span>
                      Código <code>{s.code}</code>
                    </span>
                    <span>Avisou em {when(s.claimedAt)}</span>
                    {s.status === 'confirmed' && <span>Confirmado em {when(s.confirmedAt)}</span>}
                    {s.status === 'confirmed' && s.amountCents !== null && <span>{brl(s.amountCents)}</span>}
                  </div>
                </div>
                {s.status === 'pending' ? (
                  <div className="apoio-actions">
                    <input
                      aria-label={`Valor recebido de @${s.username}`}
                      placeholder="R$ (opcional)"
                      inputMode="decimal"
                      value={amounts[s.userId] ?? ''}
                      onChange={(e) => setAmounts({ ...amounts, [s.userId]: e.target.value })}
                    />
                    <button className="btn primary small" onClick={() => void act(s, 'confirm')}>
                      Confirmar
                    </button>
                    <button className="btn ghost small" onClick={() => void act(s, 'reject')}>
                      Não encontrei
                    </button>
                  </div>
                ) : s.status === 'confirmed' ? (
                  <div className="apoio-actions">
                    <button className="btn ghost small" onClick={async () => (await askConfirm(`Tirar o selo de @${s.username}?`)) && void act(s, 'reject')}>
                      Desfazer
                    </button>
                  </div>
                ) : (
                  <div className="apoio-actions">
                    <button className="btn ghost small" onClick={() => void act(s, 'confirm')}>
                      Confirmar mesmo assim
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="muted small">Confira cada Pix no extrato do banco (procure o código RSN-… na mensagem ou no identificador). Anote o valor ao confirmar: é ele que entra na barra da meta do mês que todo mundo vê.</p>
      </section>

      <section className="apoio-settings">
        <h3>Configuração</h3>
        <label className="check">
          <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Mostrar o "Apoie o Resenha" para as pessoas
        </label>
        <label>
          Chave Pix (use a chave aleatória)
          <input value={form.pixKey} onChange={(e) => set('pixKey', e.target.value)} placeholder="ex.: 123e4567-e89b-12d3-a456-426614174000" spellCheck={false} />
        </label>
        {keyWarn && <p className="apoio-warn">⚠️ Isso não parece uma chave aleatória. A chave aparece para todo mundo que abrir o apoio: se for CPF, telefone ou e-mail, ele fica exposto. Gere uma chave aleatória no app do banco.</p>}
        <div className="apoio-grid">
          <label>
            Nome de quem recebe (como no banco)
            <input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={60} />
          </label>
          <label>
            Cidade
            <input value={form.city} onChange={(e) => set('city', e.target.value)} maxLength={40} />
          </label>
          <label>
            Último dia para apoiar
            <input type="date" value={form.deadline} onChange={(e) => set('deadline', e.target.value)} />
          </label>
          <label>
            Valor mínimo (R$)
            <input inputMode="decimal" value={String(form.minCents / 100).replace('.', ',')} onChange={(e) => set('minCents', toCents(e.target.value) ?? form.minCents)} />
          </label>
          <label>
            Meta de apoiadores
            <input inputMode="numeric" value={form.goalSupporters} onChange={(e) => set('goalSupporters', Math.max(1, Number(e.target.value) || 1))} />
          </label>
          <label>
            Meta em R$
            <input inputMode="decimal" value={String(form.goalCents / 100).replace('.', ',')} onChange={(e) => set('goalCents', toCents(e.target.value) ?? form.goalCents)} />
          </label>
          <label>
            Meta do mês, que todos veem (R$)
            <input inputMode="decimal" value={String((form.monthlyGoalCents ?? 10_000) / 100).replace('.', ',')} onChange={(e) => set('monthlyGoalCents', toCents(e.target.value) ?? form.monthlyGoalCents)} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={form.showMonthly ?? true} onChange={(e) => set('showMonthly', e.target.checked)} /> Mostrar para todos a barra com o total do mês (sem nomes nem valores de cada pessoa)
        </label>
        <button className="btn primary" onClick={() => void save()}>
          Salvar
        </button>
      </section>
    </div>
  );
}
