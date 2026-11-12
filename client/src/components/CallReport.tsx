import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import type { SupportTicket } from '../../../shared/types';
import { api } from '../lib/api';
import { closeModal, openModal, toast } from '../store/app';
import { type CallDiagnostics, type Finding, collectDiagnostics, explain } from '../voice/diagnostics';
import { Modal, useSubmit } from './Modals';

const PROBLEMS = [
  'Voz cortando ou robótica',
  'Não me ouvem / não ouço alguém',
  'Transmissão travando ou com FPS baixo',
  'Eco, chiado ou barulho',
  'A call caiu ou não conecta',
  'Outro problema na call',
];

/** "Relatar problema da call": mede a call por 5 s, mostra o que achou e manda para o suporte. */
export function CallReportModal() {
  const [diag, setDiag] = useState<CallDiagnostics | null>(null);
  const [progress, setProgress] = useState(0);
  const [problem, setProblem] = useState(PROBLEMS[0]);
  const [text, setText] = useState('');
  useEffect(() => {
    let alive = true;
    const started = Date.now();
    const t = setInterval(() => setProgress(Math.min(100, ((Date.now() - started) / 5000) * 100)), 200);
    collectDiagnostics(5000)
      .then((d) => alive && setDiag(d))
      .catch((e) => toast((e as Error).message))
      .finally(() => clearInterval(t));
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const { busy, error, submit } = useSubmit(async () => {
    const r = await api<{ ticket: SupportTicket }>('/support', {
      body: { category: 'call', subject: problem, message: text.trim() || problem, diagnostics: diag },
    });
    toast('Relatório enviado! A equipe responde em Suporte (a boia, no pé da coluna de servidores).');
    closeModal();
    void r;
  });

  return (
    <Modal title="Relatar problema da call" wide>
      {!diag ? (
        <div className="diag-measuring" role="status">
          <Activity size={18} /> Medindo a call por 5 segundos… continue na call normalmente.
          <div className="diag-bar">
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : (
        <form className="form" onSubmit={submit}>
          <FindingsList findings={explain(diag)} />
          <label>
            O que está acontecendo?
            <select value={problem} onChange={(e) => setProblem(e.target.value)}>
              {PROBLEMS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            Conte com suas palavras (opcional)
            <textarea rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex.: quando o Caio transmite o jogo, a imagem trava a cada poucos segundos" />
          </label>
          <details className="diag-details">
            <summary>Ver exatamente o que vai ser enviado</summary>
            <p className="muted small">
              Só números da conexão, da voz e da transmissão, o tipo de aparelho e os últimos eventos da conexão. Nunca vai áudio, vídeo,
              mensagens nem endereço IP.
            </p>
            <DiagnosticsView diag={diag} />
          </details>
          {error && <p className="error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={closeModal}>
              Cancelar
            </button>
            <button className="btn primary" disabled={busy}>
              Enviar para o suporte
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

const AUDIO_LABEL: Record<string, string> = {
  clean: 'do PC, sem a call ✅',
  system: 'do PC inteiro (com a call)',
  tab: 'de uma aba',
  none: 'sem som',
  off: 'desligado por quem transmite',
  old: 'app antigo (com a call)',
};

export function FindingsList({ findings }: { findings: Finding[] }) {
  return (
    <div className="diag-findings" aria-label="O que encontramos">
      <strong>O que encontramos</strong>
      <ul>
        {findings.map((f) => (
          <li key={f.text} className={`diag-${f.level}`}>
            <span aria-hidden>{f.level === 'ok' ? '✅' : f.level === 'warn' ? '⚠️' : '❌'}</span> {f.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

const yes = (b: boolean) => (b ? 'sim' : 'não');
const NOISE: Record<string, string> = { gtcrn: 'Forte (IA)', rnnoise: 'Leve (IA)', browser: 'Básica', off: 'desligada' };
const STATE: Record<string, string> = { connected: 'conectado', connecting: 'conectando', new: 'começando', disconnected: 'caiu', failed: 'falhou', closed: 'fechado' };

/** Os números em tabelas legíveis (para quem relata e para a equipe) + o texto completo. */
export function DiagnosticsView({ diag }: { diag: CallDiagnostics }) {
  const d = diag;
  return (
    <div className="diag-view">
      <table>
        <tbody>
          <tr>
            <th>Aparelho</th>
            <td>
              {d.app.desktop ? `App de Windows ${d.app.desktop}` : 'Navegador'} · {d.app.browser} · {d.app.os}
              {d.app.cores ? ` · ${d.app.cores} núcleos` : ''}
              {d.app.memoryGb ? ` · ${d.app.memoryGb} GB` : ''}
            </td>
          </tr>
          {d.app.gpu && (
            <tr>
              <th>Placa de vídeo</th>
              <td>{d.app.gpu}</td>
            </tr>
          )}
          <tr>
            <th>Call</th>
            <td>
              {d.call.kind} · {d.call.people} pessoa(s) · microfone {d.call.muted ? 'silenciado' : 'ligado'} · {d.call.inputMode} · ruído: {d.call.noise ? (NOISE[d.call.noise] ?? d.call.noise) : '—'}
            </td>
          </tr>
        </tbody>
      </table>
      {d.peers.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Conexão com</th>
              <th>Estado</th>
              <th>TURN</th>
              <th>Atraso</th>
              <th>Perda (voz)</th>
              <th>Voz remendada</th>
            </tr>
          </thead>
          <tbody>
            {d.peers.map((p, i) => (
              <tr key={i}>
                <td>{p.name}</td>
                <td>{STATE[p.state] ?? p.state}</td>
                <td>{yes(p.relayed)}</td>
                <td>{p.rttMs !== null ? `${p.rttMs} ms` : '—'}</td>
                <td>{p.voiceIn ? `${p.voiceIn.lossPct}%` : '—'}</td>
                <td>{p.voiceIn ? `${p.voiceIn.concealedPct}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d.stream && (
        <table>
          <tbody>
            <tr>
              <th>Minha transmissão</th>
              <td>
                {d.stream.turbo ? '⚡ turbo' : 'normal'} · captura {d.stream.captureFps} FPS · envio {d.stream.sentFps} FPS (alvo {d.stream.targetFps}) · {d.stream.width}×
                {d.stream.height} · {d.stream.codec}
                {d.stream.encodeMs !== null ? ` · ${d.stream.encodeMs} ms/quadro` : ''} · {d.stream.viewers} assistindo
                {d.stream.viewerFps !== null ? ` · na tela deles ${d.stream.viewerFps} FPS` : ''}
                {d.stream.lightLevel ? ` · versão leve nível ${d.stream.lightLevel}` : ''}
              </td>
            </tr>
          </tbody>
        </table>
      )}
      {d.watching.map((w, i) => (
        <table key={i}>
          <tbody>
            <tr>
              <th>Assistindo {w.name}</th>
              <td>
                {w.turbo ? '⚡ turbo' : 'normal'} · {w.fps} FPS · {w.width}×{w.height}
                {w.mbps !== null ? ` · ${w.mbps} Mbps` : ''}
                {w.lossPct !== null ? ` · perda ${w.lossPct}%` : ''}
                {w.freezes ? ` · ${w.freezes} travada(s)` : ''}
                {w.audio ? ` · som: ${AUDIO_LABEL[w.audio]}` : ''}
              </td>
            </tr>
          </tbody>
        </table>
      ))}
      <details>
        <summary className="small">Texto completo (para a equipe)</summary>
        <pre>{JSON.stringify(d, null, 2)}</pre>
      </details>
    </div>
  );
}

/** Botão na barra da call. */
export function CallReportButton() {
  return (
    <button className="call-lock call-report" title="Algo errado na call? Mede a conexão e manda para o suporte" aria-label="Relatar problema da call" onClick={() => openModal({ kind: 'callReport' })}>
      <Activity size={15} /> <span>Relatar problema</span>
    </button>
  );
}
