// app/push.js — bật thông báo đẩy trên iPhone (PWA, iOS 16.4+).
//
// Khoá VAPID được tạo NGAY TRÊN MÁY bằng WebCrypto và lưu trong bộ nhớ của app, không đi đâu khác.
// Bấm "Bật thông báo" → app tạo một đoạn mã gồm đăng ký thông báo + khoá; người dùng dán đoạn đó
// vào GitHub Secret PUSH_CONFIG để bot dùng gửi thông báo về đúng máy này.

const KEY = 'bt.vapid.v1';
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const permission = () => ('Notification' in window ? Notification.permission : 'unsupported');

let vapidPromise = null;
export function getVapid() {
  if (vapidPromise) return vapidPromise;
  vapidPromise = (async () => {
    try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && v.pub && v.priv) return v; } catch {}
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
    const priv = (await crypto.subtle.exportKey('jwk', kp.privateKey)).d;
    const v = { pub, priv, created: Date.now() };
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {}
    return v;
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

function makeConfig(sub, v) {
  const j = sub.toJSON();
  return JSON.stringify({ v: 1, name: deviceName(), sub: { endpoint: j.endpoint, keys: j.keys }, vapid: { pub: v.pub, priv: v.priv } });
}

// PHẢI gọi trực tiếp trong sự kiện bấm nút (iOS chỉ cho xin quyền khi người dùng chạm).
export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied'
    ? 'Bạn đã chặn thông báo. Vào Cài đặt iPhone → Thông báo → Bot Trade để bật lại.'
    : 'Chưa cấp quyền thông báo.');
  const reg = await navigator.serviceWorker.ready;
  const v = await getVapid();
  const key = unb64u(v.pub);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options && sub.options.applicationServerKey, key)) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  return makeConfig(sub, v);
}

export async function currentConfig() {
  if (!pushSupported() || permission() !== 'granted') return null;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  if (!sub) return null;
  return makeConfig(sub, await getVapid());
}

export async function deviceId(config) {
  if (!config) return null;
  const { sub } = JSON.parse(config);
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sub.endpoint));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}
