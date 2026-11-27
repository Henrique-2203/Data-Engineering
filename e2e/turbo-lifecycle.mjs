// Ciclo de vida da transmissão turbo: quem assiste depois, reinício da transmissão, troca de tela/janela,
// queda inesperada x encerramento voluntário, espectador incompatível, 2+ espectadores, audiência,
// qualidade individual, sem vídeo/áudio duplicado e sem vazamento de recursos.
// A "tela" é uma animação num canvas: prova o encanamento, NÃO prova FPS de jogo real.
// Uso: npm run build && node e2e/turbo-lifecycle.mjs
import { assert, sleep, startHarness, step } from './_turbo-harness.mjs';

const h = await startHarness({ port: 3197 });
try {
  const [anaU, biaU, caioU, dudaU] = h.users;
  const ana = await h.open(anaU.token, { streamer: true });
  const bia = await h.open(biaU.token);
  const caio = await h.open(caioU.token);
  await ana.page.evaluate(() => (window.__withAudio = true));

  const viewerTurbo = async (who) => (await h.viewerState(who.page)).turboRecv > 0 && (await h.viewerState(who.page)).videoPlaying;
  const waitTurbo = (who, label, ms = 15000) => h.waitFor(() => viewerTurbo(who), ms, `${label} recebe pelo turbo`);
  const watchers = () => h.senderState(ana.page);
  const events = (page) => page.evaluate(() => window.__resenhaVoice.transportEvents.map((e) => ({ ev: e.ev, d: e.detail ?? null })));
  const count = (list, ev, pred = () => true) => list.filter((e) => e.ev === ev && pred(e.d)).length;
  /** estado completo dos espectadores no transmissor (inclui áudio/vídeo anexados por pessoa) */
  const snap = () => ana.page.evaluate(() => window.__resenhaVoice.transportSnapshot());

  // ---- 1) espectador entra DEPOIS que a transmissão começou: usa turbo; 8) sem vídeo duplicado, áudio uma vez ----
  await h.startShare(ana.page);
  await h.watch(bia.page);
  await waitTurbo(bia, 'bia (entrou depois)');
  await sleep(1500);
  let sn = await snap();
  assert(sn.length === 1 && sn[0].mode === 'turbo' && sn[0].state === 'active' && sn[0].inTurbo && !sn[0].rtcVideo && sn[0].rtcAudio, `bia: turbo ativo, vídeo só pelo canal, áudio pelo WebRTC (${JSON.stringify(sn)})`);
  const videoEls = await bia.page.locator('.tile.screen video').count();
  assert(videoEls === 1, `um único <video> da tela na tela da bia (${videoEls})`);
  step('espectador que entra depois recebe pelo turbo, sem vídeo duplicado (som pelo WebRTC)');

  // ---- 7) dois espectadores: um só codificador, os dois no turbo ----
  await h.watch(caio.page);
  await waitTurbo(caio, 'caio');
  sn = await snap();
  assert(sn.length === 2 && sn.every((x) => x.mode === 'turbo' && x.state === 'active' && !x.rtcVideo && x.rtcAudio), `dois espectadores no turbo (${JSON.stringify(sn)})`);
  const enc = await ana.page.evaluate(() => ({ viewers: window.__resenhaVoice.turbo.viewers.size, hasEncoder: !!window.__resenhaVoice.turbo.encoder, layers: window.__resenhaVoice.turbo.layers.size }));
  assert(enc.viewers === 2 && enc.hasEncoder, `um codificador para os dois (${JSON.stringify(enc)})`);
  step('dois espectadores: os dois no turbo com um único codificador');

  // ---- qualidade individual: bia escolhe 480p e isso sobrevive ao reinício ----
  await bia.page.evaluate(() => {
    const sid = [...window.__resenhaVoice.turboRecv.keys()][0];
    window.__resenhaVoice.setStreamQuality(sid, '480');
  });
  await h.waitFor(async () => (await ana.page.evaluate(() => [...window.__resenhaVoice.turbo.viewers.values()].some((v) => v.want === '480'))), 8000, 'qualidade 480p chegou ao transmissor');

  // ---- 12) guarda referências para conferir vazamentos depois ----
  await ana.page.evaluate(() => {
    const t = window.__resenhaVoice.turbo;
    window.__oldTurbo = t;
    window.__oldDcs = [...t.viewers.values()].map((v) => v.dc);
  });

  // ---- 2) transmissor encerra e reinicia: quem continuava assistindo volta PELO TURBO ----
  await h.stopShare(ana.page);
  // 4) encerramento voluntário NÃO é queda: nada de recuperação nem de contagem
  await sleep(3500); // mais que a espera de 1 s da recuperação do espectador: ela não pode mascarar nada
  const stopped = await ana.page.evaluate(() => {
    const v = window.__resenhaVoice;
    const t = window.__oldTurbo;
    return { turbo: v.turbo, pending: v.turboPending.size, statsTimer: v.turboStatsTimer, perfTimer: v.perfTimer, oldStopped: t.stopped, oldViewers: t.viewers.size, oldEncoder: t.encoder, oldLayers: t.layers.size, oldKeyTimers: t.keyTimers.size, dcStates: window.__oldDcs.map((d) => d.readyState) };
  });
  assert(stopped.turbo === null && stopped.pending === 0 && stopped.statsTimer === null && stopped.perfTimer === null, `parar limpa turbo, negociações e cronômetros (${JSON.stringify(stopped)})`);
  assert(stopped.oldStopped && stopped.oldViewers === 0 && stopped.oldEncoder === null && stopped.oldLayers === 0 && stopped.oldKeyTimers === 0, `o codificador e as versões do turbo antigo foram fechados (${JSON.stringify(stopped)})`);
  assert(stopped.dcStates.every((s) => s === 'closed' || s === 'closing'), `os canais fecharam (${stopped.dcStates})`);
  for (const [name, who] of [['bia', bia], ['caio', caio]]) {
    const v = await who.page.evaluate(() => {
      const v = window.__resenhaVoice;
      return { recv: v.turboRecv.size, drops: v.turboDrops.size, timers: v.recoverTimers.size };
    });
    assert(v.recv === 0 && v.drops === 0 && v.timers === 0, `${name}: parada voluntária não conta como queda nem agenda recuperação (${JSON.stringify(v)})`);
    const ev = await events(who.page);
    assert(count(ev, 'recv-dc-closed-unexpected') === 0 && count(ev, 'recv-dc-closed-intentional') >= 1, `${name}: o fechamento foi classificado como intencional (${ev.map((e) => e.ev).join(',')})`);
  }
  await h.startShare(ana.page);
  await waitTurbo(bia, 'bia (depois do reinício)');
  await waitTurbo(caio, 'caio (depois do reinício)');
  await sleep(1500);
  sn = await snap();
  assert(sn.length === 2 && sn.every((x) => x.mode === 'turbo' && x.state === 'active' && x.inTurbo && !x.rtcVideo && x.rtcAudio), `depois de reiniciar os dois voltam pelo turbo, sem vídeo duplicado (${JSON.stringify(sn)})`);
  const want = await ana.page.evaluate(() => [...window.__resenhaVoice.turbo.viewers.values()].map((v) => v.want).sort().join(','));
  assert(want === '480,auto', `a qualidade individual da bia sobrevive ao reinício (${want})`);
  const drops1 = await bia.page.evaluate(() => window.__resenhaVoice.turboDrops.size);
  assert(drops1 === 0, `reiniciar não contou queda (${drops1})`);
  step('parar e reiniciar: encerramento voluntário não conta como queda; os dois voltam pelo turbo, qualidade individual preservada, recursos liberados');

  // ---- 3) alternância tela inteira <-> janela sem parar ----
  for (const surface of ['window', 'monitor']) {
    await ana.page.evaluate((sf) => {
      window.__nextSurface = sf;
      return window.__resenhaVoice.startScreen();
    }, surface);
    await sleep(3500);
    await waitTurbo(bia, `bia (${surface})`);
    await waitTurbo(caio, `caio (${surface})`);
    sn = await snap();
    assert(sn.length === 2 && sn.every((x) => x.mode === 'turbo' && x.state === 'active' && !x.rtcVideo), `${surface}: os dois seguem no turbo sem duplicar (${JSON.stringify(sn)})`);
    const src = await ana.page.evaluate(() => window.__resenhaVoice.captureSource);
    assert(src && src.kind === surface, `a origem da captura vira "${surface}" (${JSON.stringify(src)})`);
  }
  const orphan = await ana.page.evaluate(() => window.__resenhaVoice.turboPending.size);
  assert(orphan === 0, `sem negociações penduradas depois das trocas (${orphan})`);
  step('alternar tela inteira <-> janela sem parar: continua no turbo, origem da captura registrada, sem duplicar');

  // ---- 5) queda inesperada: recupera sozinho e conta como queda ----
  await bia.page.evaluate(() => [...window.__resenhaVoice.turboRecv.values()][0].dc.close());
  await h.waitFor(async () => (await bia.page.evaluate(() => window.__resenhaVoice.turboDrops.size)) === 1, 5000, 'queda inesperada contada uma vez');
  await waitTurbo(bia, 'bia (recuperada)', 20000);
  const evB = await events(bia.page);
  assert(count(evB, 'recv-dc-closed-unexpected') === 1 && count(evB, 'recv-transport', (d) => d.state === 'recovering') >= 1, `a queda foi classificada como inesperada e passou por "recuperando" (${evB.map((e) => e.ev).join(',')})`);
  await sleep(1500);
  sn = await snap();
  assert(sn.length === 2 && sn.every((x) => x.mode === 'turbo' && x.state === 'active' && !x.rtcVideo), `depois da recuperação, de volta ao turbo sem duplicar (${JSON.stringify(sn)})`);
  const evA = await events(ana.page);
  assert(count(evA, 'viewer-dc-closed-unexpected') >= 1, 'o transmissor também viu a queda como inesperada');
  step('queda inesperada: contada uma vez, passa por "recuperando" e volta ao turbo sozinha');

  // ---- 9) permissões de audiência ----
  await ana.page.evaluate((id) => window.__resenhaVoice.setScreenAudience({ mode: 'except', userIds: [id] }), biaU.user.id);
  await h.waitFor(async () => (await snap()).every((x) => x.id !== undefined) && (await snap()).length === 1, 6000, 'bia saiu da lista de quem assiste');
  assert((await snap())[0].mode === 'turbo', 'caio continua no turbo');
  await h.stopShare(ana.page);
  await sleep(1000);
  await h.startShare(ana.page);
  await waitTurbo(caio, 'caio (depois do reinício com audiência restrita)');
  sn = await snap();
  assert(sn.length === 1, `bia (fora da audiência) não é roteada de volta no reinício (${JSON.stringify(sn)})`);
  const biaVideo = await bia.page.evaluate(() => ({ turbo: window.__resenhaVoice.turboRecv.size }));
  assert(biaVideo.turbo === 0, 'bia não recebe vídeo turbo fora da audiência');
  await ana.page.evaluate(() => window.__resenhaVoice.setScreenAudience({ mode: 'all', userIds: [] }));
  step('audiência: quem saiu da lista deixa de receber na hora e não volta no reinício');

  // ---- 6) fallback para dispositivo incompatível / com turbo desligado ----
  const duda = await h.open(dudaU.token, { noTurboApis: true });
  await h.watch(duda.page);
  await h.waitFor(async () => (await snap()).some((x) => x.state === 'fallback'), 10000, 'duda (sem WebCodecs) em fallback');
  sn = await snap();
  const dsn = sn.find((x) => x.state === 'fallback');
  assert(dsn.mode === 'webrtc' && dsn.reason === 'viewer-unsupported' && !dsn.inTurbo && dsn.rtcVideo, `duda (incompatível): WebRTC com motivo "viewer-unsupported" (${JSON.stringify(dsn)})`);
  await h.waitFor(async () => (await h.viewerState(duda.page)).videoPlaying, 15000, 'duda vê o vídeo pelo WebRTC');
  assert((await h.viewerState(duda.page)).turboRecv === 0, 'duda não usa turbo');
  // os outros continuam no turbo
  assert(sn.filter((x) => x.mode === 'turbo' && x.state === 'active').length === 1, 'caio segue no turbo enquanto a duda usa o WebRTC');
  await duda.ctx.close();
  step('dispositivo incompatível: fallback para o WebRTC com motivo registrado; os outros seguem no turbo');

  // ---- quem assiste PARA de assistir: o transmissor vê saída avisada, não queda ----
  const before = (await events(ana.page)).length;
  await caio.page.evaluate(() => window.__resenhaVoice.watch([...window.__resenhaVoice.turboRecv.keys()][0], false));
  await h.waitFor(async () => (await snap()).length === 0, 6000, 'caio saiu da lista de quem assiste');
  const evS = (await events(ana.page)).slice(before);
  assert(count(evS, 'viewer-left') + count(evS, 'viewer-removed') >= 1 && count(evS, 'viewer-dc-closed-unexpected') === 0 && count(evS, 'transport', (d) => d.state === 'recovering') === 0, `parar de assistir é saída avisada, não queda nem "recuperando" (${evS.map((e) => e.ev).join(',')})`);
  step('espectador que para de assistir: o transmissor registra saída avisada (sem falsa queda)');

  // ---- 12) vazamentos ao sair da call ----
  await ana.page.evaluate(() => {
    window.__t2 = window.__resenhaVoice.turbo;
    window.__resenhaVoice.leave(true);
  });
  await sleep(1500);
  const left = await ana.page.evaluate(() => {
    const v = window.__resenhaVoice;
    return { turbo: v.turbo, pending: v.turboPending.size, transport: v.transport.size, caps: v.watchCaps.size, watchers: v.screenWatchers.size, enc: window.__t2.encoder, stopped: window.__t2.stopped };
  });
  assert(left.turbo === null && left.pending === 0 && left.transport === 0 && left.caps === 0 && left.watchers === 0 && left.enc === null && left.stopped, `sair da call limpa tudo (${JSON.stringify(left)})`);
  assert((await caio.page.evaluate(() => window.__resenhaVoice.turboRecv.size + window.__resenhaVoice.recoverTimers.size)) === 0, 'quem parou de assistir não ficou com receptor nem cronômetro');
  step('sair da call: codificador, canais, negociações, cronômetros e mapas liberados dos dois lados');

  console.log('\nTUDO CERTO (ciclo de vida do turbo)');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await h.close();
}
