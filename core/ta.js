// core/ta.js — chỉ báo kỹ thuật dùng cho lớp chấm điểm (prompt V8.0). Không gọi mạng, chạy được cả Node và trình duyệt.
// Mọi hàm nhận nến { t, o, h, l, c, v } cũ → mới và trả về mảng cùng độ dài (null khi chưa đủ dữ liệu).

export const safeDiv = (a, b) => a / Math.max(Math.abs(b), 1e-10) * (b < 0 ? -1 : 1);
const fin = x => typeof x === 'number' && isFinite(x);

export function sma(values, len) {
  const out = new Array(values.length).fill(null);
  let sum = 0, n = 0; const q = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!fin(v)) { q.length = 0; sum = 0; n = 0; continue; }
    q.push(v); sum += v; n++;
    if (n > len) { sum -= q.shift(); n--; }
    if (n === len) out[i] = sum / len;
  }
  return out;
}

export function ema(values, len) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (len + 1);
  let prev = null, sum = 0, n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!fin(v)) continue;
    if (prev === null) { sum += v; n++; if (n === len) { prev = sum / len; out[i] = prev; } continue; }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// Trung bình Wilder (RMA) — dùng cho RSI, ADX, ATR.
export function rma(values, len) {
  const out = new Array(values.length).fill(null);
  let prev = null, sum = 0, n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!fin(v)) continue;
    if (prev === null) { sum += v; n++; if (n === len) { prev = sum / len; out[i] = prev; } continue; }
    prev = (prev * (len - 1) + v) / len;
    out[i] = prev;
  }
  return out;
}

export function atr(K, len = 14) {
  const tr = K.c.map((c, i) => i === 0 ? K.h[0] - K.l[0] : Math.max(K.h[i] - K.l[i], Math.abs(K.h[i] - K.c[i - 1]), Math.abs(K.l[i] - K.c[i - 1])));
  return rma(tr, len);
}

export function rsi(c, len = 14) {
  const up = [null], dn = [null];
  for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1]; up.push(Math.max(d, 0)); dn.push(Math.max(-d, 0)); }
  const ru = rma(up, len), rd = rma(dn, len);
  return c.map((_, i) => (ru[i] === null || rd[i] === null) ? null : rd[i] === 0 ? 100 : 100 - 100 / (1 + ru[i] / rd[i]));
}

export function macd(c, f = 12, s = 26, sig = 9) {
  const ef = ema(c, f), es = ema(c, s);
  const line = c.map((_, i) => (ef[i] === null || es[i] === null) ? null : ef[i] - es[i]);
  const signal = ema(line, sig);
  return { line, signal, hist: line.map((x, i) => (x === null || signal[i] === null) ? null : x - signal[i]) };
}

// ADX(14) kiểu Wilder (như TradingView).
export function adx(K, len = 14) {
  const N = K.c.length, pdm = [null], mdm = [null], tr = [null];
  for (let i = 1; i < N; i++) {
    const up = K.h[i] - K.h[i - 1], dn = K.l[i - 1] - K.l[i];
    pdm.push(up > dn && up > 0 ? up : 0); mdm.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(K.h[i] - K.l[i], Math.abs(K.h[i] - K.c[i - 1]), Math.abs(K.l[i] - K.c[i - 1])));
  }
  const atrS = rma(tr, len), p = rma(pdm, len), m = rma(mdm, len);
  const pdi = [], mdi = [], dx = [];
  for (let i = 0; i < N; i++) {
    if (atrS[i] === null || p[i] === null || m[i] === null) { pdi.push(null); mdi.push(null); dx.push(null); continue; }
    const a = 100 * safeDiv(p[i], atrS[i]), b = 100 * safeDiv(m[i], atrS[i]);
    pdi.push(a); mdi.push(b); dx.push(100 * Math.abs(a - b) / Math.max(a + b, 1e-10));
  }
  return { adx: rma(dx, len), pdi, mdi };
}

// Stochastic kiểu TradingView: K = sma(raw, smoothK), D = sma(K, smoothD).
export function stoch(K, len, smoothK, smoothD) {
  const { h, l, c } = K, raw = new Array(c.length).fill(null);
  for (let i = len - 1; i < c.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - len + 1; j <= i; j++) { if (h[j] > hh) hh = h[j]; if (l[j] < ll) ll = l[j]; }
    raw[i] = 100 * (c[i] - ll) / Math.max(hh - ll, 1e-10);
  }
  const k = sma(raw, smoothK);
  return { k, d: sma(k, smoothD) };
}

// Bộ đôi Dual Stochastic (prompt 4.1): chậm 32,13,5 (mỏ neo) + nhanh 10,5,5 (cò súng), kèm góc dốc chuẩn hoá.
const DEG = 180 / Math.PI;
export function dualStoch(K) {
  const slow = stoch(K, 32, 13, 5), fast = stoch(K, 10, 5, 5);
  const angFast = fast.k.map((x, i) => (i < 2 || x === null || fast.k[i - 2] === null) ? null : Math.atan(((x - fast.k[i - 2]) / 2) / 8) * DEG);
  const angSlow = slow.k.map((x, i) => (i < 3 || x === null || slow.k[i - 3] === null) ? null : Math.atan(((x - slow.k[i - 3]) / 3) / 4) * DEG);
  return { slowK: slow.k, slowD: slow.d, fastK: fast.k, fastD: fast.d, angFast, angSlow };
}

// Đỉnh/đáy Pivot(left, right): chỉ số các nến là đỉnh/đáy đã được xác nhận bởi `right` nến phía sau.
export function pivots(K, left = 3, right = left) {
  const N = K.c.length, hi = [], lo = [];
  for (let i = left; i < N - right; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= left && (isH || isL); j++) { if (!(K.h[i] > K.h[i - j])) isH = false; if (!(K.l[i] < K.l[i - j])) isL = false; }
    for (let j = 1; j <= right && (isH || isL); j++) { if (!(K.h[i] >= K.h[i + j])) isH = false; if (!(K.l[i] <= K.l[i + j])) isL = false; }
    if (isH) hi.push(i);
    if (isL) lo.push(i);
  }
  return { hi, lo };
}

/**
 * Cấu trúc SMC trên nến tới chỉ số `end` (mặc định nến cuối): đỉnh/đáy swing (swLen mỗi bên), BOS/CHoCH gần nhất.
 * trend: +1 sau BOS/CHoCH tăng, -1 sau giảm. lastBreak: { i, dir, kind: 'BOS'|'CHoCH', level }.
 */
export function structure(K, swLen = 5, end = K.c.length - 1) {
  const sub = { h: K.h.slice(0, end + 1), l: K.l.slice(0, end + 1), c: K.c.slice(0, end + 1) };
  const pv = pivots({ ...sub, o: sub.c, t: [], v: [] }, swLen, swLen);
  let trend = 0, lastBreak = null;
  let hiI = -1, loI = -1, hp = 0, lp = 0;
  const breaks = [];
  for (let i = 0; i <= end; i++) {
    while (hp < pv.hi.length && pv.hi[hp] + swLen <= i) { hiI = pv.hi[hp]; hp++; }
    while (lp < pv.lo.length && pv.lo[lp] + swLen <= i) { loI = pv.lo[lp]; lp++; }
    if (hiI >= 0 && K.c[i] > K.h[hiI] && (!lastBreak || lastBreak.ref !== hiI)) {
      const kind = trend === -1 ? 'CHoCH' : 'BOS';
      lastBreak = { i, dir: 1, kind, level: K.h[hiI], ref: hiI }; breaks.push(lastBreak); trend = 1;
    }
    if (loI >= 0 && K.c[i] < K.l[loI] && (!lastBreak || lastBreak.ref !== loI)) {
      const kind = trend === 1 ? 'CHoCH' : 'BOS';
      lastBreak = { i, dir: -1, kind, level: K.l[loI], ref: loI }; breaks.push(lastBreak); trend = -1;
    }
  }
  return { trend, lastBreak, breaks, swingHi: hiI, swingLo: loI, hi: pv.hi, lo: pv.lo };
}

// Khoảng trống giá FVG 3 nến còn chưa lấp (tính tới nến cuối). dir +1 = FVG tăng (vùng hỗ trợ), -1 = FVG giảm.
export function fvgs(K, lookback = 120) {
  const N = K.c.length, out = [];
  for (let i = Math.max(2, N - lookback); i < N; i++) {
    if (K.l[i] > K.h[i - 2]) out.push({ i, dir: 1, top: K.l[i], bot: K.h[i - 2] });
    if (K.h[i] < K.l[i - 2]) out.push({ i, dir: -1, top: K.l[i - 2], bot: K.h[i] });
  }
  return out.filter(z => {
    for (let j = z.i + 1; j < N; j++) {
      if (z.dir > 0 && K.l[j] <= z.bot) return false;     // lấp hết
      if (z.dir < 0 && K.h[j] >= z.top) return false;
    }
    return true;
  });
}

// Order Block: cây nến ngược màu cuối cùng trước một nhịp đẩy mạnh (thân ≥ 0,6 biên độ và biên độ ≥ 1,2 ATR).
export function orderBlocks(K, A, lookback = 120) {
  const N = K.c.length, out = [];
  for (let i = Math.max(1, N - lookback); i < N; i++) {
    const rng = K.h[i] - K.l[i], body = Math.abs(K.c[i] - K.o[i]);
    if (!A[i] || rng < 1.2 * A[i] || body < 0.6 * rng) continue;
    const up = K.c[i] > K.o[i];
    for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      const red = K.c[j] < K.o[j];
      if (up && red) { out.push({ i: j, dir: 1, top: K.h[j], bot: K.l[j] }); break; }
      if (!up && !red && K.c[j] !== K.o[j]) { out.push({ i: j, dir: -1, top: K.h[j], bot: K.l[j] }); break; }
    }
  }
  // còn hiệu lực: chưa bị đóng cửa xuyên qua
  return out.filter(z => {
    for (let j = z.i + 1; j < N; j++) {
      if (z.dir > 0 && K.c[j] < z.bot) return false;
      if (z.dir < 0 && K.c[j] > z.top) return false;
    }
    return true;
  });
}

// Mẫu nến tín hiệu tại nến i (prompt Setup ②, Cửa 3).
export function candlePattern(K, i, dir, A) {
  const o = K.o[i], h = K.h[i], l = K.l[i], c = K.c[i], rng = Math.max(h - l, 1e-10), body = Math.abs(c - o);
  const upW = h - Math.max(o, c), loW = Math.min(o, c) - l;
  if (dir > 0) {
    if (loW >= 2 * Math.max(body, 1e-10) && (h - Math.max(o, c)) <= 0.4 * rng && Math.min(o, c) >= l + 0.6 * rng) return 'Búa (Hammer)';
    if (i >= 1 && c > o && K.c[i - 1] < K.o[i - 1] && c >= K.o[i - 1] && o <= K.c[i - 1]) return 'Nhấn chìm tăng';
    if (i >= 2 && K.c[i - 2] < K.o[i - 2] && Math.abs(K.c[i - 1] - K.o[i - 1]) <= 0.3 * (K.h[i - 1] - K.l[i - 1] || 1e-10) && c > o && c > (K.o[i - 2] + K.c[i - 2]) / 2) return 'Sao Mai';
  } else {
    if (upW >= 2 * Math.max(body, 1e-10) && loW <= 0.4 * rng && Math.max(o, c) <= l + 0.4 * rng) return 'Sao băng (Shooting Star)';
    if (i >= 1 && c < o && K.c[i - 1] > K.o[i - 1] && c <= K.o[i - 1] && o >= K.c[i - 1]) return 'Nhấn chìm giảm';
    if (i >= 2 && K.c[i - 2] > K.o[i - 2] && Math.abs(K.c[i - 1] - K.o[i - 1]) <= 0.3 * (K.h[i - 1] - K.l[i - 1] || 1e-10) && c < o && c < (K.o[i - 2] + K.c[i - 2]) / 2) return 'Sao Hôm';
  }
  if (i >= 2 && A && A[i]) {
    const doji = j => Math.abs(K.c[j] - K.o[j]) <= 0.15 * Math.max(K.h[j] - K.l[j], 1e-10);
    const tips = [i - 2, i - 1, i].map(j => dir > 0 ? K.l[j] : K.h[j]);
    if (doji(i) && doji(i - 1) && doji(i - 2) && Math.max(...tips) - Math.min(...tips) <= 0.5 * A[i]) return '3 Doji Vàng';
  }
  return null;
}

// Phân kỳ: giá tạo đáy thấp hơn nhưng chỉ báo (Fast_K hoặc RSI) tạo đáy cao hơn (dir +1) — và ngược lại (dir -1).
export function divergence(K, osc, dir, end = K.c.length - 1, look = 40) {
  const pv = pivots(K, 3, 2);
  const list = (dir > 0 ? pv.lo : pv.hi).filter(i => i <= end && i >= end - look);
  if (list.length < 2) return false;
  const a = list[list.length - 2], b = list[list.length - 1];
  if (osc[a] === null || osc[b] === null) return false;
  return dir > 0 ? (K.l[b] < K.l[a] && osc[b] > osc[a]) : (K.h[b] > K.h[a] && osc[b] < osc[a]);
}

// Nến "nước rút" ngược chiều trong nhịp hồi (prompt 4.2, trường hợp 5): định LONG mà có nến đỏ volume > 2,5× MA20
// đóng sát đáy; định SHORT mà có nến xanh volume > 2,5× MA20 đóng sát đỉnh.
export function nuocRut(K, dir, from, to) {
  const vma = sma(K.v, 20);
  for (let i = Math.max(1, from); i <= to; i++) {
    const rng = Math.max(K.h[i] - K.l[i], 1e-10), v = vma[i - 1];
    if (!v || !(K.v[i] > 2.5 * v)) continue;
    if (dir > 0 && K.c[i] < K.o[i] && (K.c[i] - K.l[i]) <= 0.25 * rng) return i;
    if (dir < 0 && K.c[i] > K.o[i] && (K.h[i] - K.c[i]) <= 0.25 * rng) return i;
  }
  return -1;
}

// Ổ thanh khoản 💧: cụm ≥ 2 đỉnh (hoặc đáy) gần bằng nhau (lệch ≤ 0,35% hoặc ≤ 0,5 ATR) trong 60 nến gần nhất,
// chưa bị nến đóng cửa vượt qua.
export function liquidityPools(K, A, look = 60) {
  const N = K.c.length, pv = pivots(K, 2, 2), out = [];
  for (const [side, list, X] of [['high', pv.hi, K.h], ['low', pv.lo, K.l]]) {
    const ids = list.filter(i => i >= N - look);
    const used = new Set();
    for (let a = 0; a < ids.length; a++) {
      if (used.has(a)) continue;
      const grp = [ids[a]];
      for (let b = a + 1; b < ids.length; b++) {
        const tol = Math.max(X[ids[a]] * 0.0035, 0.5 * (A[ids[b]] || 0));
        if (Math.abs(X[ids[b]] - X[ids[a]]) <= tol) { grp.push(ids[b]); used.add(b); }
      }
      if (grp.length < 2) continue;
      const lvl = side === 'high' ? Math.max(...grp.map(i => X[i])) : Math.min(...grp.map(i => X[i]));
      const last = Math.max(...grp);
      let alive = true;
      for (let j = last + 1; j < N; j++) if (side === 'high' ? K.c[j] > lvl : K.c[j] < lvl) { alive = false; break; }
      out.push({ side, level: lvl, n: grp.length, idx: grp, alive });
    }
  }
  return out;
}

// Hồ sơ khối lượng (Volume Profile) n nến gần nhất: POC + vùng giá trị 70% (VAH/VAL).
export function volumeProfile(K, n = 120, bins = 48) {
  const N = K.c.length, from = Math.max(0, N - n);
  let lo = Infinity, hi = -Infinity;
  for (let i = from; i < N; i++) { lo = Math.min(lo, K.l[i]); hi = Math.max(hi, K.h[i]); }
  if (!(hi > lo)) return null;
  const w = (hi - lo) / bins, vol = new Array(bins).fill(0);
  for (let i = from; i < N; i++) {
    const a = Math.max(0, Math.floor((K.l[i] - lo) / w)), b = Math.min(bins - 1, Math.floor((K.h[i] - lo) / w));
    const share = (K.v[i] || 0) / (b - a + 1);
    for (let k = a; k <= b; k++) vol[k] += share;
  }
  let poc = 0; for (let k = 1; k < bins; k++) if (vol[k] > vol[poc]) poc = k;
  const total = vol.reduce((s, x) => s + x, 0);
  let a = poc, b = poc, acc = vol[poc];
  while (acc < 0.7 * total && (a > 0 || b < bins - 1)) {
    const up = b < bins - 1 ? vol[b + 1] : -1, dn = a > 0 ? vol[a - 1] : -1;
    if (up >= dn) { b++; acc += vol[b]; } else { a--; acc += vol[a]; }
  }
  return { poc: lo + (poc + 0.5) * w, val: lo + a * w, vah: lo + (b + 1) * w, lo, hi };
}

/**
 * Hộp Tím (vùng cản ngang): các vùng giá có nhiều râu nến phản ứng (≥ 3 đỉnh/đáy trong biên 0,6 ATR) trong 120 nến,
 * cộng thêm vùng quanh POC của hồ sơ khối lượng. Trả về [{ top, bot, n, poc }].
 */
export function purpleBoxes(K, A, look = 120) {
  const N = K.c.length, pv = pivots(K, 2, 2), a = A[N - 1] || 0;
  const P = [...pv.hi.map(i => ({ p: K.h[i], i })), ...pv.lo.map(i => ({ p: K.l[i], i }))].filter(x => x.i >= N - look).sort((x, y) => x.p - y.p);
  const boxes = [];
  for (let s = 0; s < P.length;) {
    let e = s; while (e + 1 < P.length && P[e + 1].p - P[s].p <= 0.6 * a) e++;
    if (e - s + 1 >= 3) boxes.push({ bot: P[s].p, top: P[e].p, n: e - s + 1, i: Math.min(...P.slice(s, e + 1).map(x => x.i)) });
    s = e + 1;
  }
  const vp = volumeProfile(K, look);
  if (vp) {
    for (const b of boxes) if (vp.poc >= b.bot - 0.3 * a && vp.poc <= b.top + 0.3 * a) b.poc = true;
    if (!boxes.some(b => b.poc)) boxes.push({ bot: vp.poc - 0.3 * a, top: vp.poc + 0.3 * a, n: 0, poc: true, i: Math.max(0, N - look) });
  }
  return boxes;
}

// Nhịp ngắn một khung (prompt 3.1, lớp 2): +1 khi Close > EMA21 > EMA55, -1 khi Close < EMA21 < EMA55, còn lại 0.
export function rhythm(K) {
  const N = K.c.length; if (N < 56) return 0;
  const e21 = ema(K.c, 21)[N - 1], e55 = ema(K.c, 55)[N - 1], c = K.c[N - 1];
  if (e21 === null || e55 === null) return 0;
  return c > e21 && e21 > e55 ? 1 : c < e21 && e21 < e55 ? -1 : 0;
}

// Xu hướng lớn xếp tầng (prompt 3.1, lớp 1): bias theo EMA21/55/144, điểm sức mạnh g1 (0..3), strong khi g1 = 3.
export function macroTrend(K) {
  const N = K.c.length;
  if (N < 150) return { bias: 0, g1: 0, strong: false, ema200: null, above200: null, short: true };
  const c = K.c, e21 = ema(c, 21)[N - 1], e55 = ema(c, 55)[N - 1], e144 = ema(c, 144)[N - 1], e200 = N >= 200 ? ema(c, 200)[N - 1] : null;
  const m = macd(c), r = rsi(c, 14), pv = pivots(K, 3, 3);
  const stackUp = e21 > e55 && e55 > e144, stackDn = e21 < e55 && e55 < e144;
  const bias = stackUp ? 1 : stackDn ? -1 : 0;
  const [h0, h1] = pv.hi.slice(-2).map(i => K.h[i]), [l0, l1] = pv.lo.slice(-2).map(i => K.l[i]);
  const ml = m.line[N - 1], rs = r[N - 1];
  let g1 = 0;
  if (bias === 1) g1 = 1 + (h1 > h0 && l1 > l0 ? 1 : 0) + (ml > 0 && rs > 50 ? 1 : 0);
  if (bias === -1) g1 = 1 + (h1 < h0 && l1 < l0 ? 1 : 0) + (ml < 0 && rs < 50 ? 1 : 0);
  return { bias, g1, strong: g1 === 3, ema200: e200, above200: e200 === null ? null : c[N - 1] > e200, ema21: e21, ema55: e55, ema144: e144, macd: ml, rsi: rs };
}

// Fibonacci của nhịp đẩy gần nhất trong `look` nến: trả về mức thoái lui của giá hiện tại (0 = đỉnh/đáy sóng, 1 = chân sóng).
export function fibOfLastLeg(K, dir, look = 120) {
  const N = K.c.length, from = Math.max(0, N - look);
  let hiI = from, loI = from;
  for (let i = from; i < N; i++) { if (K.h[i] > K.h[hiI]) hiI = i; if (K.l[i] < K.l[loI]) loI = i; }
  const hi = K.h[hiI], lo = K.l[loI], rng = hi - lo;
  if (!(rng > 0)) return null;
  const p = K.c[N - 1];
  // LONG: sóng đẩy lên từ đáy (trước) lên đỉnh (sau), giá hồi về → thoái lui = (đỉnh − giá) / biên độ
  if (dir > 0 && loI < hiI) return { retr: (hi - p) / rng, hi, lo, amp: rng, hiI, loI };
  if (dir < 0 && hiI < loI) return { retr: (p - lo) / rng, hi, lo, amp: rng, hiI, loI };
  return null;
}
