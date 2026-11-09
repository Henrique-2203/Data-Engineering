import { useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { closeModal, useApp } from '../store/app';
import { useVoice } from '../store/voice';

/**
 * Novidades do Resenha, em linguagem simples, para quem usa. Regra: só o que muda no uso.
 * Melhorias de segurança aparecem só como "ficou mais seguro", sem detalhes técnicos (não ensinamos
 * a ninguém onde estavam os pontos fracos). A mais nova fica em cima; o id é a data (AAAA-MM-DD, com uma letra no fim se sair mais de uma no mesmo dia).
 */
export const CHANGELOG: { id: string; title: string; items: [string, string][] }[] = [
  {
    id: '2026-11-09b',
    title: 'Novidades para quem joga',
    items: [
      ['🎮', 'Transmissão mais leve: o novo "Modo desempenho" usa a placa de vídeo e, se o PC começar a sofrer, deixa a transmissão mais leve sozinho para não tirar FPS do jogo.'],
      ['🎙️', 'Supressão de ruído com IA: tira teclado, cliques e ventilador sem cortar sua voz. Já vem ligada (Configurações → Voz e vídeo).'],
      ['🔁', 'Atualizações não derrubam mais a call: a voz continua enquanto o Resenha se atualiza.'],
      ['🛟', 'Suporte: fale com a equipe pelo botão de boia, no pé da coluna de servidores (à esquerda).'],
      ['🌐', 'O site do Resenha abre mesmo com você logado. O app fica no endereço /app.'],
      ['🔒', 'Melhorias de segurança: sua conta e suas conversas ficaram ainda mais protegidas.'],
    ],
  },
  {
    id: '2026-11-09a',
    title: 'Novidades na call e nos servidores',
    items: [
      ['💬', 'Chat da call, volume separado para cada transmissão e botão para ligar ou desligar o som da sua transmissão.'],
      ['🔎', 'Busca de mensagens, mensagens fixadas, enquetes e eventos agendados.'],
      ['🛡️', 'Moderação automática e modo lento para quem cuida de servidores.'],
      ['📱', 'Notificações no celular de mensagens diretas, menções e eventos.'],
      ['🔒', 'Melhorias de segurança.'],
    ],
  },
];

export const LATEST_CHANGELOG = CHANGELOG[0].id;

/** Novidades que esta conta ainda não confirmou. Conta nova não vê histórico antigo. */
export function pendingChangelog(seen: string | null, accountCreatedAt: string | null) {
  if (!seen) {
    // conta criada depois da última novidade: nada para mostrar
    if (accountCreatedAt && accountCreatedAt.slice(0, 10) >= LATEST_CHANGELOG.slice(0, 10)) return [];
    return CHANGELOG.slice(0, 1);
  }
  return CHANGELOG.filter((c) => c.id > seen);
}

/** Pop-up de novidades: só fecha com "Entendi" (vale para todos os aparelhos da conta). */
export function ChangelogModal() {
  const entries = useApp((s) => s.pendingChangelog);
  if (!entries.length) return null;
  async function confirm() {
    useApp.setState({ pendingChangelog: [] });
    closeModal();
    await api('/me/changelog-seen', { body: { id: entries[0].id } }).catch(() => {});
  }
  return (
    <div className="modal-backdrop">
      <div className="modal changelog" role="dialog" aria-modal="true" aria-label="Novidades do Resenha">
        <div className="modal-head">
          <h2>
            <Sparkles size={20} /> O Resenha foi atualizado
          </h2>
        </div>
        <div className="modal-body">
          {entries.map((e) => (
            <section key={e.id}>
              <h3>{e.title}</h3>
              <ul className="changelog-list">
                {e.items.map(([icon, text]) => (
                  <li key={text}>
                    <span aria-hidden>{icon}</span> {text}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div className="modal-actions">
            <button className="btn primary" autoFocus onClick={() => void confirm()}>
              Entendi
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Mostra as novidades quando der: nunca no meio de uma call (espera ela acabar) nem por cima de outra janela. */
export function maybeShowChangelog() {
  const app = useApp.getState();
  if (!app.pendingChangelog.length || app.modal) return;
  if (useVoice.getState().status !== 'idle') return;
  useApp.setState({ modal: { kind: 'changelog' } });
}

/** Fica de olho: quando a call acabar ou a janela aberta fechar, mostra as novidades pendentes. */
export function ChangelogWatcher() {
  useEffect(() => {
    maybeShowChangelog();
    const offVoice = useVoice.subscribe((s, prev) => s.status === 'idle' && prev.status !== 'idle' && maybeShowChangelog());
    const offApp = useApp.subscribe((s, prev) => !s.modal && prev.modal && setTimeout(maybeShowChangelog, 400));
    return () => {
      offVoice();
      offApp();
    };
  }, []);
  return null;
}
