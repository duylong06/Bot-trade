// app/ta.js — mấy phép tính chỉ báo dùng chung cho app.
// Stoch tính y như TradingView: %K thô → làm mượt bằng SMA → %K; %D = SMA của %K.

export function sma(a, n) {
  const out = new Array(a.length).fill(NaN);
  let s = 0, cnt = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (Number.isFinite(v)) { s += v; cnt++; }
    if (i >= n) { const old = a[i - n]; if (Number.isFinite(old)) { s -= old; cnt--; } }
    if (i >= n - 1 && cnt) out[i] = s / cnt;
  }
  return out;
}

export function ema(a, n) {
  const out = new Array(a.length).fill(NaN);
  const k = 2 / (n + 1);
  let prev = null;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (!Number.isFinite(v)) continue;
    prev = prev == null ? v : v * k + prev * (1 - k);
    if (i >= n - 1) out[i] = prev;
  }
  return out;
}

/* Stoch của TradingView: len = độ dài %K, kSm = làm mượt %K, dSm = làm mượt %D. */
export function stoch(k, len, kSm, dSm) {
  const n = k.c.length, raw = new Array(n);
  for (let i = 0; i < n; i++) {
    const s = Math.max(0, i - len + 1);
    let hi = -Infinity, lo = Infinity;
    for (let j = s; j <= i; j++) { if (k.h[j] > hi) hi = k.h[j]; if (k.l[j] < lo) lo = k.l[j]; }
    raw[i] = hi === lo ? 50 : (k.c[i] - lo) / (hi - lo) * 100;
  }
  const K = sma(raw, kSm);
  return { k: K, d: sma(K, dSm) };
}

export const stochTxt = v => !Number.isFinite(v) ? '—' : v >= 80 ? 'quá mua' : v <= 20 ? 'quá bán' : 'trung tính';

/* Đỉnh / đáy cục bộ. */
export function swings(k, left = 2, right = 2) {
  const hi = [], lo = [], n = k.c.length;
  for (let i = left; i < n - right; i++) {
    let isHi = true, isLo = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (k.h[j] >= k.h[i]) isHi = false;
      if (k.l[j] <= k.l[i]) isLo = false;
    }
    if (isHi) hi.push(i);
    if (isLo) lo.push(i);
  }
  return { hi, lo };
}

/* Kháng cự / hỗ trợ: gom các đỉnh đáy nằm gần nhau thành một mức. */
export function keyLevels(k, lb = 160, tol = 0.6) {
  const s = Math.max(0, k.c.length - lb);
  const sub = {}; ['o', 'h', 'l', 'c', 'v', 't'].forEach(f => sub[f] = k[f].slice(s));
  const sw = swings(sub, 2, 2);
  const pts = [...sw.hi.map(i => sub.h[i]), ...sw.lo.map(i => sub.l[i])].sort((a, b) => a - b);
  if (!pts.length) return [];
  const cl = [];
  for (const p of pts) {
    const last = cl.at(-1);
    if (last && Math.abs(p - last.reduce((x, y) => x + y, 0) / last.length) / p * 100 <= tol) last.push(p);
    else cl.push([p]);
  }
  const c = k.c.at(-1);
  return cl.map(g => ({ lvl: g.reduce((x, y) => x + y, 0) / g.length, n: g.length }))
    .map(o => ({ ...o, dist: Math.abs(o.lvl - c) / c * 100, side: o.lvl > c ? 'res' : 'sup' }))
    .sort((a, b) => a.dist - b.dist);
}

export function atr(k, n = 14) {
  const out = new Array(k.c.length).fill(NaN);
  let prev = null;
  const tr = [];
  for (let i = 0; i < k.c.length; i++) {
    const h = k.h[i], l = k.l[i], pc = i ? k.c[i - 1] : k.o[i];
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    if (i >= n - 1) {
      if (prev == null) { prev = tr.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n; }
      else prev = (prev * (n - 1) + tr[i]) / n;
      out[i] = prev;
    }
  }
  return out;
}
