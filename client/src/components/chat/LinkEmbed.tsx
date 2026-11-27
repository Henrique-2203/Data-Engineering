import { useEffect, useState } from 'react';
import { Play, Tv } from 'lucide-react';
import { findEmbedUrls } from '../../../../shared/embedUrl';
import { api } from '../../lib/api';
import { useVoice } from '../../store/voice';
import { toast } from '../../store/app';
import { together } from '../../voice/together';

export interface Embed {
  provider: 'youtube' | 'spotify';
  id: string;
  title: string | null;
  author: string | null;
  thumb: string | null;
  start?: number;
}

const cache = new Map<string, Promise<Embed | null>>();
/** Título e miniatura pelo nosso servidor (o seu IP não vai para o YouTube/Spotify só por abrir o chat). */
export function loadEmbed(url: string): Promise<Embed | null> {
  let p = cache.get(url);
  if (!p) {
    p = api<{ embed: Embed }>(`/embed?url=${encodeURIComponent(url)}`).then(
      (r) => r.embed,
      () => null,
    );
    cache.set(url, p);
  }
  return p;
}

/** Players de YouTube/Spotify dos links da mensagem (no máximo 2). */
export function LinkEmbeds({ content }: { content: string }) {
  const urls = findEmbedUrls(content);
  if (!urls.length) return null;
  return (
    <div className="link-embeds">
      {urls.map((u) => (
        <LinkEmbed key={u} url={u} />
      ))}
    </div>
  );
}

function LinkEmbed({ url }: { url: string }) {
  const [embed, setEmbed] = useState<Embed | null | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const inCall = useVoice((s) => s.status === 'connected' && !!s.channelId);
  useEffect(() => {
    let alive = true;
    void loadEmbed(url).then((e) => alive && setEmbed(e));
    return () => {
      alive = false;
    };
  }, [url]);
  if (!embed) return null;

  if (embed.provider === 'spotify') {
    const tall = !/^(track|episode)\//.test(embed.id);
    return (
      <div className={`link-embed spotify${playing ? ' playing' : ''}`}>
        {playing ? (
          <iframe
            title={embed.title ?? 'Spotify'}
            src={`https://open.spotify.com/embed/${embed.id}?utm_source=resenha`}
            height={tall ? 352 : 152}
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button className="embed-card" onClick={() => setPlaying(true)} aria-label={`Ouvir ${embed.title ?? 'no Spotify'} aqui`}>
            {embed.thumb ? <img src={embed.thumb} alt="" loading="lazy" /> : <span className="embed-thumb-empty">♪</span>}
            <span className="embed-text">
              <strong className="ellipsis">{embed.title ?? 'Spotify'}</strong>
              <span className="muted small">Spotify · toque para ouvir aqui</span>
            </span>
            <Play size={20} className="embed-play" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`link-embed youtube${playing ? ' playing' : ''}`}>
      {playing ? (
        <iframe
          title={embed.title ?? 'YouTube'}
          src={`https://www.youtube-nocookie.com/embed/${embed.id}?autoplay=1&rel=0&playsinline=1${embed.start ? `&start=${embed.start}` : ''}`}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <button className="embed-video" onClick={() => setPlaying(true)} aria-label={`Assistir ${embed.title ?? 'vídeo do YouTube'} aqui`}>
          {embed.thumb && <img src={embed.thumb} alt="" loading="lazy" />}
          <span className="embed-play-big">
            <Play size={28} />
          </span>
        </button>
      )}
      <div className="embed-meta">
        <span className="ellipsis">
          <strong>{embed.title ?? 'Vídeo do YouTube'}</strong>
          {embed.author && <span className="muted small"> · {embed.author}</span>}
        </span>
        {inCall && (
          <button
            className="btn small ghost"
            title="Todo mundo da call assiste junto, sincronizado"
            onClick={() => {
              together.play(embed.id, embed.title, embed.start ?? 0);
              toast('▶️ Tocando para todo mundo da call.');
            }}
          >
            <Tv size={14} /> Assistir juntos na call
          </button>
        )}
      </div>
    </div>
  );
}
