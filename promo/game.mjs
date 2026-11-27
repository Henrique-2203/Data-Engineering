// "Jogo" original usado nos vídeos (corrida retrô em neon): nada de gameplay de terceiros.
// drawGame(canvas, t, { boost }) desenha um quadro no tempo t (segundos).
export function drawGame(canvas, t, opts = {}) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, hz = H * 0.55, cx = W / 2;
  const boost = opts.boost ?? 0; // 0..1: turbo (mais rápido, mais brilho)
  const sky = g.createLinearGradient(0, 0, 0, hz);
  sky.addColorStop(0, '#120428');
  sky.addColorStop(0.6, '#5b0f6b');
  sky.addColorStop(1, '#ff4f8b');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, hz);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(255,255,255,${0.3 + (0.7 * ((i * 37) % 10)) / 10})`;
    g.fillRect((i * 151 + t * 6 * (i % 3)) % W, (i * 89) % (hz * 0.7), 2, 2);
  }
  // sol
  const r = H * 0.27, cy = hz - r * 0.35;
  const sun = g.createLinearGradient(0, cy - r, 0, cy + r);
  sun.addColorStop(0, '#ffe66d');
  sun.addColorStop(1, '#ff3d7f');
  g.save();
  g.beginPath();
  g.arc(cx, cy, r * (1 + boost * 0.04), 0, Math.PI * 2);
  g.clip();
  g.fillStyle = sun;
  g.fillRect(cx - r * 1.1, cy - r * 1.1, 2.2 * r, 2.2 * r);
  g.fillStyle = '#5b0f6b';
  for (let i = 0; i < 7; i++) g.fillRect(cx - r * 1.1, cy + i * r * 0.16, 2.2 * r, 3 + i * 2.2);
  g.restore();
  // montanhas
  g.fillStyle = '#1b0a33';
  g.beginPath();
  g.moveTo(0, hz);
  for (let x = 0; x <= W; x += W / 14) g.lineTo(x, hz - (Math.sin(x * 0.011 + 1) * 0.5 + 0.6) * H * 0.12 * (x % 3 ? 1 : 0.6));
  g.lineTo(W, hz);
  g.fill();
  // pista com grade
  const fl = g.createLinearGradient(0, hz, 0, H);
  fl.addColorStop(0, '#16052b');
  fl.addColorStop(1, '#05010c');
  g.fillStyle = fl;
  g.fillRect(0, hz, W, H - hz);
  g.strokeStyle = boost > 0.3 ? '#7df9ff' : '#ff3df2';
  g.lineWidth = 2;
  g.shadowColor = g.strokeStyle;
  g.shadowBlur = 8 + boost * 14;
  for (let i = -16; i <= 16; i++) {
    g.beginPath();
    g.moveTo(cx + i * 10, hz);
    g.lineTo(cx + i * W * 0.14, H);
    g.stroke();
  }
  const speed = (t * (1.6 + boost * 2.4)) % 1;
  for (let i = 0; i < 14; i++) {
    const k = (i + speed) / 14;
    const y = hz + (H - hz) * k * k;
    g.globalAlpha = k;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  g.globalAlpha = 1;
  g.shadowBlur = 0;
  // carros adversários (vêm do horizonte)
  for (let n = 0; n < 3; n++) {
    const k = ((t * 0.45 + n * 0.37) % 1) ** 2;
    const lane = [-0.25, 0.22, 0.05][n];
    const y = hz + (H - hz) * k;
    const s = 0.15 + k * 0.9;
    const x = cx + lane * W * k * 1.2;
    g.fillStyle = ['#ffb800', '#7cff6b', '#b388ff'][n];
    g.globalAlpha = Math.min(1, k * 3);
    g.fillRect(x - 40 * s, y - 18 * s, 80 * s, 26 * s);
    g.fillStyle = '#ff2e63';
    g.fillRect(x - 36 * s, y + 2 * s, 14 * s, 6 * s);
    g.fillRect(x + 22 * s, y + 2 * s, 14 * s, 6 * s);
  }
  g.globalAlpha = 1;
  // linhas de velocidade no turbo
  if (boost > 0.05) {
    g.strokeStyle = `rgba(125,249,255,${boost * 0.6})`;
    g.lineWidth = 3;
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + i;
      const d0 = ((t * 3 + i * 0.13) % 1) * W * 0.6 + W * 0.15;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * d0, H * 0.62 + Math.sin(a) * d0 * 0.5);
      g.lineTo(cx + Math.cos(a) * (d0 + 80), H * 0.62 + Math.sin(a) * (d0 + 80) * 0.5);
      g.stroke();
    }
  }
  // nosso carro
  const carX = cx + Math.sin(t * 2.2) * W * 0.12, carY = H * 0.82;
  g.fillStyle = '#00e5ff';
  g.shadowColor = '#00e5ff';
  g.shadowBlur = 18 + boost * 30;
  g.beginPath();
  g.moveTo(carX - 70, carY + 30);
  g.lineTo(carX - 55, carY - 5);
  g.lineTo(carX - 25, carY - 25);
  g.lineTo(carX + 25, carY - 25);
  g.lineTo(carX + 55, carY - 5);
  g.lineTo(carX + 70, carY + 30);
  g.closePath();
  g.fill();
  g.fillStyle = '#ff2e63';
  g.fillRect(carX - 62, carY + 8, 22, 9);
  g.fillRect(carX + 40, carY + 8, 22, 9);
  if (boost > 0.05) {
    g.fillStyle = `rgba(255,190,60,${boost})`;
    g.beginPath();
    g.moveTo(carX - 30, carY + 30);
    g.lineTo(carX, carY + 30 + 60 * boost + Math.sin(t * 60) * 8);
    g.lineTo(carX + 30, carY + 30);
    g.fill();
  }
  g.shadowBlur = 0;
  // placar
  g.font = `900 ${H * 0.06}px Inter`;
  g.fillStyle = '#fff';
  g.textAlign = 'left';
  g.fillText(String(Math.floor(t * 4321) % 1000000).padStart(6, '0'), W * 0.04, H * 0.1);
  g.textAlign = 'right';
  g.fillText(`${Math.floor(220 + Math.sin(t * 3) * 25 + boost * 90)} km/h`, W * 0.96, H * 0.1);
  g.textAlign = 'center';
  g.font = `900 ${H * 0.045}px Inter`;
  g.fillText('VOLTA 3/3 · 1º LUGAR', cx, H * 0.1);
  if (boost > 0.3) {
    g.font = `900 ${H * 0.12}px Inter`;
    g.fillStyle = `rgba(125,249,255,${boost})`;
    g.fillText('TURBO!', cx, H * 0.36);
  }
}
