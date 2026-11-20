import { useRef, useState } from 'react';
import { Play, Trash2, Upload } from 'lucide-react';
import type { Expression, ExpressionKind, Guild } from '../../../shared/types';
import { api } from '../lib/api';
import { fileUrl } from '../lib/expressions';
import { refreshGuild } from '../lib/socket';
import { SOUND_MAX_SECONDS, audioDuration, prepareExpressionImage, prepareSound, uploadExpression } from '../lib/upload';
import { toast } from '../store/app';
import { playSoundFile } from '../lib/soundboard';

const MAX: Record<ExpressionKind, number> = { emoji: 200, sticker: 100, sound: 100 };

/** "Festa Junina!.png" -> "festa_junina" (nome de emoji: minúsculas, números e _) */
export function emojiNameFrom(filename: string): string {
  const base = filename
    .replace(/\.[^.]+$/, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return base.length >= 2 ? base : `emoji_${base || Math.floor(Math.random() * 1000)}`;
}
const titleFrom = (filename: string) => filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 30) || 'sem nome';

/** Emojis, figurinhas e soundboard do servidor (no Discord, as vagas dependem de "boost"). */
export function ExpressionSettings({ guild }: { guild: Guild }) {
  const of = (k: ExpressionKind) => guild.expressions.filter((e) => e.kind === k);
  return (
    <div className="form settings-section">
      <h2>Emojis, figurinhas e sons</h2>
      <p className="muted small">
        Tudo grátis e sem "boost": qualquer membro usa os emojis e figurinhas deste servidor em todas as conversas, e os sons
        tocam para todos da chamada. Os arquivos são reduzidos antes de enviar para não pesar no banco.
      </p>
      <ImageSection guild={guild} kind="emoji" items={of('emoji')} />
      <ImageSection guild={guild} kind="sticker" items={of('sticker')} />
      <SoundSection guild={guild} items={of('sound')} />
    </div>
  );
}

async function rename(e: Expression, name: string) {
  if (!name.trim() || name === e.name) return;
  try {
    await api(`/expressions/${e.id}`, { method: 'PATCH', body: { name } });
    await refreshGuild(e.guildId);
  } catch (err) {
    toast((err as Error).message);
    await refreshGuild(e.guildId);
  }
}

async function remove(e: Expression) {
  if (!confirm(`Apagar ${e.kind === 'emoji' ? `:${e.name}:` : `"${e.name}"`}? Ele some das mensagens antigas também.`)) return;
  try {
    await api(`/expressions/${e.id}`, { method: 'DELETE' });
    await refreshGuild(e.guildId);
  } catch (err) {
    toast((err as Error).message);
  }
}

function ImageSection({ guild, kind, items }: { guild: Guild; kind: 'emoji' | 'sticker'; items: Expression[] }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const label = kind === 'emoji' ? 'Emojis' : 'Figurinhas';

  async function upload(files: File[]) {
    let ok = 0;
    let bytes = 0;
    for (const [i, file] of files.entries()) {
      setBusy(`Enviando ${i + 1} de ${files.length}…`);
      try {
        const blob = await prepareExpressionImage(kind, file);
        const r = await uploadExpression(guild.id, kind, kind === 'emoji' ? emojiNameFrom(file.name) : titleFrom(file.name), blob);
        ok++;
        bytes += r.bytes;
      } catch (err) {
        toast(`${file.name}: ${(err as Error).message}`);
      }
    }
    setBusy(null);
    if (ok) {
      toast(`${ok} ${kind === 'emoji' ? (ok > 1 ? 'emojis adicionados' : 'emoji adicionado') : ok > 1 ? 'figurinhas adicionadas' : 'figurinha adicionada'} (${Math.max(1, Math.round(bytes / 1024))} KB).`);
      await refreshGuild(guild.id);
    }
  }

  return (
    <section className="expr-section">
      <div className="expr-head">
        <h3>
          {label} <span className="muted small">{items.length} de {MAX[kind]}</span>
        </h3>
        <button className="btn small" disabled={!!busy || items.length >= MAX[kind]} onClick={() => input.current?.click()}>
          <Upload size={15} /> {busy ?? (kind === 'emoji' ? 'Enviar emojis' : 'Enviar figurinhas')}
        </button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          aria-label={kind === 'emoji' ? 'Arquivos de emoji' : 'Arquivos de figurinha'}
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(e) => {
            void upload([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </div>
      <p className="muted small">
        {kind === 'emoji'
          ? 'PNG, JPG, WebP ou GIF animado (até 256 KB). Vira :nome: no chat; dá para escolher vários arquivos de uma vez.'
          : 'PNG, JPG, WebP ou GIF animado (até 512 KB). Aparece no botão de figurinhas ao lado do campo de mensagem.'}
      </p>
      {items.length > 0 && (
        <ul className={`expr-list kind-${kind}`}>
          {items.map((e) => (
            <li key={e.id} className="expr-item">
              <img src={fileUrl(e.fileId)} alt="" />
              <input
                defaultValue={e.name}
                key={e.name}
                aria-label={`Nome ${kind === 'emoji' ? 'do emoji' : 'da figurinha'} ${e.name}`}
                maxLength={kind === 'emoji' ? 32 : 30}
                onBlur={(ev) => void rename(e, kind === 'emoji' ? ev.target.value.trim().toLowerCase() : ev.target.value.trim())}
                onKeyDown={(ev) => ev.key === 'Enter' && (ev.target as HTMLInputElement).blur()}
              />
              <button className="icon-btn small" aria-label={`Apagar ${e.name}`} title="Apagar" onClick={() => void remove(e)}>
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SoundSection({ guild, items }: { guild: Guild; items: Expression[] }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState(0);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🔊');
  const [start, setStart] = useState(0);
  const [busy, setBusy] = useState(false);

  async function choose(f: File | undefined) {
    if (!f) return;
    try {
      setDuration(await audioDuration(f));
      setFile(f);
      setName(titleFrom(f.name));
      setStart(0);
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function add() {
    if (!file) return;
    setBusy(true);
    try {
      const blob = await prepareSound(file, start);
      const r = await uploadExpression(guild.id, 'sound', name.trim() || 'som', blob, emoji.trim() || null);
      toast(`Som adicionado (${Math.max(1, Math.round(r.bytes / 1024))} KB).`);
      setFile(null);
      await refreshGuild(guild.id);
    } catch (err) {
      toast((err as Error).message);
    }
    setBusy(false);
  }

  const long = duration > SOUND_MAX_SECONDS + 0.2;
  return (
    <section className="expr-section">
      <div className="expr-head">
        <h3>
          Soundboard <span className="muted small">{items.length} de {MAX.sound}</span>
        </h3>
        <button className="btn small" disabled={busy || items.length >= MAX.sound} onClick={() => input.current?.click()}>
          <Upload size={15} /> Enviar som
        </button>
        <input ref={input} type="file" hidden aria-label="Arquivo de som" accept="audio/*" onChange={(e) => {
          void choose(e.target.files?.[0]);
          e.target.value = '';
        }} />
      </div>
      <p className="muted small">MP3, OGG ou WAV. Sons longos são recortados em {SOUND_MAX_SECONDS} segundos (você escolhe o trecho).</p>

      {file && (
        <div className="sound-new">
          <div className="row gap-s">
            <label className="sound-emoji-field">
              Emoji
              <input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={8} aria-label="Emoji do som" />
            </label>
            <label className="grow">
              Nome do som
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} />
            </label>
          </div>
          <p className="muted small">
            Duração: {duration.toFixed(1)} s{long ? ` — vamos usar ${SOUND_MAX_SECONDS} s a partir do ponto escolhido.` : ''}
          </p>
          {long && (
            <label>
              Começar em (segundos)
              <input
                type="range"
                min={0}
                max={Math.max(0, Math.floor((duration - 1) * 10) / 10)}
                step={0.1}
                value={start}
                onChange={(e) => setStart(Number(e.target.value))}
              />
              <span className="muted small">{start.toFixed(1)} s até {(start + Math.min(SOUND_MAX_SECONDS, duration - start)).toFixed(1)} s</span>
            </label>
          )}
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setFile(null)} disabled={busy}>
              Cancelar
            </button>
            <button className="btn primary" onClick={() => void add()} disabled={busy || !name.trim()}>
              {busy ? (long ? 'Recortando…' : 'Enviando…') : 'Adicionar som'}
            </button>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <ul className="expr-list kind-sound">
          {items.map((e) => (
            <li key={e.id} className="expr-item">
              <button className="icon-btn small" aria-label={`Ouvir ${e.name}`} title="Ouvir" onClick={() => playSoundFile(e.fileId, 1)}>
                <Play size={15} />
              </button>
              <span className="sound-emoji">{e.emoji ?? '🔊'}</span>
              <input
                defaultValue={e.name}
                key={e.name}
                aria-label={`Nome do som ${e.name}`}
                maxLength={30}
                onBlur={(ev) => void rename(e, ev.target.value.trim())}
                onKeyDown={(ev) => ev.key === 'Enter' && (ev.target as HTMLInputElement).blur()}
              />
              <button className="icon-btn small" aria-label={`Apagar ${e.name}`} title="Apagar" onClick={() => void remove(e)}>
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
