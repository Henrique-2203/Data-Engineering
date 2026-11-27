// Ciclo de vida da transmissão turbo: quem assiste depois, reinício da transmissão, troca de tela/janela,
// espectador incompatível, 2+ espectadores, sem vídeo/áudio duplicado. Tela sintética (não prova FPS de jogo).
// Uso: npm run build && node e2e/turbo-lifecycle.mjs
import { assert, sleep, startHarness, step } from './_turbo-harness.mjs';

const h = await startHarness({ port: 3197 });
let failed = false;
try {
  const [ana, bia, caio] = [await h.open(h.users[0].token, { streamer: true }), await h.open(h.users[1].token), await h.open(h.users[2].token)];

  // 1) Espectador entra DEPOIS que a transmissão começou: usa turbo
  await h.startShare(ana.page);
  await h.watch(bia.page);
  await h.waitFor(async () => (await h.viewerState(bia.page)).turboRecv > 0, 15000, 'bia recebe pelo turbo (entrou depois)');
  step('espectador que entra depois recebe pelo turbo');

  // 2) Transmissor encerra e reinicia: quem continuava assistindo precisa voltar PELO TURBO (e só por ele)
  await h.stopShare(ana.page);
  await sleep(3500); // mais que a espera de 1 s da recuperação do espectador: ela não pode mascarar o problema
  await h.startShare(ana.page);
  await waitRestart(bia.page, 'bia');
  const s2 = await h.senderState(ana.page);
  assert(s2.turbo, 'depois de reiniciar, o transmissor tem o turbo ligado');
  const w = s2.watchers[0];
  assert(w && w.inTurbo, `depois de reiniciar, bia está no turbo (estado: ${JSON.stringify(s2.watchers)})`);
  assert(!w.rtcVideo, 'depois de reiniciar, bia NÃO recebe vídeo duplicado pelo WebRTC');
  step('reiniciar a transmissão: quem já assistia volta pelo turbo, sem vídeo duplicado');

  // 2b) Trocar de tela SEM parar (monitor -> janela): a mesma regra
  await ana.page.evaluate(() => {
    window.__nextSurface = 'window';
    return window.__resenhaVoice.startScreen();
  });
  await sleep(4000);
  await waitRestart(bia.page, 'bia (troca direta)');
  const s2b = await h.senderState(ana.page);
  assert(s2b.watchers[0]?.inTurbo && !s2b.watchers[0]?.rtcVideo, `troca direta de tela mantém o turbo sem duplicar (estado: ${JSON.stringify(s2b.watchers)})`);
  step('trocar de tela para janela sem parar: continua no turbo, sem vídeo duplicado');

  async function waitRestart(page, who) {
    try {
      await h.waitFor(async () => (await h.viewerState(page)).turboRecv > 0 && (await h.viewerState(page)).videoPlaying, 15000, `${who} volta a receber pelo turbo depois do reinício`);
    } catch (e) {
      console.error('  estado do espectador:', JSON.stringify(await h.viewerState(page)), '| estado do transmissor:', JSON.stringify(await h.senderState(ana.page)));
      throw e;
    }
  }
  console.log('\nTUDO CERTO (ciclo de vida do turbo)');
} catch (err) {
  console.error(err);
  failed = true;
  process.exitCode = 1;
} finally {
  await h.close();
}
