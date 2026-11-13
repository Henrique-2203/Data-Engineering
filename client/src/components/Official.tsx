import { useEffect, useState } from 'react';
import { ScrollText, Megaphone } from 'lucide-react';
import type { Guild } from '../../../shared/types';
import { api } from '../lib/api';
import { closeModal, openModal, selectGuild, toast, upsertGuild, useApp } from '../store/app';
import { Modal } from './Modals';

/**
 * Servidor oficial e comunidade: aviso de "você entrou no servidor oficial", regras com "Aceito"
 * (quem não aceitou só lê) e a seção do Painel da equipe que cria o servidor oficial.
 */

/** Faixa no lugar da caixa de mensagem enquanto a pessoa não aceitou as regras. */
export function RulesGate({ guild }: { guild: Guild }) {
  return (
    <div className="composer-gate rules-gate" role="status">
      <ScrollText size={18} />
      <span>Para participar do <strong>{guild.name}</strong>, leia as regras e clique em <strong>Aceito</strong>.</span>
      <button className="btn primary small" onClick={() => openModal({ kind: 'rules', guildId: guild.id })}>
        Ler as regras
      </button>
    </div>
  );
}

/** Faixa no lugar da caixa de mensagem num canal de avisos (para quem não publica nele). */
export function AnnounceGate() {
  return (
    <div className="composer-gate" role="status">
      <Megaphone size={18} />
      <span>Canal de avisos: só a equipe do servidor publica aqui. 🔔</span>
    </div>
  );
}

export function RulesModal({ guildId }: { guildId: string }) {
  const guild = useApp((s) => s.guilds[guildId]);
  const [busy, setBusy] = useState(false);
  if (!guild) return null;
  async function accept() {
    setBusy(true);
    try {
      const r = await api<{ guild: Guild }>(`/guilds/${guildId}/rules/accept`, { body: {} });
      upsertGuild(r.guild);
      closeModal();
      toast(`Pronto! Agora você participa do ${guild!.name}. 💚`);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Regras do ${guild.name}`}>
      <div className="rules-text">{guild.rules || 'Este servidor ainda não escreveu as regras.'}</div>
      {guild.rulesPending ? (
        <div className="modal-actions spread">
          <button className="btn ghost" onClick={closeModal}>
            Agora não
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void accept()}>
            Aceito
          </button>
        </div>
      ) : (
        <div className="modal-actions">
          <button className="btn primary" onClick={closeModal}>
            Fechar
          </button>
        </div>
      )}
    </Modal>
  );
}

/** "Você entrou no servidor oficial" (uma vez, quando a pessoa é colocada lá). */
export function OfficialWelcomeModal({ guildId, name }: { guildId: string; name: string }) {
  return (
    <Modal title={`Bem-vindo(a) ao ${name}! 🎉`}>
      <p>
        Você entrou no <strong>{name}</strong>, a comunidade oficial do Resenha. Lá você encontra gente nova para jogar, as <strong>novidades</strong> do app e
        calls abertas.
      </p>
      <p className="muted small">Antes de conversar, leia as regras e clique em Aceito. Se não quiser ficar, é só sair do servidor: você não será colocado de volta.</p>
      <div className="modal-actions spread">
        <button className="btn ghost" onClick={closeModal}>
          Agora não
        </button>
        <button
          className="btn primary"
          onClick={() => {
            closeModal();
            selectGuild(guildId);
          }}
        >
          Ir para o servidor
        </button>
      </div>
    </Modal>
  );
}

/** Configurações do servidor → Regras. */
export function RulesSettings({ guild }: { guild: Guild }) {
  const [rules, setRules] = useState(guild.rules ?? '');
  const [required, setRequired] = useState(!!guild.rulesRequired);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api(`/guilds/${guild.id}`, { method: 'PATCH', body: { rules, rulesRequired: required } });
      toast('Regras salvas.' + (rules !== (guild.rules ?? '') && required ? ' Todo mundo vai aceitar de novo.' : ''));
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form settings-section">
      <h2>Regras</h2>
      <label>
        Regras do servidor
        <textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={12} maxLength={4000} placeholder="1. Respeito acima de tudo..." />
      </label>
      <label className="check">
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Pedir para aceitar as regras antes de escrever, reagir ou entrar nas calls
      </label>
      <p className="muted small">Quem gerencia o servidor não precisa aceitar. Se você mudar o texto das regras, todo mundo aceita de novo.</p>
      <div>
        <button className="btn primary" disabled={busy} onClick={() => void save()}>
          Salvar
        </button>
      </div>
    </div>
  );
}

/** Painel da equipe → Servidor oficial. */
export function OfficialAdmin() {
  const [data, setData] = useState<{ guild: { id: string; name: string; members: number } | null; pending?: number } | null>(null);
  const [name, setName] = useState('Resenha Brasil OFC');
  const [mods, setMods] = useState('kevin, resenha_brasil');
  const [busy, setBusy] = useState(false);
  const load = () => void api<NonNullable<typeof data>>('/admin/official').then(setData, (e) => toast(e.message));
  useEffect(load, []);
  if (!data) return <p className="muted">Carregando…</p>;

  async function create() {
    if (!confirm(`Criar o servidor oficial "${name}"? Todo mundo que tem conta vai entrar nele (uma vez) na próxima vez que abrir o Resenha.`)) return;
    setBusy(true);
    try {
      const r = await api<{ guildId: string; missing: string[] }>('/admin/official', {
        body: { name, moderators: mods.split(/[\s,]+/).filter(Boolean) },
      });
      const g = await api<{ guild: Guild }>(`/guilds/${r.guildId}`);
      upsertGuild(g.guild);
      toast(r.missing.length ? `Servidor criado. Não encontrei: @${r.missing.join(', @')}` : 'Servidor oficial criado! 🎉');
      load();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (data.guild) {
    return (
      <div className="official-admin">
        <p>
          ✅ O servidor oficial <strong>{data.guild.name}</strong> está no ar com <strong>{data.guild.members}</strong> membro{data.guild.members === 1 ? '' : 's'}.
        </p>
        <p className="muted small">
          {data.pending ? `${data.pending} conta(s) ainda vão entrar sozinhas na próxima vez que abrirem o Resenha. ` : ''}Quem sair não é colocado de volta, e quem foi banido não
          entra. Canais, cargos e regras se mudam nas configurações do próprio servidor.
        </p>
        <button
          className="btn"
          onClick={() => {
            closeModal();
            selectGuild(data.guild!.id);
          }}
        >
          Abrir o servidor
        </button>
      </div>
    );
  }
  return (
    <div className="official-admin form">
      <p>
        Cria a comunidade oficial: quem já tem conta entra uma vez (na próxima vez que abrir o Resenha) e quem criar conta entra sozinho, com um aviso. Você vira o dono.
      </p>
      <ul className="muted small">
        <li>📌 Informações: #regras e #novidades (canais de avisos: só a equipe publica)</li>
        <li>💬 Comunidade: #geral, #procurando-grupo e #sugestões (com modo lento)</li>
        <li>🔊 Calls: Call 1, Call 2 e Call 3</li>
        <li>Regras prontas (dá para editar depois), com "Aceito" antes de participar</li>
        <li>Cargo "Moderação Suprema" (administrador) para os moderadores abaixo</li>
      </ul>
      <label>
        Nome do servidor
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
      </label>
      <label>
        Moderadores (nomes de usuário, separados por vírgula)
        <input value={mods} onChange={(e) => setMods(e.target.value)} placeholder="kevin, resenha_brasil" />
      </label>
      <div>
        <button className="btn primary" disabled={busy || !name.trim()} onClick={() => void create()}>
          Criar o servidor oficial
        </button>
      </div>
    </div>
  );
}
