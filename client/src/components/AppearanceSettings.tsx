import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Check, ImagePlus, Monitor, Moon, Palette, Sun, Trash2 } from 'lucide-react';
import {
  ACCENTS,
  DARK_BGS,
  NO_WALLPAPER,
  WALLPAPERS,
  deletePhoto,
  loadPhoto,
  savePhoto,
  setAppearance,
  setChatWallpaper,
  useAppearance,
  type ThemeMode,
  type WallpaperChoice,
} from '../lib/appearance';
import { closeModal, findChannel, toast } from '../store/app';
import { Modal } from './Modals';
import { InfoTip } from './ScreenShareModal';

const MODES: { id: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { id: 'dark', label: 'Escuro', icon: <Moon size={18} /> },
  { id: 'light', label: 'Claro', icon: <Sun size={18} /> },
  { id: 'system', label: 'Seguir o sistema', icon: <Monitor size={18} /> },
];

/** Configurações → Aparência. */
export function AppearanceSettings() {
  const mode = useAppearance((s) => s.mode);
  const resolved = useAppearance((s) => s.resolved);
  const accent = useAppearance((s) => s.accent);
  const bg = useAppearance((s) => s.bg);
  const wallpaper = useAppearance((s) => s.wallpaper);

  return (
    <>
      <div className="settings-card">
        <div className="share-head">
          <h3>Modo</h3>
        </div>
        <div className="audience-modes three" role="radiogroup" aria-label="Modo">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={mode === m.id ? 'selected' : ''} onClick={() => setAppearance({ mode: m.id })}>
              {m.icon}
              <span>{m.label}</span>
            </button>
          ))}
        </div>
        {mode === 'system' && <p className="muted small">Agora: {resolved === 'dark' ? 'escuro' : 'claro'} (acompanha o seu computador ou celular).</p>}
      </div>

      <div className="settings-card">
        <div className="share-head">
          <h3>Cor de destaque</h3>
          <InfoTip label="Cor de destaque">A cor dos botões principais, do que está selecionado e dos avisos de quem está falando.</InfoTip>
        </div>
        <div className="swatches" role="radiogroup" aria-label="Cor de destaque">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={accent === a.id}
              aria-label={a.label}
              title={a.label}
              className={`swatch${accent === a.id ? ' selected' : ''}`}
              style={{ background: resolved === 'light' ? a.light[0] : a.dark[0] }}
              onClick={() => setAppearance({ accent: a.id })}
            >
              {accent === a.id && <Check size={16} color={resolved === 'light' ? a.light[1] : a.dark[1]} />}
            </button>
          ))}
        </div>
      </div>

      {resolved === 'dark' && (
        <div className="settings-card">
          <div className="share-head">
            <h3>Fundo</h3>
          </div>
          <div className="audience-modes three" role="radiogroup" aria-label="Fundo">
            {DARK_BGS.map((b) => (
              <button key={b.id} type="button" role="radio" aria-checked={bg === b.id} className={bg === b.id ? 'selected' : ''} onClick={() => setAppearance({ bg: b.id })} title={b.hint}>
                <span className="bg-swatch" style={{ background: b.swatch }} />
                <span>{b.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="settings-card">
        <div className="share-head">
          <h3>Papel de parede dos chats</h3>
          <InfoTip label="Papel de parede">
            Só você vê, e fica só neste aparelho. Para uma conversa ter um papel de parede diferente, use o botão de paleta no topo dela.
          </InfoTip>
        </div>
        <WallpaperPicker photoKey="global" value={wallpaper} onChange={(w) => setAppearance({ wallpaper: w })} />
      </div>
    </>
  );
}

/** Escolha do papel de parede: nenhum, biblioteca, cor ou foto própria; com escurecer e desfocar. */
export function WallpaperPicker({ photoKey, value, onChange }: { photoKey: string; value: WallpaperChoice; onChange(w: WallpaperChoice): void }) {
  const resolved = useAppearance((s) => s.resolved);
  const accentId = useAppearance((s) => s.accent);
  const accent = (ACCENTS.find((a) => a.id === accentId) ?? ACCENTS[0])[resolved === 'light' ? 'light' : 'dark'][0];
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = (w: Partial<WallpaperChoice>) => onChange({ ...value, ...w } as WallpaperChoice);
  const isGradient = (id?: string) => ['sunset', 'ocean', 'forest', 'aurora', 'neon'].includes(id ?? '');

  return (
    <div className="wallpaper-picker">
      <div className="wallpaper-grid" role="radiogroup" aria-label="Papel de parede">
        <button type="button" role="radio" aria-checked={value.kind === 'none'} className={`wp-tile none${value.kind === 'none' ? ' selected' : ''}`} onClick={() => pick({ kind: 'none' })}>
          <span>Nenhum</span>
        </button>
        {WALLPAPERS.map((w) => (
          <button
            key={w.id}
            type="button"
            role="radio"
            aria-checked={value.kind === 'library' && value.id === w.id}
            className={`wp-tile${value.kind === 'library' && value.id === w.id ? ' selected' : ''}`}
            style={{ background: `${w.css(resolved, accent)}, var(--bg-1)` }}
            onClick={() => pick({ kind: 'library', id: w.id, dim: isGradient(w.id) ? 0.35 : 0 })}
          >
            <span>{w.label}</span>
          </button>
        ))}
        <label className={`wp-tile color${value.kind === 'color' ? ' selected' : ''}`} style={value.kind === 'color' && value.color ? { background: value.color } : undefined}>
          <input
            type="color"
            aria-label="Cor sólida"
            value={value.color ?? (resolved === 'dark' ? '#1f2a3a' : '#dfe9f5')}
            onChange={(e) => pick({ kind: 'color', color: e.target.value, dim: 0.15 })}
          />
          <span>Cor</span>
        </label>
        <button type="button" className={`wp-tile photo${value.kind === 'photo' ? ' selected' : ''}`} disabled={busy} onClick={() => file.current?.click()}>
          <ImagePlus size={18} />
          <span>{busy ? 'Preparando…' : value.kind === 'photo' ? 'Trocar foto' : 'Minha foto'}</span>
        </button>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          aria-label="Escolher foto para o papel de parede"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setBusy(true);
            try {
              await savePhoto(photoKey, f);
              onChange({ ...value, kind: 'photo', dim: 0.55, blur: value.kind === 'photo' ? value.blur : 0 });
            } catch (err) {
              toast((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>

      {value.kind !== 'none' && (
        <div className="wallpaper-sliders">
          <label>
            {resolved === 'dark' ? 'Escurecer' : 'Clarear'} <strong>{Math.round(value.dim * 100)}%</strong>
            <input type="range" min={0} max={0.9} step={0.05} value={value.dim} onChange={(e) => pick({ dim: Number(e.target.value) })} />
          </label>
          {value.kind === 'photo' && (
            <label>
              Desfocar <strong>{value.blur}px</strong>
              <input type="range" min={0} max={20} step={1} value={value.blur} onChange={(e) => pick({ blur: Number(e.target.value) })} />
            </label>
          )}
          {value.kind === 'photo' && (
            <button
              type="button"
              className="btn small ghost"
              onClick={() => {
                void deletePhoto(photoKey);
                onChange({ ...NO_WALLPAPER });
              }}
            >
              <Trash2 size={14} /> Tirar a foto
            </button>
          )}
        </div>
      )}

      <div className="wallpaper-preview" aria-hidden>
        <WallpaperLayer choice={value} photoKey={photoKey} />
        <div className="wp-msg">
          <span className="wp-avatar" />
          <span>
            <strong>Bia</strong>
            <span className="wp-text">Bora jogar hoje? 🎮</span>
          </span>
        </div>
        <div className="wp-msg">
          <span className="wp-avatar b" />
          <span>
            <strong>Você</strong>
            <span className="wp-text">Bora! Entro na call às 21h.</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Desenha o papel de parede (preenche o elemento pai, atrás do conteúdo). */
export function WallpaperLayer({ choice, photoKey }: { choice: WallpaperChoice; photoKey: string }) {
  const resolved = useAppearance((s) => s.resolved);
  const accentId = useAppearance((s) => s.accent);
  const photoVersion = useAppearance((s) => s.photoVersion);
  const accent = (ACCENTS.find((a) => a.id === accentId) ?? ACCENTS[0])[resolved === 'light' ? 'light' : 'dark'][0];
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => {
    if (choice.kind !== 'photo') return setPhoto(null);
    let url: string | null = null;
    let alive = true;
    void loadPhoto(photoKey).then((b) => {
      if (!alive || !b) return;
      url = URL.createObjectURL(b);
      setPhoto(url);
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [choice.kind, photoKey, photoVersion]);

  const style = useMemo<CSSProperties | null>(() => {
    if (choice.kind === 'library') {
      const w = WALLPAPERS.find((x) => x.id === choice.id);
      return w ? { background: `${w.css(resolved, accent)}, var(--bg-1)` } : null;
    }
    if (choice.kind === 'color' && choice.color) return { background: choice.color };
    if (choice.kind === 'photo' && photo) {
      const blur = choice.blur;
      return {
        backgroundImage: `url(${photo})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        filter: blur ? `blur(${blur}px)` : undefined,
        inset: blur ? -blur * 2 : 0,
      };
    }
    return null;
  }, [choice, resolved, accent, photo]);

  if (!style) return null;
  return (
    <div className="chat-wallpaper" aria-hidden>
      <div className="chat-wallpaper-img" style={style} />
      {/* escurece (escuro) ou clareia (claro) para o texto continuar legível */}
      <div className="chat-wallpaper-dim" style={{ opacity: choice.dim }} />
    </div>
  );
}

/** O papel de parede de uma conversa: o dela, se tiver, senão o de todos os chats. */
export function useChatWallpaper(channelId: string) {
  const own = useAppearance((s) => s.perChat[channelId]);
  const global = useAppearance((s) => s.wallpaper);
  return own ? { choice: own, photoKey: channelId, own: true } : { choice: global, photoKey: 'global', own: false };
}

/** Janela "Papel de parede desta conversa". */
export function ChatWallpaperModal({ channelId }: { channelId: string }) {
  const own = useAppearance((s) => s.perChat[channelId]);
  const global = useAppearance((s) => s.wallpaper);
  const [custom, setCustom] = useState(!!own);
  const channel = findChannel(channelId);
  const name = channel?.type === 'dm' ? `a conversa com ${channel.name}` : `#${channel?.name ?? 'canal'}`;
  return (
    <Modal title="Papel de parede desta conversa">
      <div className="form">
        <p className="muted small">Só você vê, e fica só neste aparelho.</p>
        <div className="segmented" role="radiogroup" aria-label="Papel de parede desta conversa">
          <button
            type="button"
            role="radio"
            aria-checked={!custom}
            className={!custom ? 'selected' : ''}
            onClick={() => {
              setCustom(false);
              setChatWallpaper(channelId, null);
            }}
          >
            O de todos os chats
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={custom}
            className={custom ? 'selected' : ''}
            onClick={() => {
              setCustom(true);
              if (!own) setChatWallpaper(channelId, { ...global, kind: global.kind === 'photo' ? 'none' : global.kind });
            }}
          >
            <Palette size={15} /> Só para {name}
          </button>
        </div>
        {custom && <WallpaperPicker photoKey={channelId} value={own ?? global} onChange={(w) => setChatWallpaper(channelId, w)} />}
        <div className="modal-actions">
          <button className="btn primary" onClick={closeModal}>
            Pronto
          </button>
        </div>
      </div>
    </Modal>
  );
}
