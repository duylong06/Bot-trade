// app/indicators.js — EMA và Stochastic giống hệt cách TradingView tính.

export function ema(values, len) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (len + 1);
  let prev = null, sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (i < len) { sum += v; if (i === len - 1) { prev = sum / len; out[i] = prev; } continue; }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function sma(values, len) {
  const out = new Array(values.length).fill(null);
  let sum = 0, n = 0;
  const q = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) { q.length = 0; sum = 0; n = 0; continue; }
    q.push(v); sum += v; n++;
    if (n > len) { sum -= q.shift(); n--; }
    if (n === len) out[i] = sum / len;
  }
  return out;
}

// TradingView: K = sma(stoch(close, high, low, len), smoothK); D = sma(K, smoothD)
export function stoch(h, l, c, len, smoothK, smoothD) {
  const raw = new Array(c.length).fill(null);
  for (let i = len - 1; i < c.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - len + 1; j <= i; j++) { if (h[j] > hh) hh = h[j]; if (l[j] < ll) ll = l[j]; }
    raw[i] = hh === ll ? 50 : 100 * (c[i] - ll) / (hh - ll);
  }
  const k = sma(raw, smoothK);
  const d = sma(k, smoothD);
  return { k, d };
}
