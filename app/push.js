// app/push.js — thông báo đẩy trên iPhone (PWA, iOS 16.4+), tự giữ cho không bị tắt.
//
// Lần đầu: bấm "Bật thông báo" → app tạo khoá VAPID ngay trên máy và một đoạn mã; dán đoạn mã vào
// GitHub Secret PUSH_CONFIG (một lần duy nhất). Khoá đó là khoá của bot.
//
// Từ đó về sau KHÔNG phải dán mã nữa:
//   - Mỗi lần mở app, app kiểm tra đăng ký thông báo của máy. Mất (iOS huỷ, đổi máy, xoá app…) thì app tự
//     đăng ký lại bằng khoá công khai của bot, rồi gửi đăng ký mới cho bot qua kênh ntfy (core/config.js → NTFY).
//   - Bot nhận ở lần quét kế tiếp và gửi tiếp bằng khoá riêng trong GitHub Secret.
//   - Đăng ký được ký bằng khoá riêng trên máy (nếu còn) để bot ưu tiên giữ, không bị đăng ký lạ đẩy ra.
//   - iOS không cho tự đăng ký lại khi chưa chạm: app hiện thanh đỏ "Thông báo đang tắt — chạm để bật lại".
import { NTFY } from '../core/config.js';

const KEY = 'bt.vapid.v1';
const REG = 'bt.reg.v2';
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const lsGet = (k, d = null) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const permission = () => ('Notification' in window ? Notification.permission : 'unsupported');

let vapidPromise = null;
export function getVapid() {
  if (vapidPromise) return vapidPromise;
  vapidPromise = (async () => {
    const v = lsGet(KEY);
    if (v && v.pub && v.priv) return v;
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
    const priv = (await crypto.subtle.exportKey('jwk', kp.privateKey)).d;
    const nv = { pub, priv, created: Date.now() };
    lsSet(KEY, nv);
    return nv;
  })();
  return vapidPromise;
}

export async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('sw.js', { scope: './' }); } catch { return null; }
}

function sameKey(a, b) {
  if (!a) return false;
  const x = new Uint8Array(a);
  if (x.length !== b.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== b[i]) return false;
  return true;
}

function deviceName() {
  const m = /iPhone|iPad|Mac|Android/.exec(navigator.userAgent);
  return (m ? m[0] : 'Máy') + ' ' + new Date().toISOString().slice(0, 10);
}

export async function idOf(endpoint) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

async function getSub() {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error('service worker chưa sẵn sàng')), 8000))]);
  return { reg, sub: await reg.pushManager.getSubscription() };
}

// Khoá công khai dùng để đăng ký: khoá của bot (status.json) nếu bot đã có, không thì khoá trên máy.
async function wantKey(botPub) { return botPub || (await getVapid()).pub; }

async function subscribeWith(pub) {
  const { reg, sub: old } = await getSub();
  const key = unb64u(pub);
  if (old && sameKey(old.options && old.options.applicationServerKey, key)) return old;
  if (old) { try { await old.unsubscribe(); } catch {} }
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

// Ký endpoint bằng khoá riêng trên máy (khi khoá này chính là khoá của bot) — bot dùng để ưu tiên giữ.
async function signEndpoint(endpoint, pub) {
  try {
    const v = await getVapid();
    if (v.pub !== pub) return null;
    const raw = unb64u(v.pub);
    const jwk = { kty: 'EC', crv: 'P-256', x: b64u(raw.slice(1, 33)), y: b64u(raw.slice(33, 65)), d: v.priv, ext: true };
    const k = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    return b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, new TextEncoder().encode(endpoint)));
  } catch { return null; }
}

// Gửi đăng ký cho bot qua ntfy. Đăng ký thông báo không phải bí mật: không có khoá riêng thì không gửi được.
export async function sendToBot(sub, pub) {
  const j = sub.toJSON();
  const msg = { v: 2, sub: { endpoint: j.endpoint, keys: j.keys }, pub, name: deviceName() };
  const sig = await signEndpoint(j.endpoint, pub);
  if (sig) msg.sig = sig;
  const r = await fetch(NTFY, { method: 'POST', body: JSON.stringify(msg) });
  if (!r.ok) throw new Error('ntfy HTTP ' + r.status);
  const id = await idOf(j.endpoint);
  lsSet(REG, { id, pub, at: Date.now() });
  return id;
}

function makeConfig(sub, v) {
  const j = sub.toJSON();
  return JSON.stringify({ v: 1, name: deviceName(), sub: { endpoint: j.endpoint, keys: j.keys }, vapid: { pub: v.pub, priv: v.priv } });
}

/**
 * PHẢI gọi trực tiếp trong sự kiện chạm (iOS chỉ cho xin quyền / đăng ký khi người dùng chạm).
 * botPub: khoá công khai của bot (status.push.vapidPub) — null nếu bot chưa có khoá (chưa dán mã lần nào).
 * Trả về { id, config } — config (đoạn mã có khoá riêng) chỉ cần khi bot chưa có khoá.
 */
export async function enablePush(botPub) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied'
    ? 'Bạn đã chặn thông báo. Vào Cài đặt iPhone → Thông báo → Bot Trade để bật lại.'
    : 'Chưa cấp quyền thông báo.');
  const pub = await wantKey(botPub);
  const sub = await subscribeWith(pub);
  let id = await idOf(sub.endpoint), sent = false;
  if (botPub) { try { await sendToBot(sub, pub); sent = true; } catch {} }
  const v = await getVapid();
  return { id, sent, config: v.pub === pub ? makeConfig(sub, v) : null };
}

/**
 * Kiểm tra sức khoẻ thông báo của máy này, tự sửa được thì tự sửa (không cần chạm).
 * status: status.json của bot (có thể null khi chưa tải được).
 * Trả về { state, id, rec, msg } với state:
 *   not-installed · unsupported · blocked · off · need-code · pending · ok · error
 */
export async function check(status) {
  if (isIOS() && !isStandalone()) return { state: 'not-installed' };
  if (!pushSupported()) return { state: 'unsupported' };
  const perm = permission();
  if (perm === 'denied') return { state: 'blocked' };
  if (perm !== 'granted') return { state: 'off', why: 'chưa cấp quyền' };

  const botPub = status && status.push ? status.push.vapidPub || null : undefined;   // undefined = chưa biết
  let { sub } = await getSub();
  const pub = botPub === undefined ? null : await wantKey(botPub);
  let id = sub ? await idOf(sub.endpoint) : null;
  const rec = id && status && (status.devices || []).find(d => d.id === id);
  const dead = !!(id && status && status.push && (status.push.dead || []).includes(id)) || !!(rec && rec.gone);
  const wrongKey = sub && pub && !sameKey(sub.options && sub.options.applicationServerKey, unb64u(pub));

  // Mất đăng ký / khoá không khớp bot / bot báo đăng ký đã hết hạn → tự đăng ký lại (iOS có thể không cho).
  if (pub && (!sub || wrongKey || dead)) {
    try {
      if (sub && dead) { try { await sub.unsubscribe(); } catch {} }
      sub = await subscribeWith(pub);
      id = await idOf(sub.endpoint);
    } catch {
      return { state: 'off', why: sub ? 'đăng ký cũ đã hết hạn' : 'iPhone đã huỷ đăng ký' };
    }
  }
  if (!sub) return { state: 'off', why: 'chưa đăng ký' };
  if (botPub === undefined) return { state: 'pending', id };
  if (!botPub) return { state: 'need-code', id, config: makeConfig(sub, await getVapid()) };

  const known = (status.push.ids || []).includes(id);
  const r2 = (status.devices || []).find(d => d.id === id);
  const last = lsGet(REG);
  if (!known) {
    // gửi lại cho bot nếu chưa gửi, hoặc đã gửi mà quá 2 giờ bot vẫn chưa nhận
    if (!last || last.id !== id || Date.now() - last.at > 2 * 3600e3) { try { await sendToBot(sub, botPub); } catch {} }
    return { state: 'pending', id };
  }
  if (r2 && !r2.ok) return { state: 'error', id, rec: r2 };
  return { state: 'ok', id, rec: r2 || null };
}

export async function currentConfig() {
  if (!pushSupported() || permission() !== 'granted') return null;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  if (!sub) return null;
  return makeConfig(sub, await getVapid());
}
