import type { ReactNode } from 'react';
import type { CallBannerPreset } from '../../../shared/callBanners';

/**
 * Temas prontos do banner da call: desenhos ORIGINAIS do Resenha, em vetor (cabem em qualquer tamanho
 * de quadro sem distorcer: o desenho é cortado pelas bordas como "cover"). Nada de imagens, logos ou
 * personagens de jogos de terceiros: só o clima de cada estilo de jogo.
 * Todos usam viewBox 320×180 com o "assunto" no meio, para funcionar do quadro largo ao estreito.
 */
export interface CallBannerTheme {
  id: CallBannerPreset;
  name: string;
  /** que tipo de jogo combina */
  vibe: string;
  art: ReactNode;
}

const sky = (id: string, stops: [number, string][]) => (
  <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
    {stops.map(([o, c]) => (
      <stop key={o} offset={o} stopColor={c} />
    ))}
  </linearGradient>
);

export const CALL_BANNERS: CallBannerTheme[] = [
  {
    id: 'cidade-neon',
    name: 'Cidade Neon',
    vibe: 'Mundo aberto e cidade grande ao pôr do sol',
    art: (
      <>
        <defs>
          {sky('cn-s', [
            [0, '#1a0b3d'],
            [0.55, '#b3246b'],
            [1, '#ff9a3c'],
          ])}
          {sky('cn-sun', [
            [0, '#ffe36e'],
            [1, '#ff4f8b'],
          ])}
        </defs>
        <rect width="320" height="180" fill="url(#cn-s)" />
        <circle cx="160" cy="112" r="46" fill="url(#cn-sun)" />
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x="110" y={104 + i * 9} width="100" height={2 + i} fill="#b3246b" />
        ))}
        <path d="M0 150 L0 104 L18 104 L18 88 L34 88 L34 110 L52 110 L52 76 L70 76 L70 118 L92 118 L92 98 L104 98 L104 150 Z" fill="#12082a" />
        <path d="M216 150 L216 96 L232 96 L232 70 L250 70 L250 112 L268 112 L268 86 L286 86 L286 104 L304 104 L304 80 L320 80 L320 150 Z" fill="#12082a" />
        <rect y="148" width="320" height="32" fill="#0b0520" />
        <path d="M0 160 H320 M0 170 H320" stroke="#ff4f8b" strokeOpacity=".35" />
        {[
          [26, 1],
          [292, -1],
        ].map(([x, d]) => (
          <g key={x} fill="#0b0520">
            <rect x={x - 1.5} y="96" width="3" height="54" rx="1.5" transform={`rotate(${d * 6} ${x} 150)`} />
            <path d={`M${x} 96 q${-22 * d} -2 ${-30 * d} 12 q${14 * d} -12 ${30 * d} -12 q${-8 * d} -16 ${-26 * d} -16 q${20 * d} -2 ${26 * d} 16 q${6 * d} -20 ${24 * d} -20 q${-16 * d} 8 ${-24 * d} 20 q${22 * d} -6 ${30 * d} 10 q${-16 * d} -10 ${-30 * d} -10 z`} />
          </g>
        ))}
      </>
    ),
  },
  {
    id: 'tatico',
    name: 'Tático',
    vibe: 'Tiro tático em equipe',
    art: (
      <>
        <defs>
          <pattern id="tt-hex" width="20" height="17.32" patternUnits="userSpaceOnUse">
            <path d="M5 0 H15 L20 8.66 L15 17.32 H5 L0 8.66 Z" fill="none" stroke="#f59e0b" strokeOpacity=".12" />
          </pattern>
          <pattern id="tt-hz" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="16" fill="#f59e0b" />
          </pattern>
        </defs>
        <rect width="320" height="180" fill="#1b1e24" />
        <rect width="320" height="180" fill="url(#tt-hex)" />
        <rect y="0" width="320" height="10" fill="url(#tt-hz)" opacity=".8" />
        <rect y="170" width="320" height="10" fill="url(#tt-hz)" opacity=".8" />
        <g stroke="#f59e0b" strokeWidth="2" fill="none" opacity=".55">
          <circle cx="160" cy="90" r="44" />
          <circle cx="160" cy="90" r="20" strokeOpacity=".6" />
          <path d="M160 34 V62 M160 118 V146 M104 90 H132 M188 90 H216" />
        </g>
        <circle cx="160" cy="90" r="2.5" fill="#ef4444" />
        <path d="M14 40 h40 M14 46 h26 M266 134 h40 M280 140 h26" stroke="#9ca3af" strokeOpacity=".5" strokeWidth="2" />
      </>
    ),
  },
  {
    id: 'blocos',
    name: 'Blocos',
    vibe: 'Construção e sobrevivência em blocos',
    art: (
      <>
        <rect width="320" height="180" fill="#7cc4f5" />
        <rect x="236" y="22" width="26" height="26" fill="#fff6a8" />
        {[
          [30, 30, 46],
          [96, 46, 38],
          [190, 26, 54],
        ].map(([x, y, w]) => (
          <g key={x} fill="#fff" opacity=".9">
            <rect x={x} y={y} width={w} height="10" />
            <rect x={x + 10} y={y - 8} width={w - 22} height="8" />
          </g>
        ))}
        {Array.from({ length: 20 }, (_, i) => {
          const h = [5, 5, 6, 6, 7, 6, 5, 5, 4, 4, 5, 6, 7, 7, 6, 6, 5, 4, 4, 5][i];
          return (
            <g key={i}>
              <rect x={i * 16} y={180 - h * 16} width="16" height={h * 16} fill="#8b5a2b" />
              <rect x={i * 16} y={180 - h * 16} width="16" height="6" fill="#4caf50" />
              <rect x={i * 16} y={180 - h * 16 + 6} width="16" height="3" fill="#3d8b40" />
              <rect x={i * 16 + 4} y={180 - h * 16 + 28} width="4" height="4" fill="#6d4420" />
              <rect x={i * 16 + 10} y={180 - h * 16 + 52} width="4" height="4" fill="#9ca3af" />
            </g>
          );
        })}
        <g>
          <rect x="250" y="38" width="8" height="34" fill="#6d4420" />
          <rect x="236" y="22" width="36" height="24" fill="#2e7d32" />
        </g>
      </>
    ),
  },
  {
    id: 'arena',
    name: 'Arena',
    vibe: 'Heróis, habilidades e partidas ranqueadas',
    art: (
      <>
        <defs>
          <radialGradient id="ar-g" cx=".5" cy=".55" r=".7">
            <stop offset="0" stopColor="#3b1d8f" />
            <stop offset="1" stopColor="#0c0a22" />
          </radialGradient>
          <linearGradient id="ar-b" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#22d3ee" />
            <stop offset="1" stopColor="#a855f7" />
          </linearGradient>
        </defs>
        <rect width="320" height="180" fill="url(#ar-g)" />
        {[
          'M40 180 L120 20 L132 24 L60 180 Z',
          'M300 0 L200 170 L188 166 L280 0 Z',
          'M150 180 L176 60 L184 62 L166 180 Z',
        ].map((d) => (
          <path key={d} d={d} fill="url(#ar-b)" opacity=".55" />
        ))}
        <path d="M160 40 L176 74 L214 78 L186 102 L194 140 L160 120 L126 140 L134 102 L106 78 L144 74 Z" fill="none" stroke="#e9d5ff" strokeOpacity=".5" strokeWidth="2" />
        {Array.from({ length: 18 }, (_, i) => (
          <circle key={i} cx={(i * 53) % 320} cy={(i * 37) % 180} r={(i % 3) + 1} fill="#c4b5fd" opacity=".7" />
        ))}
      </>
    ),
  },
  {
    id: 'tempestade',
    name: 'Zona da Tempestade',
    vibe: 'Battle royale: cai na ilha e sobrevive',
    art: (
      <>
        <defs>
          {sky('tp-s', [
            [0, '#4c1d95'],
            [0.6, '#7c3aed'],
            [1, '#c084fc'],
          ])}
        </defs>
        <rect width="320" height="180" fill="url(#tp-s)" />
        <ellipse cx="160" cy="150" rx="140" ry="34" fill="#38bdf8" opacity=".5" />
        <path d="M70 150 Q110 112 160 116 Q214 112 252 150 Z" fill="#22c55e" />
        <path d="M118 140 l10 -22 l10 22 z M182 138 l12 -28 l12 28 z" fill="#15803d" />
        <circle cx="160" cy="132" r="110" fill="none" stroke="#f0abfc" strokeWidth="3" strokeDasharray="10 6" opacity=".8" />
        <path d="M218 30 l-12 26 h12 l-10 26" stroke="#fde68a" strokeWidth="3" fill="none" />
        <g fill="#fff">
          <path d="M150 26 h20 l-4 6 h-12 z" />
          <rect x="159" y="32" width="2" height="12" />
        </g>
      </>
    ),
  },
  {
    id: 'corrida',
    name: 'Corrida',
    vibe: 'Velocidade, pista e drift',
    art: (
      <>
        <defs>
          {sky('cr-s', [
            [0, '#0f172a'],
            [1, '#1e293b'],
          ])}
          <pattern id="cr-chk" width="12" height="12" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="#fff" />
            <rect x="6" y="6" width="6" height="6" fill="#fff" />
          </pattern>
        </defs>
        <rect width="320" height="180" fill="url(#cr-s)" />
        <path d="M0 180 L130 70 H190 L320 180 Z" fill="#374151" />
        <path d="M160 70 V180" stroke="#facc15" strokeWidth="3" strokeDasharray="14 12" />
        <path d="M0 180 L130 70 M320 180 L190 70" stroke="#ef4444" strokeWidth="4" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <path key={i} d={`M${20 + i * 50} ${30 + (i % 3) * 14} h${70 - (i % 2) * 20}`} stroke="#38bdf8" strokeOpacity=".5" strokeWidth="2" />
        ))}
        <rect x="0" y="0" width="320" height="12" fill="url(#cr-chk)" opacity=".85" />
      </>
    ),
  },
  {
    id: 'gramado',
    name: 'Gramado',
    vibe: 'Futebol e esportes',
    art: (
      <>
        {Array.from({ length: 10 }, (_, i) => (
          <rect key={i} x={i * 32} width="32" height="180" fill={i % 2 ? '#2f9e44' : '#37b24d'} />
        ))}
        <g stroke="#fff" strokeOpacity=".85" strokeWidth="2.5" fill="none">
          <rect x="8" y="8" width="304" height="164" />
          <path d="M160 8 V172" />
          <circle cx="160" cy="90" r="30" />
          <rect x="8" y="50" width="40" height="80" />
          <rect x="272" y="50" width="40" height="80" />
        </g>
        <circle cx="160" cy="90" r="3" fill="#fff" />
      </>
    ),
  },
  {
    id: 'espaco',
    name: 'Espaço',
    vibe: 'Exploração espacial e ficção científica',
    art: (
      <>
        <defs>
          <radialGradient id="es-n" cx=".3" cy=".4" r=".6">
            <stop offset="0" stopColor="#7c3aed" stopOpacity=".7" />
            <stop offset="1" stopColor="#020617" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="es-p" cx=".35" cy=".35" r=".7">
            <stop offset="0" stopColor="#fbbf24" />
            <stop offset="1" stopColor="#b45309" />
          </radialGradient>
        </defs>
        <rect width="320" height="180" fill="#020617" />
        <rect width="320" height="180" fill="url(#es-n)" />
        {Array.from({ length: 40 }, (_, i) => (
          <circle key={i} cx={(i * 71) % 320} cy={(i * 43) % 180} r={i % 7 === 0 ? 1.6 : 0.8} fill="#fff" opacity={0.4 + (i % 5) / 10} />
        ))}
        <circle cx="214" cy="92" r="40" fill="url(#es-p)" />
        <ellipse cx="214" cy="92" rx="66" ry="12" fill="none" stroke="#fde68a" strokeWidth="3" opacity=".7" transform="rotate(-14 214 92)" />
        <circle cx="96" cy="58" r="8" fill="#94a3b8" />
      </>
    ),
  },
  {
    id: 'fantasia',
    name: 'Reino de Fantasia',
    vibe: 'RPG, castelos e aventura',
    art: (
      <>
        <defs>
          {sky('ft-s', [
            [0, '#0b1d3a'],
            [1, '#3b5b8c'],
          ])}
        </defs>
        <rect width="320" height="180" fill="url(#ft-s)" />
        <circle cx="236" cy="44" r="18" fill="#f1f5f9" />
        <circle cx="244" cy="40" r="16" fill="#163056" />
        <path d="M0 150 L60 80 L110 136 L160 70 L220 140 L270 92 L320 150 V180 H0 Z" fill="#1e3a5f" />
        <g fill="#0b1626">
          <rect x="132" y="96" width="56" height="56" />
          <rect x="122" y="84" width="14" height="68" />
          <rect x="184" y="84" width="14" height="68" />
          <rect x="152" y="70" width="16" height="40" />
          <path d="M122 84 l7 -12 l7 12 Z M184 84 l7 -12 l7 12 Z M152 70 l8 -16 l8 16 Z" />
        </g>
        <rect x="155" y="128" width="10" height="24" rx="5" fill="#fbbf24" opacity=".8" />
        <path d="M0 166 H320 V180 H0 Z" fill="#081120" />
      </>
    ),
  },
  {
    id: 'cyberpunk',
    name: 'Chuva Cyberpunk',
    vibe: 'Futuro, neon e chuva',
    art: (
      <>
        <rect width="320" height="180" fill="#0a0614" />
        {[
          [10, 40, 50],
          [66, 20, 70],
          [140, 52, 44],
          [194, 10, 60],
          [262, 34, 58],
        ].map(([x, y, w]) => (
          <g key={x}>
            <rect x={x} y={y} width={w} height={180 - y} fill="#140c26" />
            {Array.from({ length: 6 }, (_, j) => (
              <rect key={j} x={x + 6 + (j % 3) * (w / 3.2)} y={y + 12 + Math.floor(j / 3) * 22} width="6" height="3" fill={j % 2 ? '#22d3ee' : '#f0abfc'} opacity=".8" />
            ))}
          </g>
        ))}
        <rect x="84" y="58" width="34" height="12" rx="2" fill="none" stroke="#f472b6" strokeWidth="2" />
        <rect x="208" y="40" width="30" height="10" rx="2" fill="none" stroke="#22d3ee" strokeWidth="2" />
        {Array.from({ length: 50 }, (_, i) => (
          <path key={i} d={`M${(i * 37) % 320} ${(i * 29) % 180} l-4 12`} stroke="#93c5fd" strokeOpacity=".35" />
        ))}
        <rect y="160" width="320" height="20" fill="#f472b6" opacity=".12" />
      </>
    ),
  },
  {
    id: 'neblina',
    name: 'Neblina',
    vibe: 'Terror e sobrevivência',
    art: (
      <>
        <defs>
          {sky('nb-s', [
            [0, '#0b0f0e'],
            [1, '#1f2a27'],
          ])}
          <linearGradient id="nb-f" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#9ca3af" stopOpacity="0" />
            <stop offset="1" stopColor="#9ca3af" stopOpacity=".45" />
          </linearGradient>
        </defs>
        <rect width="320" height="180" fill="url(#nb-s)" />
        <circle cx="64" cy="40" r="14" fill="#e5e7eb" opacity=".25" />
        {[20, 70, 120, 200, 250, 300].map((x, i) => (
          <g key={x} fill="#05080a">
            <rect x={x - 3} y={60 + (i % 3) * 8} width="6" height="120" />
            <path d={`M${x} ${60 + (i % 3) * 8} l-18 28 M${x} ${74 + (i % 3) * 8} l16 -20 M${x} ${92 + (i % 3) * 8} l-14 -12`} stroke="#05080a" strokeWidth="3" />
          </g>
        ))}
        <rect y="90" width="320" height="90" fill="url(#nb-f)" />
        <circle cx="160" cy="118" r="2" fill="#ef4444" />
        <circle cx="168" cy="118" r="2" fill="#ef4444" />
      </>
    ),
  },
  {
    id: 'faroeste',
    name: 'Faroeste',
    vibe: 'Velho oeste e cavalgadas',
    art: (
      <>
        <defs>
          {sky('fw-s', [
            [0, '#7c2d12'],
            [0.6, '#ea580c'],
            [1, '#fcd34d'],
          ])}
        </defs>
        <rect width="320" height="180" fill="url(#fw-s)" />
        <circle cx="160" cy="118" r="34" fill="#fef3c7" opacity=".85" />
        <path d="M0 126 H40 V104 H86 V126 H230 V96 H280 V126 H320 V180 H0 Z" fill="#7c2d12" />
        <path d="M0 150 H320 V180 H0 Z" fill="#451a03" />
        <g fill="#1c0a02">
          <rect x="54" y="122" width="8" height="30" rx="4" />
          <rect x="44" y="130" width="6" height="12" rx="3" />
          <rect x="66" y="126" width="6" height="14" rx="3" />
          <rect x="262" y="128" width="7" height="24" rx="3.5" />
          <rect x="254" y="134" width="5" height="10" rx="2.5" />
        </g>
      </>
    ),
  },
  {
    id: 'fliperama',
    name: 'Fliperama',
    vibe: 'Retrô, arcade e pixel art',
    art: (
      <>
        <defs>
          {sky('fp-s', [
            [0, '#0f0326'],
            [1, '#3b0764'],
          ])}
        </defs>
        <rect width="320" height="180" fill="url(#fp-s)" />
        <g stroke="#e879f9" strokeOpacity=".6">
          {Array.from({ length: 9 }, (_, i) => (
            <path key={i} d={`M160 96 L${-80 + i * 60} 180`} />
          ))}
          {[104, 116, 132, 154].map((y) => (
            <path key={y} d={`M0 ${y} H320`} />
          ))}
        </g>
        <path d="M0 96 H320" stroke="#22d3ee" strokeWidth="2" />
        {[
          [60, 34],
          [250, 50],
          [140, 22],
          [200, 30],
        ].map(([x, y], i) => (
          <g key={i} fill={i % 2 ? '#fde047' : '#22d3ee'}>
            <rect x={x} y={y} width="4" height="4" />
            <rect x={x - 4} y={y + 4} width="12" height="4" />
            <rect x={x} y={y + 8} width="4" height="4" />
          </g>
        ))}
        <g fill="#f472b6" transform="translate(146 52)">
          <rect x="4" width="20" height="4" />
          <rect y="4" width="28" height="12" />
          <rect x="4" y="16" width="4" height="4" />
          <rect x="20" y="16" width="4" height="4" />
          <rect x="6" y="8" width="4" height="4" fill="#0f0326" />
          <rect x="18" y="8" width="4" height="4" fill="#0f0326" />
        </g>
      </>
    ),
  },
];

export const findCallBanner = (id: string) => CALL_BANNERS.find((b) => b.id === id);

/**
 * Fundo do quadro de uma pessoa na call: tema pronto (SVG que cobre o quadro) ou imagem enviada
 * (cobre o quadro, com a posição vertical escolhida). Uma película escura por cima mantém nome e foto legíveis.
 */
export function CallBannerBackground({ banner, pos = 50 }: { banner: string | null | undefined; pos?: number }) {
  if (!banner) return null;
  if (banner.startsWith('preset:')) {
    const theme = findCallBanner(banner.slice(7));
    if (!theme) return null;
    return (
      <div className="call-banner" aria-hidden>
        <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">
          {theme.art}
        </svg>
      </div>
    );
  }
  if (banner.startsWith('image:')) {
    return (
      <div className="call-banner" aria-hidden>
        <img src={`/api/images/${banner.slice(6)}`} alt="" loading="lazy" draggable={false} style={{ objectPosition: `50% ${pos}%` }} />
      </div>
    );
  }
  return null;
}
