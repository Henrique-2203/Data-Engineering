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
          <h3>Comandos</h3>
          <ul className="bot-commands">
            {st.commands.map((c) => (
              <li key={c.name}>
                <label className="check">
                  <input type="checkbox" checked={c.enabled} onChange={(e) => void setCommand(c.name, e.target.checked)} aria-label={`Comando /${c.name}`} />
                  <span>
                    <strong>/{c.name}</strong> <span className="muted">{c.description}</span>
                    <br />
                    <code className="muted small">{c.usage}</code>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
