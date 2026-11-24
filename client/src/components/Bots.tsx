import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import type { BotCommandInfo, BotEmbed, PublicUser } from '../../../shared/types';
import { api } from '../lib/api';
import { toast } from '../store/app';
import { clearCommands } from '../lib/botCommands';
import type { Guild } from '../../../shared/types';
import { Avatar } from './Avatar';

/** Selo BOT ao lado do nome (chat, lista de membros, perfil). */
export function BotTag() {
  return (
    <span className="bot-tag" title="Esta conta é um bot">
      BOT
    </span>
  );
}

const hexColor = (c?: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : '#3ddc97');

/** Cartão de resposta de um bot: título, texto e campos (só texto, nunca HTML nem imagem de fora). */
export function EmbedView({ embed }: { embed: BotEmbed }) {
  return (
    <div className="bot-embed" style={{ borderLeftColor: hexColor(embed.color) }}>
      {embed.title && <div className="bot-embed-title">{embed.title}</div>}
      {embed.description && <div className="bot-embed-text">{renderBold(embed.description)}</div>}
      {embed.fields && embed.fields.length > 0 && (
        <div className="bot-embed-fields">
          {embed.fields.map((f, i) => (
            <div key={i} className="bot-embed-field">
              <strong>{f.name}</strong>
              <span>{f.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** **negrito** simples, sem interpretar mais nada */
function renderBold(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (/^\*\*[^*]+\*\*$/.test(part) ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
}

interface BotState {
  bot: PublicUser | undefined;
  installed: boolean;
  commands: BotCommandInfo[];
  config?: { ticketRoleIds: string[]; aiEnabled?: boolean; aiAvailable?: boolean };
}

/** Configurações do servidor → Integrações: adicionar o Resenha Bot e escolher os comandos (em teste). */
export function BotsSettings({ guild }: { guild: Guild }) {
  const [st, setSt] = useState<BotState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<BotState>(`/guilds/${guild.id}/bots`).then(setSt, (e) => toast(e.message));
  }, [guild.id]);

  async function toggle(install: boolean) {
    if (!install && !confirm('Remover o Resenha Bot deste servidor? Os comandos "/" param de funcionar (as mensagens antigas dele ficam).')) return;
    setBusy(true);
    try {
      if (install) {
        const r = await api<{ commands: BotCommandInfo[] }>(`/guilds/${guild.id}/bots`, { body: {} });
        clearCommands(guild.id);
        setSt((s) => (s ? { ...s, installed: true, commands: r.commands } : s));
        toast('Resenha Bot adicionado. Digite / no chat para ver os comandos.');
      } else {
        await api(`/guilds/${guild.id}/bots`, { method: 'DELETE' });
        clearCommands(guild.id);
        setSt((s) => (s ? { ...s, installed: false } : s));
        toast('Resenha Bot removido.');
      }
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function setCommand(name: string, enabled: boolean) {
    setSt((s) => (s ? { ...s, commands: s.commands.map((c) => (c.name === name ? { ...c, enabled } : c)) } : s));
    try {
      const r = await api<{ commands: BotCommandInfo[] }>(`/guilds/${guild.id}/bots/commands`, { method: 'PATCH', body: { name, enabled } });
      clearCommands(guild.id);
      setSt((s) => (s ? { ...s, commands: r.commands } : s));
    } catch (err) {
      toast((err as Error).message);
      setSt((s) => (s ? { ...s, commands: s.commands.map((c) => (c.name === name ? { ...c, enabled: !enabled } : c)) } : s));
    }
  }

  async function setAi(on: boolean) {
    if (on && !confirm('Ligar a IA neste servidor? Quando alguém usar /ia, /traduzir ou /resumo, o texto do comando (e, no /resumo, as últimas mensagens do canal) é enviado a um serviço de IA externo para gerar a resposta. Mensagens privadas nunca são enviadas.')) return;
    try {
      const r = await api<{ config: NonNullable<BotState['config']>; commands: BotCommandInfo[] }>(`/guilds/${guild.id}/bots/config`, { method: 'PATCH', body: { aiEnabled: on } });
      clearCommands(guild.id);
      setSt((s) => (s ? { ...s, config: r.config, commands: r.commands } : s));
    } catch (err) {
      toast((err as Error).message);
    }
  }
  async function setTicketRoles(ids: string[]) {
    try {
      const r = await api<{ config: { ticketRoleIds: string[] } }>(`/guilds/${guild.id}/bots/config`, { method: 'PATCH', body: { ticketRoleIds: ids } });
      setSt((s) => (s ? { ...s, config: r.config } : s));
    } catch (err) {
      toast((err as Error).message);
    }
  }

  if (!st) return <p className="muted">Carregando…</p>;
  return (
    <div className="bots-settings">
      <h2>Integrações</h2>
      <p className="muted">
        <strong>Em teste.</strong> Bots rodam dentro do Resenha: você adiciona e eles respondem a comandos que começam com <strong>/</strong>. Não precisa hospedar nada.
      </p>
      <div className="bot-card">
        {st.bot ? <Avatar user={st.bot} size={48} /> : <Bot size={40} />}
        <div className="bot-card-text">
          <div>
            <strong>Resenha Bot</strong> <BotTag />
          </div>
          <span className="muted small">Dados, moeda, sorteio, enquete, lembretes e ajuda. Oficial do Resenha.</span>
        </div>
        <button type="button" className={`btn small${st.installed ? '' : ' primary'}`} disabled={busy} onClick={() => void toggle(!st.installed)}>
          {st.installed ? 'Remover' : 'Adicionar ao servidor'}
        </button>
      </div>
      {st.installed && (
        <>
          {[...new Set(st.commands.map((c) => c.group))].map((group) => (
            <div key={group}>
              <h3>{group}</h3>
              {group.startsWith('IA') && (
                <div className="ai-notice">
                  <p className="muted small">
                    Estes comandos mandam texto para um <strong>serviço de IA externo</strong> (Anthropic, EUA) para gerar a resposta: o que a pessoa escreve no comando e, no /resumo, as últimas mensagens do canal.
                    Mensagens privadas nunca são enviadas, e nada é enviado se ninguém usar os comandos. Há limite de uso por pessoa e por dia.
                  </p>
                  {st.config?.aiAvailable === false && <p className="muted small">A IA ainda não está ligada no Resenha (falta a chave do serviço no servidor). Ao ligar aqui, os comandos avisam isso.</p>}
                  <label className="check">
                    <input type="checkbox" checked={!!st.config?.aiEnabled} onChange={(e) => void setAi(e.target.checked)} aria-label="Permitir comandos de IA neste servidor" />
                    <span>
                      <strong>Permitir comandos de IA neste servidor</strong>
                    </span>
                  </label>
                </div>
              )}
              {group === 'Tickets de ajuda' && (
                <div className="ticket-roles">
                  <p className="muted small">
                    O canal de cada ticket é privado: só quem abriu, o dono e os administradores veem. Marque cargos que também atendem os tickets:
                  </p>
                  {guild.roles.length === 0 && <p className="muted small">Este servidor ainda não tem cargos.</p>}
                  {guild.roles.map((role) => (
                    <label key={role.id} className="check">
                      <input
                        type="checkbox"
                        checked={st.config?.ticketRoleIds.includes(role.id) ?? false}
                        onChange={(e) => void setTicketRoles(e.target.checked ? [...(st.config?.ticketRoleIds ?? []), role.id] : (st.config?.ticketRoleIds ?? []).filter((x) => x !== role.id))}
                        aria-label={`Cargo ${role.name} atende tickets`}
                      />
                      <span>{role.name}</span>
                    </label>
                  ))}
                </div>
              )}
              <ul className="bot-commands">
                {st.commands
                  .filter((c) => c.group === group)
                  .map((c) => (
                    <li key={c.name}>
                      <label className="check">
                        <input type="checkbox" checked={c.enabled && !c.locked} disabled={c.locked} onChange={(e) => void setCommand(c.name, e.target.checked)} aria-label={`Comando /${c.name}`} />
                        <span>
                          <strong>/{c.name}</strong> <span className="muted">{c.description}</span>
                          <br />
                          <code className="muted small">{c.usage}</code>
                        </span>
                      </label>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
