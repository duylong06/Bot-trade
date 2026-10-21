// sw.js — nhận thông báo đẩy từ bot và mở đúng biểu đồ khi bấm vào.
// Không cache gì: app luôn tải bản mới nhất.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Bot Trade', body: e.data ? e.data.text() : '' }; }
  const opts = {
    body: d.body || '',
    tag: d.tag || undefined,
    data: { url: d.url || './' },
    icon: 'app/icons/icon-192.png',
    badge: 'app/icons/icon-192.png',
    timestamp: d.ts || Date.now(),
  };
  e.waitUntil(self.registration.showNotification(d.title || 'Bot Trade', opts));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) {
        await w.focus();
        w.postMessage({ type: 'open', url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
