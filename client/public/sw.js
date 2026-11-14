// Service worker do Resenha: só cuida das notificações no celular / com o site fechado (web push).
// Não guarda cache de nada: o site continua sempre na versão mais nova.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Resenha', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    (async () => {
      // se o Resenha está aberto e visível nesta conversa, não precisa avisar
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const visible = windows.some((w) => w.visibilityState === 'visible' && w.focused);
      if (visible && data.kind !== 'test') return;
      await self.registration.showNotification(data.title || 'Resenha', {
        body: data.body || '',
        icon: '/icon.svg',
        badge: '/icon.svg',
        tag: data.tag || data.channelId || 'resenha',
        renotify: true,
        data: { channelId: data.channelId || null, guildId: data.guildId || null },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { channelId } = event.notification.data || {};
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const win = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (win) {
        await win.focus();
        if (channelId) win.postMessage({ type: 'resenha:open-channel', channelId });
        return;
      }
      await self.clients.openWindow(channelId ? `/app?canal=${encodeURIComponent(channelId)}` : '/app');
    })(),
  );
});
