// Prévia do avatar (3 poses lado a lado) em promo/out/avatar-preview.png
import { createRequire } from 'node:module';
import { avatarSvg } from './avatar.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const poses = [{ mouth: 0, glow: 0.5 }, { mouth: 0.8, glow: 0.9, tilt: -3, look: -0.4 }, { mouth: 0.35, blink: 0.9, tilt: 2, look: 0.5 }];
const html = `<body style="margin:0;background:radial-gradient(circle at 50% 30%,#163a2c,#07080b 70%);display:flex;gap:20px;padding:30px;width:1900px">${poses.map((p) => `<div style="width:600px">${avatarSvg(p)}</div>`).join('')}</body>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1940, height: 760 } });
await p.setContent(html);
await p.screenshot({ path: 'promo/out/avatar-preview.png' });
await b.close();
