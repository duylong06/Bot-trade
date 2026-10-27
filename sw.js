// sw.js — nhận thông báo đẩy từ bot và mở đúng biểu đồ khi bấm vào.
// Không cache gì: app luôn tải bản mới nhất.
//
// Bot gửi thông báo dạng "Declarative Web Push" ({ web_push: 8030, notification: {...} }):
//   - iPhone iOS 18.4+: hệ điều hành TỰ hiện thông báo, không gọi tới file này → không bao giờ bị
//     iOS coi là "push im lặng" rồi tự huỷ đăng ký (nguyên nhân hay gặp khiến thông báo mất sau vài giờ).
//   - iOS cũ hơn, Android, máy tính: sự kiện "push" chạy ở đây → LUÔN hiện thông báo, kể cả khi nội dung lỗi.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

function parse(e) {
  let d = null;
  try { d = e.data ? e.data.json() : null; } catch {}
  if (!d) {
    let text = '';
    try { text = e.data ? e.data.text() : ''; } catch {}
    return { title: 'Bot Trade', body: text || 'Có tín hiệu mới — mở app để xem.', url: './#tab=signals' };
  }
  const n = d.notification;
  if (n && typeof n === 'object') {        // dạng declarative
    return { title: n.title || 'Bot Trade', body: n.body || '', url: n.navigate || './', tag: n.tag, ts: n.timestamp };
  }
  return { title: d.title || 'Bot Trade', body: d.body || '', url: d.url || './', tag: d.tag, ts: d.ts };
}

self.addEventListener('push', e => {
  const d = parse(e);
  const opts = {
    body: d.body,
    data: { url: d.url },
    icon: 'app/icons/icon-192.png',
    badge: 'app/icons/icon-192.png',
    timestamp: d.ts || Date.now(),
  };
  if (d.tag) opts.tag = d.tag;
  e.waitUntil(self.registration.showNotification(d.title, opts)
    .catch(() => self.registration.showNotification('Bot Trade', { body: d.body || 'Có tín hiệu mới.' })));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const raw = (e.notification.data && e.notification.data.url) || e.notification.navigate || './';
  const url = new URL(raw, self.registration.scope).href;
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
