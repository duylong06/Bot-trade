// bot/push.mjs — gửi thông báo Web Push về iPhone.
// Khoá nằm trong GitHub Secret PUSH_CONFIG, không bao giờ nằm trong code.

import crypto from 'node:crypto';
import webpush from 'web-push';

const PAGES = 'https://duylong06.github.io/Bot-trade/';
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

export function parseSecret(raw) {
  if (!raw || !raw.trim()) return [];
  let items = [];
  try { const j = JSON.parse(raw); items = Array.isArray(j) ? j : [j]; }
  catch { items = (raw.match(/\{[^\n]*\}/g) || []).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean); }
  return items.filter(x => x && x.sub && x.sub.endpoint && x.vapid && x.vapid.pub && x.vapid.priv)
    .map(x => ({ ...x, id: sha(x.sub.endpoint), src: 'secret' }));
}

/** Máy nhận: lấy từ Secret, cộng thêm máy app đã đăng ký (bot Kèo Pro giữ trong state-keo.json). */
export function devices(secret, keoState) {
  const keys = new Map(secret.map(d => [d.vapid.pub, d.vapid]));
  const dead = (keoState && keoState.dead) || {};
  const out = new Map(secret.filter(d => !dead[d.id]).map(d => [d.id, d]));
  for (const [id, s] of Object.entries((keoState && keoState.subs) || {})) {
    const v = keys.get(s.pub);
    if (v && !out.has(id) && !dead[id]) out.set(id, { id, name: s.name, sub: s.sub, vapid: v, src: 'app' });
  }
  return [...out.values()];
}

export async function send(list, title, body, tag, dry, log = console.log) {
  if (dry) { log(`\n[KHÔNG GỬI] ${title}\n${body}\n`); return 0; }
  if (!list.length) { log('  chưa có máy nào đăng ký nhận thông báo'); return 0; }
  const payload = JSON.stringify({ web_push: 8030, notification: { title, body, navigate: PAGES, tag, lang: 'vi', silent: false } });
  let ok = 0;
  for (const d of list) {
    try {
      await webpush.sendNotification(d.sub, payload, {
        TTL: 3600, urgency: 'high',
        vapidDetails: { subject: PAGES, publicKey: d.vapid.pub, privateKey: d.vapid.priv },
      });
      ok++;
    } catch (e) {
      log(`  gửi lỗi ${e.statusCode || 0}`, String(e.body || e.message).slice(0, 120));
    }
  }
  log(`  → gửi ${ok}/${list.length} máy`);
  return ok;
}
