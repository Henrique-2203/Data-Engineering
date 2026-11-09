import { createRequire } from 'node:module';
import { avatarSvg, friendSvg } from './avatar.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const html = `<body style="margin:0;background:radial-gradient(circle at 50% 30%,#2a1a3a,#07080b 70%);display:flex;gap:10px;padding:20px;width:1900px">
<div style="width:600px">${avatarSvg({ mouth: 0.2, glow: 0.6 })}</div><div style="width:600px">${friendSvg({ mouth: 0, glow: 0.5 })}</div><div style="width:600px">${friendSvg({ mouth: 0.8, glow: 0.9, tilt: -3, look: 0.5 })}</div></body>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1900, height: 740 } });
await p.setContent(html);
await p.screenshot({ path: 'promo/out/conversa/personagens.png' });
await b.close();
