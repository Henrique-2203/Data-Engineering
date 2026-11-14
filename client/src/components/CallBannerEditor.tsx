import { useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import type { PublicUser } from '../../../shared/types';
import { api, ApiError, authHeaders } from '../lib/api';
import { prepareCover } from '../lib/upload';
import { CALL_BANNERS, CallBannerBackground } from '../lib/callBanners';
import { toast, updateUserEverywhere, useApp } from '../store/app';
import { Avatar } from './Avatar';

/**
 * Configurações → Perfil → Banner da call: fundo do seu quadro quando você está numa chamada.
 * Temas prontos (arte original do Resenha), sua própria imagem ou o banner do perfil. A prévia mostra
 * o mesmo banner num quadro largo e num estreito: ele se ajusta ao tamanho do quadro de cada pessoa.
 */
export function CallBannerEditor({ hasProfileBanner }: { hasProfileBanner: boolean }) {
  const me = useApp((s) => s.me)!;
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState(me.callBannerPos ?? 50);
  const file = useRef<HTMLInputElement>(null);
  const current = me.callBanner ?? null;
  const isImage = !!current?.startsWith('image:');

  async function save(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const { user } = await api<{ user: PublicUser }>('/me', { method: 'PATCH', body });
      updateUserEverywhere(user);
    } catch (err) {
      toast((err as Error).message);
    }
    setBusy(false);
  }

  async function upload(f?: File) {
    if (!f) return;
    setBusy(true);
    try {
      // 16:9 em até 1280×720 (WebP): o quadro corta as bordas conforme o tamanho
      const blob = await prepareCover(f, 1280, 720);
      const res = await fetch('/api/me/call-banner', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': blob.type }, body: blob });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, data.error ?? 'Não foi possível enviar a imagem.');
      updateUserEverywhere(data.user);
      toast('Banner da call atualizado.');
    } catch (err) {
      toast((err as Error).message);
    }
    setBusy(false);
  }

  async function removeUpload() {
    setBusy(true);
    try {
      const r = await api<{ user: PublicUser }>('/me/call-banner', { method: 'DELETE' });
      updateUserEverywhere(r.user);
    } catch (err) {
      toast((err as Error).message);
    }
    setBusy(false);
  }

  const preview = { ...me, callBannerPos: pos };
  return (
    <section className="call-banner-editor" aria-label="Banner da call">
      <h3 className="subhead">Banner da call</h3>
      <p className="muted small">Aparece atrás da sua foto no seu quadro da chamada. Ele se ajusta ao tamanho do quadro de cada pessoa.</p>

      <div className="cb-preview" aria-label="Prévia do banner">
        {(['wide', 'narrow'] as const).map((shape) => (
          <div key={shape} className={`tile user cb-tile ${shape}${current ? ' has-banner' : ''}`}>
            <CallBannerBackground banner={current} pos={preview.callBannerPos} />
            <div className="tile-center">
              <Avatar user={me} size={shape === 'wide' ? 56 : 44} />
            </div>
            <div className="tile-label">
              <span className="ellipsis">{me.displayName}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="cb-grid" role="radiogroup" aria-label="Escolha o banner">
        <button type="button" role="radio" aria-checked={!current} className={`cb-option none${!current ? ' selected' : ''}`} disabled={busy} onClick={() => void save({ callBanner: 'none' })}>
          <span>Nenhum</span>
        </button>
        {CALL_BANNERS.map((b) => {
          const value = `preset:${b.id}`;
          return (
            <button
              key={b.id}
              type="button"
              role="radio"
              aria-checked={current === value}
              aria-label={b.name}
              title={`${b.name}: ${b.vibe}`}
              className={`cb-option${current === value ? ' selected' : ''}`}
              disabled={busy}
              onClick={() => void save({ callBanner: value })}
            >
              <CallBannerBackground banner={value} />
              <span className="cb-name">{b.name}</span>
            </button>
          );
        })}
      </div>

      <div className="cb-actions">
        <button type="button" className="btn small" disabled={busy} onClick={() => file.current?.click()}>
          <ImagePlus size={15} /> Enviar meu banner
        </button>
        {hasProfileBanner && (
          <button type="button" className="btn small ghost" disabled={busy} onClick={() => void save({ callBanner: 'profile' })}>
            Usar o banner do perfil
          </button>
        )}
        {isImage && (
          <button type="button" className="btn small ghost" disabled={busy} onClick={() => void removeUpload()}>
            <Trash2 size={15} /> Remover imagem enviada
          </button>
        )}
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void upload(e.target.files?.[0])} />
      </div>

      {isImage && (
        <label>
          Posição da imagem no quadro
          <input
            type="range"
            min={0}
            max={100}
            value={pos}
            aria-label="Posição da imagem"
            onChange={(e) => setPos(Number(e.target.value))}
            onPointerUp={() => void save({ callBannerPos: pos })}
            onKeyUp={() => void save({ callBannerPos: pos })}
          />
          <span className="muted small">Arraste para escolher qual parte da imagem aparece quando o quadro fica estreito.</span>
        </label>
      )}
      <p className="muted small">
        Os temas são artes originais do Resenha, no clima de cada estilo de jogo. Ao enviar uma imagem, use uma que seja sua ou que você
        tenha direito de usar (sem conteúdo proibido pelos Termos). PNG, JPG ou WebP; GIF não, para não pesar na call de ninguém.
      </p>
    </section>
  );
}
