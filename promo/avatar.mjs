// Avatar do criador (anônimo): capuz com o rosto na sombra, olhos verdes do logo do Resenha,
// headset e uma "boca de luz" que abre com a voz. Tudo em SVG, desenhado por código.
// avatarSvg({ mouth: 0..1, blink: 0..1, look: -1..1, glow: 0..1, tilt: graus })
export function avatarSvg({ mouth = 0, blink = 0, look = 0, glow = 0.6, tilt = 0, bob = 0 } = {}) {
  const eyeH = 34 * (1 - blink) + 3;
  const ex = look * 10;
  const mw = 70 + mouth * 40;
  const mh = 6 + mouth * 38;
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 700" width="600" height="700">
  <defs>
    <radialGradient id="face" cx="50%" cy="46%" r="55%">
      <stop offset="0" stop-color="#0a0c10"/>
      <stop offset="1" stop-color="#020304"/>
    </radialGradient>
    <linearGradient id="hood" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a2f3a"/>
      <stop offset="1" stop-color="#14171d"/>
    </linearGradient>
    <linearGradient id="hoodEdge" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3ddc97" stop-opacity=".55"/>
      <stop offset=".5" stop-color="#3ddc97" stop-opacity="0"/>
      <stop offset="1" stop-color="#7c3aed" stop-opacity=".45"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="${8 + glow * 10}" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="soft"><feGaussianBlur stdDeviation="2"/></filter>
  </defs>
  <g transform="translate(0 ${bob}) rotate(${tilt} 300 420)">
    <!-- ombros / moletom -->
    <path d="M60 700 C70 560 170 500 300 500 C430 500 530 560 540 700 Z" fill="url(#hood)"/>
    <path d="M230 520 L300 600 L370 520" fill="none" stroke="#0e1015" stroke-width="10" stroke-linecap="round"/>
    <circle cx="262" cy="575" r="6" fill="#3ddc97"/>
    <circle cx="338" cy="575" r="6" fill="#3ddc97"/>
    <path d="M262 581 C258 620 266 640 260 660" stroke="#c4c8d2" stroke-width="4" fill="none"/>
    <path d="M338 581 C342 620 334 640 340 660" stroke="#c4c8d2" stroke-width="4" fill="none"/>
    <!-- capuz -->
    <path d="M300 70 C150 70 95 200 100 330 C104 430 150 510 205 545 L395 545 C450 510 496 430 500 330 C505 200 450 70 300 70 Z" fill="url(#hood)"/>
    <path d="M300 70 C150 70 95 200 100 330 C104 430 150 510 205 545 L395 545 C450 510 496 430 500 330 C505 200 450 70 300 70 Z" fill="none" stroke="url(#hoodEdge)" stroke-width="5"/>
    <!-- arco do headset (por baixo do capuz: só as pontas aparecem) -->
    <path d="M130 300 C130 150 470 150 470 300" fill="none" stroke="#0d0f14" stroke-width="22" stroke-linecap="round"/>
    <path d="M130 300 C130 150 470 150 470 300" fill="none" stroke="#3a404d" stroke-width="10" stroke-linecap="round"/>
    <!-- abertura do capuz (rosto na sombra) -->
    <path d="M300 140 C200 140 160 230 165 320 C170 410 220 480 300 485 C380 480 430 410 435 320 C440 230 400 140 300 140 Z" fill="url(#face)"/>
    <path d="M300 140 C200 140 160 230 165 320 C170 410 220 480 300 485 C380 480 430 410 435 320 C440 230 400 140 300 140 Z" fill="none" stroke="#000" stroke-width="10" opacity=".6"/>
    <!-- olhos (como os do logo) -->
    <g filter="url(#glow)">
      <ellipse cx="${248 + ex}" cy="300" rx="22" ry="${eyeH / 2}" fill="#3ddc97"/>
      <ellipse cx="${352 + ex}" cy="300" rx="22" ry="${eyeH / 2}" fill="#3ddc97"/>
    </g>
    <!-- boca de luz (abre com a voz) -->
    <g filter="url(#glow)" opacity="${0.55 + mouth * 0.45}">
      <rect x="${300 - mw / 2}" y="${398 - mh / 2}" width="${mw}" height="${mh}" rx="${Math.min(mh, mw) / 2}" fill="#3ddc97"/>
    </g>
    <!-- headset -->
    <rect x="92" y="270" width="64" height="110" rx="26" fill="#1b1e26" stroke="#3a404d" stroke-width="4"/>
    <rect x="444" y="270" width="64" height="110" rx="26" fill="#1b1e26" stroke="#3a404d" stroke-width="4"/>
    <rect x="104" y="300" width="10" height="50" rx="5" fill="#3ddc97" opacity="${0.5 + glow * 0.5}"/>
    <rect x="486" y="300" width="10" height="50" rx="5" fill="#3ddc97" opacity="${0.5 + glow * 0.5}"/>
    <path d="M150 360 C175 440 215 455 255 455" fill="none" stroke="#3a404d" stroke-width="8" stroke-linecap="round"/>
    <circle cx="258" cy="455" r="12" fill="#1b1e26" stroke="#3ddc97" stroke-width="3"/>
  </g>
</svg>`;
}

/** O AMIGO: boné roxo virado, fone, camiseta laranja e rosto de "tela" com olhos e boca laranja. */
export function friendSvg({ mouth = 0, blink = 0, look = 0, glow = 0.6, tilt = 0, bob = 0 } = {}) {
  const eyeH = 30 * (1 - blink) + 3;
  const ex = look * 10;
  const mw = 64 + mouth * 40;
  const mh = 6 + mouth * 36;
  const C = '#ff8a3d';
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 700" width="600" height="700">
  <defs>
    <radialGradient id="fface" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#14101c"/><stop offset="1" stop-color="#07050b"/></radialGradient>
    <linearGradient id="fshirt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8a3d"/><stop offset="1" stop-color="#c2410c"/></linearGradient>
    <linearGradient id="fcap" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#5b21b6"/></linearGradient>
    <filter id="fglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${8 + glow * 10}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <g transform="translate(0 ${bob}) rotate(${tilt} 300 420)">
    <!-- camiseta -->
    <path d="M70 700 C80 570 175 515 300 515 C425 515 520 570 530 700 Z" fill="url(#fshirt)"/>
    <path d="M245 520 C255 560 345 560 355 520" fill="none" stroke="#7c2d12" stroke-width="10" stroke-linecap="round"/>
    <circle cx="300" cy="620" r="34" fill="#111318"/>
    <path d="M286 610a12 12 0 0 1 12-12h4a12 12 0 0 1 12 12v8a12 12 0 0 1-12 12h-6l-8 7v-7a12 12 0 0 1-2-1z" fill="#3ddc97"/>
    <!-- pescoço e cabeça -->
    <rect x="262" y="470" width="76" height="60" rx="20" fill="#1a1622"/>
    <ellipse cx="300" cy="330" rx="150" ry="165" fill="#1a1622"/>
    <ellipse cx="300" cy="340" rx="122" ry="132" fill="url(#fface)" stroke="#000" stroke-width="6" opacity=".95"/>
    <!-- olhos e boca (laranja) -->
    <g filter="url(#fglow)">
      <ellipse cx="${252 + ex}" cy="320" rx="20" ry="${eyeH / 2}" fill="${C}"/>
      <ellipse cx="${348 + ex}" cy="320" rx="20" ry="${eyeH / 2}" fill="${C}"/>
    </g>
    <g filter="url(#fglow)" opacity="${0.55 + mouth * 0.45}">
      <rect x="${300 - mw / 2}" y="${408 - mh / 2}" width="${mw}" height="${mh}" rx="${Math.min(mh, mw) / 2}" fill="${C}"/>
    </g>
    <!-- boné virado para trás -->
    <path d="M150 300 C150 160 450 160 450 300 C410 255 190 255 150 300 Z" fill="url(#fcap)"/>
    <path d="M150 300 C190 255 410 255 450 300" fill="none" stroke="#4c1d95" stroke-width="8"/>
    <path d="M405 250 C470 240 520 262 540 290 C500 296 455 290 425 280 Z" fill="#6d28d9"/>
    <circle cx="300" cy="182" r="10" fill="#4c1d95"/>
    <rect x="270" y="208" width="60" height="22" rx="8" fill="${C}" opacity=".9"/>
    <!-- fone de ouvido -->
    <rect x="128" y="300" width="52" height="96" rx="22" fill="#1b1e26" stroke="#3a404d" stroke-width="4"/>
    <rect x="420" y="300" width="52" height="96" rx="22" fill="#1b1e26" stroke="#3a404d" stroke-width="4"/>
    <rect x="140" y="325" width="9" height="44" rx="4.5" fill="${C}" opacity="${0.5 + glow * 0.5}"/>
    <rect x="451" y="325" width="9" height="44" rx="4.5" fill="${C}" opacity="${0.5 + glow * 0.5}"/>
  </g>
</svg>`;
}
