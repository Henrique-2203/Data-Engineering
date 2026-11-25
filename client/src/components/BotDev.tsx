import { useEffect, useState } from 'react';
import { Copy, KeyRound, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from '../store/app';
import { clearCommands } from '../lib/botCommands';
import type { Guild } from '../../../shared/types';
import { BotTag } from './Bots';

const copy = (text: string, what: string) => {
  void navigator.clipboard?.writeText(text).then(() => toast(`${what} copiado.`), () => toast('Não foi possível copiar. Selecione e copie à mão.'));
};

interface DevBot {
  id: string;
  name: string;
  username: string;
  description: string;
  url: string | null;
  guilds: number;
  disabled: boolean;
  commands: { name: string; description: string; usage: string }[];
}
interface Secrets {
  botId: string;
  token: string;
  signingSecret: string;
}

/** Configurações → Desenvolvedor: criar e gerenciar os próprios bots (token, endereço, comandos). */
export function DevSettings() {
  const [bots, setBots] = useState<DevBot[] | null>(null);
  const [secrets, setSecrets] = useState<Secrets | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api<{ bots: DevBot[] }>('/bot-apps').then((r) => setBots(r.bots), (e) => toast((e as Error).message));
  useEffect(() => void load(), []);

  async function create() {
    setBusy(true);
    try {
      const r = await api<{ bot: { id: string }; token: string; signingSecret: string }>('/bot-apps', { body: { name, description } });
      setSecrets({ botId: r.bot.id, token: r.token, signingSecret: r.signingSecret });
      setName('');
      setDescription('');
      await load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dev-settings">
      <p className="muted">
        <strong>Em teste.</strong> Crie seu próprio bot: você escreve o código onde quiser (o Resenha não hospeda nada). O bot recebe comandos que começam com <strong>/</strong> e responde pelo seu endereço, ou escreve nos canais
        usando o token.
      </p>

      {secrets && (
        <div className="dev-secret" role="alert">
          <strong>Guarde agora: isto não aparece de novo.</strong>
          <p className="muted small">O token é a senha do bot (quem tem pode escrever como ele). O segredo de assinatura serve para conferir que as chamadas vêm mesmo do Resenha. Nunca coloque em código público.</p>
          <label>
            Token
            <div className="dev-copy">
              <code>{secrets.token}</code>
              <button type="button" className="btn small" onClick={() => copy(secrets.token, 'Token')}>
                <Copy size={14} /> Copiar
              </button>
            </div>
          </label>
          <label>
            Segredo de assinatura
            <div className="dev-copy">
              <code>{secrets.signingSecret}</code>
              <button type="button" className="btn small" onClick={() => copy(secrets.signingSecret, 'Segredo')}>
                <Copy size={14} /> Copiar
              </button>
            </div>
          </label>
          <button type="button" className="btn small" onClick={() => setSecrets(null)}>
            Já guardei
          </button>
        </div>
      )}

      <h3>Meus bots</h3>
      {bots === null && <p className="muted">Carregando…</p>}
      {bots?.length === 0 && <p className="muted small">Você ainda não criou nenhum bot.</p>}
      {bots?.map((b) => (
        <DevBotCard key={b.id} bot={b} onChange={load} onSecrets={setSecrets} />
      ))}

      {bots && bots.length < 3 && (
        <form
          className="dev-create"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <h3>Criar um bot</h3>
          <label>
            Nome do bot
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} minLength={2} required placeholder="Ex.: Eco Bot" />
          </label>
          <label>
            Descrição (opcional)
            <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="O que o bot faz" />
          </label>
          <button className="btn primary" disabled={busy || name.trim().length < 2}>
            Criar bot
          </button>
          <p className="muted small">Cada pessoa pode ter até 3 bots.</p>
        </form>
      )}

      <details className="dev-docs">
        <summary>Como programar o bot (guia rápido)</summary>
        <p className="small">
          <strong>1. Registrar os comandos</strong> (uma vez, ou quando mudar a lista). Os nomes de comando de /dado, /moeda, /tocar e outros do Resenha Bot não podem ser usados.
        </p>
        <pre>{`curl -X PUT https://resenhabr.com.br/api/bot/commands \\
  -H "Authorization: Bot SEU_TOKEN" -H "Content-Type: application/json" \\
  -d '{"commands":[{"name":"ping","description":"Responde pong","usage":"/ping texto"}]}'`}</pre>
        <p className="small">
          <strong>2. Receber comandos.</strong> Coloque o endereço (https) do seu bot no cartão acima. Quando alguém usar <code>/ping oi</code>, o Resenha faz um POST nele com:
        </p>
        <pre>{`{ "type":"command", "command":"ping", "args":"oi",
  "user":{"id","username","displayName"}, "channel":{"id","name"}, "guild":{"id","name"} }`}</pre>
        <p className="small">
          Confira a assinatura: o cabeçalho <code>X-Resenha-Signature</code> é <code>v1=</code> + HMAC-SHA256 hexadecimal de <code>{'{X-Resenha-Timestamp}.{corpo}'}</code> usando o segredo de assinatura. Recuse chamadas com
          assinatura errada ou carimbo de tempo com mais de 5 minutos. Responda em até 3 segundos com JSON:
        </p>
        <pre>{`{ "content": "pong oi", "embed": { "title": "Eco", "description": "texto", "fields": [{"name":"a","value":"b"}] } }`}</pre>
        <p className="small">
          Se precisar de mais tempo, responda <code>202</code> e depois escreva no canal pela API:
        </p>
        <pre>{`curl -X POST https://resenhabr.com.br/api/bot/channels/ID_DO_CANAL/messages \\
  -H "Authorization: Bot SEU_TOKEN" -H "Content-Type: application/json" \\
  -d '{"content":"Pronto!"}'`}</pre>
        <p className="small muted">
          Limites: 5 mensagens a cada 5 s por canal, 120 chamadas por minuto, mensagens de até 2000 letras. O bot só escreve onde foi instalado, nunca em conversas privadas, e a moderação do servidor vale para ele. Quem
          administra o servidor instala o bot em Configurações do servidor → Integrações, pelo ID que aparece no cartão do bot. Guia completo: <code>docs/BOTS-API.md</code> no repositório.
        </p>
      </details>
    </div>
  );
}

function DevBotCard({ bot, onChange, onSecrets }: { bot: DevBot; onChange(): void; onSecrets(s: Secrets): void }) {
  const [url, setUrl] = useState(bot.url ?? '');
  const [name, setName] = useState(bot.name);
  const [description, setDescription] = useState(bot.description);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api(`/bot-apps/${bot.id}`, { method: 'PATCH', body: { name, description, interactionsUrl: url.trim() || null } });
      toast('Bot salvo.');
      onChange();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function rotate() {
    if (!confirm('Gerar um token novo? O token antigo para de funcionar agora e o seu bot precisa usar o novo.')) return;
    try {
      const r = await api<{ token: string; signingSecret: string }>(`/bot-apps/${bot.id}/token`, { body: {} });
      onSecrets({ botId: bot.id, token: r.token, signingSecret: r.signingSecret });
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function remove() {
    if (!confirm(`Apagar o bot "${bot.name}"? Ele sai de todos os servidores e o token deixa de existir. As mensagens antigas ficam.`)) return;
    try {
      await api(`/bot-apps/${bot.id}`, { method: 'DELETE' });
      toast('Bot apagado.');
      onChange();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <div className="dev-bot">
      <div className="dev-bot-head">
        <strong>{bot.name}</strong> <BotTag />
        {bot.disabled && <span className="danger-text small"> · desligado pela equipe do Resenha</span>}
        <span className="muted small"> · em {bot.guilds} servidor(es)</span>
      </div>
      <div className="dev-copy">
        <span className="muted small">ID do bot (passe para quem for instalar):</span>
        <code>{bot.id}</code>
        <button type="button" className="btn small" onClick={() => copy(bot.id, 'ID')}>
          <Copy size={14} /> Copiar
        </button>
      </div>
      <label>
        Nome
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} />
      </label>
      <label>
        Descrição
        <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
      </label>
      <label>
        Endereço do bot (https) que recebe os comandos
        <input value={url} onChange={(e) => setUrl(e.target.value)} maxLength={300} placeholder="https://meubot.exemplo.com/resenha" inputMode="url" />
      </label>
      <p className="muted small">
        Comandos registrados: {bot.commands.length ? bot.commands.map((c) => `/${c.name}`).join(' ') : 'nenhum ainda (o bot registra pela API).'}
      </p>
      <div className="dev-actions">
        <button type="button" className="btn small primary" disabled={busy} onClick={() => void save()}>
          Salvar
        </button>
        <button type="button" className="btn small" onClick={() => void rotate()}>
          <KeyRound size={14} /> Gerar novo token
        </button>
        <button type="button" className="btn small danger" onClick={() => void remove()}>
          <Trash2 size={14} /> Apagar bot
        </button>
      </div>
    </div>
  );
}

interface Installed {
  id: string;
  name: string;
  description: string;
  commands: { name: string; description: string; usage: string }[];
}
interface Preview {
  id: string;
  name: string;
  description: string;
  owner: string;
  commands: { name: string; description: string }[];
  hasUrl: boolean;
}

/** Integrações do servidor: bots de terceiros (instalados pelo ID do bot). */
export function ExternalBots({ guild }: { guild: Guild }) {
  const [list, setList] = useState<Installed[] | null>(null);
  const [id, setId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<{ bots: Installed[] }>(`/guilds/${guild.id}/bot-apps`).then((r) => setList(r.bots), () => setList([]));
  useEffect(() => void load(), [guild.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function find() {
    setBusy(true);
    try {
      setPreview(await api<Preview>(`/bot-apps/${encodeURIComponent(id.trim())}/public`));
    } catch (e) {
      setPreview(null);
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function install() {
    if (!preview) return;
    setBusy(true);
    try {
      await api(`/guilds/${guild.id}/bot-apps`, { body: { botId: preview.id } });
      clearCommands(guild.id);
      toast(`${preview.name} adicionado. Digite / no chat para ver os comandos.`);
      setPreview(null);
      setId('');
      await load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(b: Installed) {
    if (!confirm(`Remover o bot "${b.name}" deste servidor? Os comandos dele param de funcionar.`)) return;
    try {
      await api(`/guilds/${guild.id}/bot-apps/${b.id}`, { method: 'DELETE' });
      clearCommands(guild.id);
      await load();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <div className="external-bots">
      <h3>Bots de outras pessoas</h3>
      <p className="muted small">
        Bots criados por membros da comunidade. <strong>Só instale bots em quem você confia:</strong> o bot recebe o texto dos comandos que as pessoas usam e pode escrever nos canais. Ele não vê conversas privadas nem mensagens
        que não sejam comandos, e a moderação automática do servidor vale para ele.
      </p>
      {list?.map((b) => (
        <div key={b.id} className="bot-card">
          <div className="bot-card-text">
            <div>
              <strong>{b.name}</strong> <BotTag />
            </div>
            <span className="muted small">{b.description || 'Sem descrição.'}</span>
            <span className="muted small">{b.commands.length ? b.commands.map((c) => `/${c.name}`).join(' ') : 'Sem comandos registrados.'}</span>
          </div>
          <button type="button" className="btn small" onClick={() => void remove(b)}>
            Remover
          </button>
        </div>
      ))}
      <form
        className="ext-add"
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <label>
          Adicionar pelo ID do bot
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="bot_0123456789abcdef" maxLength={40} />
        </label>
        <button className="btn small" disabled={busy || !/^bot_[a-f0-9]{16}$/.test(id.trim())}>
          Procurar
        </button>
      </form>
      {preview && (
        <div className="bot-card">
          <div className="bot-card-text">
            <div>
              <strong>{preview.name}</strong> <BotTag /> <span className="muted small">de {preview.owner}</span>
            </div>
            <span className="muted small">{preview.description || 'Sem descrição.'}</span>
            <span className="muted small">{preview.commands.length ? `Comandos: ${preview.commands.map((c) => '/' + c.name).join(' ')}` : 'Ainda não registrou comandos.'}</span>
            {!preview.hasUrl && <span className="muted small">⚠ O dono ainda não colocou o endereço do bot: os comandos não vão responder.</span>}
          </div>
          <button type="button" className="btn small primary" disabled={busy} onClick={() => void install()}>
            Adicionar ao servidor
          </button>
        </div>
      )}
    </div>
  );
}
