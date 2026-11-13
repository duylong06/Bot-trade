// core/keopro.js — bản JavaScript của chỉ báo "Bot Kèo Pro" gói 100 trên TradingView.
//
// Chuyển từ Pine v6 (tradingview/keo-pro-goi100.pine). Giữ nguyên luật, chỉ đổi ngôn ngữ.
// KHÔNG khớp 100% với bản TradingView: khác nguồn dữ liệu (OKX vs Binance), khác cách
// TradingView gom nến, và vùng OB/FVG ở đây là bản rút gọn. Lệch vài phần trăm là bình thường.
//
// Năm loại tín hiệu, chỉ tính trên nến ĐÃ ĐÓNG:
//   ① BREAKOUT  nến đóng vượt kháng cự / thủng hỗ trợ ≥ 0,1 ATR, thân ≥ trung bình, đóng sát
//               đỉnh/đáy, volume ≥ 1,3× trung bình 20 nến
//   ② LỰC MẠNH  nến thân ≥ 1,5× trung bình + volume ≥ 1,5×, đóng vượt đỉnh/đáy nến trước,
//               bật từ hỗ trợ / kháng cự / vùng OB-FVG / sau cú quét / nối xu hướng
//   ③ EMA HỒI   EMA 21>55>144 + ADX/DI thuận → 4 nến gần nhất chạm EMA 21, không đóng dưới
//               EMA 144, RSI ≥ 40 → nến tăng đóng trên EMA 21 và vượt đỉnh nến trước
//   ④ PHÂN KỲ   đáy thấp hơn mà RSI cao hơn (pivot 5/5) → trong 10 nến, nến đóng vượt đỉnh
//               nến phân kỳ
//   ⑤ OI + GIÁ  (a) phá mốc + OI 4 nến tăng đột biến = tiền mới vào · (b) ≤ 6 nến sau cú xả
//               OI, nến đóng ngược chiều cú xả vượt đỉnh/đáy nến trước
//
// Điểm đồng thuận chỉ số −7..+7: EMA khung lớn ×2 · EMA chart · RSI · phân kỳ · ADX/DI · OI.
// Hạng: A+ ≥ 5 · A ≥ 3 · còn lại B.

export const P = {
  fMult: 1.5,        // nến lực: thân ≥ … × thân trung bình 20 nến
  vMult: 1.3,        // volume xác nhận ≥ … × trung bình 20 nến
  boMin: 0.1,        // breakout: đóng vượt mốc ít nhất … × ATR
  swLen: 5,          // đỉnh/đáy cho kháng cự/hỗ trợ và cấu trúc
  rsiLen: 14, adxLen: 14, adxMin: 20,
  oiHot: 10, oiFlush: 5, oiBo: 2,
  p1: 0.5,           // phần vào ngay ở giá đóng nến xác nhận
  iExt: 1.5,         // nến chạy xa mốc hơn … ATR → đặt hết ở vùng
  iZone: 0.25,       // vùng quanh mốc phá ± … ATR
  iBuf: 0.3,         // đệm SL ngoài vùng
  iSlAtr: 1.0,       // SL tối thiểu … ATR
  slPct: 0.8,        // SL tối thiểu … % giá (phong cách intraday)
  tp1R: 1.5, tp2R: 3.0,
  minRR: 1.2,        // R:R tối thiểu tới TP1 sau phí
  maxCostR: 0.35,    // phí + trượt tối đa tính theo R
  cost: 0.13,        // phí + trượt khứ hồi, %
};

/* ------------------------------------------------------------------ chỉ báo cơ bản */
export const sma = (a, n) => { const o = new Array(a.length).fill(NaN); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };
export function ema(a, n) { const o = new Array(a.length).fill(NaN), k = 2 / (n + 1); let p; for (let i = 0; i < a.length; i++) { p = i === 0 ? a[0] : a[i] * k + p * (1 - k); if (i >= n - 1) o[i] = p; } return o; }
export function rma(a, n) { const o = new Array(a.length).fill(NaN); let p = 0, s = 0; for (let i = 0; i < a.length; i++) { const v = Number.isFinite(a[i]) ? a[i] : 0; if (i < n) { s += v; p = s / (i + 1); } else p = (p * (n - 1) + v) / n; o[i] = p; } return o; }
export function atr(K, n = 14) {
  const tr = K.c.map((_, i) => i === 0 ? K.h[0] - K.l[0] : Math.max(K.h[i] - K.l[i], Math.abs(K.h[i] - K.c[i - 1]), Math.abs(K.l[i] - K.c[i - 1])));
  return rma(tr, n);
}
export function rsi(a, n = 14) {
  const up = [], dn = [];
  for (let i = 0; i < a.length; i++) { const d = i ? a[i] - a[i - 1] : 0; up.push(Math.max(d, 0)); dn.push(Math.max(-d, 0)); }
  const u = rma(up, n), d = rma(dn, n);
  return a.map((_, i) => d[i] === 0 ? 100 : 100 - 100 / (1 + u[i] / d[i]));
}
export function dmi(K, n = 14) {
  const N = K.c.length, pDM = [], mDM = [], tr = [];
  for (let i = 0; i < N; i++) {
    if (!i) { pDM.push(0); mDM.push(0); tr.push(K.h[0] - K.l[0]); continue; }
    const up = K.h[i] - K.h[i - 1], dn = K.l[i - 1] - K.l[i];
    pDM.push(up > dn && up > 0 ? up : 0);
    mDM.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(K.h[i] - K.l[i], Math.abs(K.h[i] - K.c[i - 1]), Math.abs(K.l[i] - K.c[i - 1])));
  }
  const t = rma(tr, n), p = rma(pDM, n), m = rma(mDM, n);
  const diP = p.map((v, i) => t[i] ? 100 * v / t[i] : 0);
  const diM = m.map((v, i) => t[i] ? 100 * v / t[i] : 0);
  const dx = diP.map((v, i) => (v + diM[i]) ? 100 * Math.abs(v - diM[i]) / (v + diM[i]) : 0);
  return { diP, diM, adx: rma(dx, n) };
}
/** pivot kiểu Pine: trả mảng cùng độ dài, giá trị đặt tại nến XÁC NHẬN (i), giá trị của nến i-len */
export function pivots(K, len) {
  const N = K.c.length, ph = new Array(N).fill(NaN), pl = new Array(N).fill(NaN);
  for (let i = 2 * len; i < N; i++) {
    const c = i - len; let H = true, L = true;
    for (let j = 1; j <= len; j++) {
      if (!(K.h[c] >= K.h[c - j] && K.h[c] > K.h[c + j])) H = false;
      if (!(K.l[c] <= K.l[c - j] && K.l[c] < K.l[c + j])) L = false;
    }
    if (H) ph[i] = K.h[c];
    if (L) pl[i] = K.l[c];
  }
  return { ph, pl };
}

/* ------------------------------------------------------------------ khung lớn */
/** Cấu trúc khung lớn: xu hướng theo nến đóng vượt đỉnh/thủng đáy (pivot 3/3), + EMA xếp tầng. */
export function htfState(H) {
  const { ph, pl } = pivots(H, 3), N = H.c.length;
  const e1 = ema(H.c, 21), e2 = ema(H.c, 55), e3 = ema(H.c, 144);
  let lh = NaN, ll = NaN, lhx = true, llx = true, t = 0;
  for (let i = 0; i < N; i++) {
    if (Number.isFinite(ph[i])) { lh = ph[i]; lhx = false; }
    if (Number.isFinite(pl[i])) { ll = pl[i]; llx = false; }
    if (!lhx && H.c[i] > lh) { t = 1; lhx = true; }
    if (!llx && H.c[i] < ll) { t = -1; llx = true; }
  }
  const n = N - 1;
  const es = e1[n] > e2[n] && e2[n] > e3[n] ? 1 : e1[n] < e2[n] && e2[n] < e3[n] ? -1 : 0;
  return { tr: t, res: lhx ? NaN : lh, sup: llx ? NaN : ll, ema: es };
}

/* ------------------------------------------------------------------ máy chính */
/**
 * K  nến khung chart (cũ → mới, CHỈ nến đã đóng)
 * H  nến khung lớn (4H cho cả M30 và H1), cũ → mới, đã đóng
 * OI mảng [[giờ, oiUsd], …] khớp mốc giờ của K; để trống thì bỏ qua loại ⑤ và điểm OI
 * tfSec số giây mỗi nến khung chart
 */
export function keoPro(K, H, OI, tfSec) {
  const N = K.c.length, n = N - 1;
  if (N < 200) return { err: 'cần ít nhất 200 nến' };
  const A = atr(K, 14), a = A[n];
  if (!(a > 0)) return { err: 'ATR = 0' };
  const px = K.c[n];
  const body = K.c.map((c, i) => Math.abs(c - K.o[i]));
  const avgBody = sma(body, 20);
  const volMa = sma(K.v, 20);
  const volOk = volMa[n] > 0;
  const rng = K.c.map((_, i) => Math.max(K.h[i] - K.l[i], 1e-12));
  const upW = K.c.map((c, i) => K.h[i] - Math.max(K.o[i], c));
  const dnW = K.c.map((c, i) => Math.min(K.o[i], c) - K.l[i]);

  /* --- nến breakout đạt / nến lực */
  const okBo = (i, up) => {
    const vOk = !(volMa[i] > 0) || K.v[i] >= P.vMult * volMa[i];
    return up ? (K.c[i] > K.o[i] && body[i] >= avgBody[i] && upW[i] <= 0.4 * rng[i] && vOk)
              : (K.c[i] < K.o[i] && body[i] >= avgBody[i] && dnW[i] <= 0.4 * rng[i] && vOk);
  };
  const vF = Math.max(P.vMult, 1.5);
  const force = (i, up) => {
    if (i < 1) return false;
    const vOk1 = !(volMa[i] > 0) || K.v[i] >= vF * volMa[i];
    const vOk2 = !(volMa[i] > 0) || K.v[i] + K.v[i - 1] >= vF * 2 * volMa[i];
    if (up) {
      const f1 = K.c[i] > K.o[i] && body[i] >= P.fMult * avgBody[i] && upW[i] <= 0.3 * rng[i] && K.c[i] > K.h[i - 1] && vOk1;
      const f2 = !f1 && K.c[i] > K.o[i] && K.c[i - 1] > K.o[i - 1] && K.c[i] - K.o[i - 1] >= (P.fMult + 1) * avgBody[i] && K.c[i] > K.h[i - 1] && upW[i] <= 0.4 * rng[i] && vOk2;
      return f1 || f2;
    }
    const f1 = K.c[i] < K.o[i] && body[i] >= P.fMult * avgBody[i] && dnW[i] <= 0.3 * rng[i] && K.c[i] < K.l[i - 1] && vOk1;
    const f2 = !f1 && K.c[i] < K.o[i] && K.c[i - 1] < K.o[i - 1] && K.o[i - 1] - K.c[i] >= (P.fMult + 1) * avgBody[i] && K.c[i] < K.l[i - 1] && dnW[i] <= 0.4 * rng[i] && vOk2;
    return f1 || f2;
  };

  /* --- chỉ số */
  const ce1 = ema(K.c, 21), ce2 = ema(K.c, 55), ce3 = ema(K.c, 144);
  const emaSt = ce1[n] > ce2[n] && ce2[n] > ce3[n] ? 1 : ce1[n] < ce2[n] && ce2[n] < ce3[n] ? -1 : 0;
  const R = rsi(K.c, P.rsiLen), rsiNow = R[n];
  const D = dmi(K, P.adxLen), adx = D.adx[n];
  const adxDir = adx >= P.adxMin ? (D.diP[n] > D.diM[n] ? 1 : D.diM[n] > D.diP[n] ? -1 : 0) : 0;

  /* --- phân kỳ RSI, pivot 5/5 */
  const pv5 = pivots(K, 5);
  let plP1 = NaN, plP2 = NaN, rlP1 = NaN, rlP2 = NaN, phP1 = NaN, phP2 = NaN, rhP1 = NaN, rhP2 = NaN;
  let dvBar = NaN, dvDir = 0;
  let pkTU = NaN, pkLU = NaN, pkBU = NaN, pkSU = '';
  let pkTD = NaN, pkHD = NaN, pkBD = NaN, pkSD = '';
  for (let i = 0; i < N; i++) {
    if (Number.isFinite(pv5.pl[i])) {
      plP2 = plP1; plP1 = pv5.pl[i]; rlP2 = rlP1; rlP1 = R[i - 5];
      if (Number.isFinite(plP2) && Number.isFinite(rlP2) && plP1 < plP2 && rlP1 > rlP2) {
        dvBar = i - 5; dvDir = 1;
        if (plP2 - plP1 <= 1.5 * A[i]) { pkTU = K.h[i - 5]; pkLU = pv5.pl[i]; pkBU = i; pkSU = `phân kỳ RSI tăng: đáy ${plP2.toFixed(4)} → ${plP1.toFixed(4)} mà RSI ${rlP2.toFixed(0)} → ${rlP1.toFixed(0)}`; }
      }
    }
    if (Number.isFinite(pv5.ph[i])) {
      phP2 = phP1; phP1 = pv5.ph[i]; rhP2 = rhP1; rhP1 = R[i - 5];
      if (Number.isFinite(phP2) && Number.isFinite(rhP2) && phP1 > phP2 && rhP1 < rhP2) {
        dvBar = i - 5; dvDir = -1;
        if (phP1 - phP2 <= 1.5 * A[i]) { pkTD = K.l[i - 5]; pkHD = pv5.ph[i]; pkBD = i; pkSD = `phân kỳ RSI giảm: đỉnh ${phP2.toFixed(4)} → ${phP1.toFixed(4)} mà RSI ${rhP2.toFixed(0)} → ${rhP1.toFixed(0)}`; }
      }
    }
    // hết hiệu lực khi giá đóng qua đáy/đỉnh phân kỳ
    if (Number.isFinite(pkLU) && K.c[i] < pkLU) pkBU = NaN;
    if (Number.isFinite(pkHD) && K.c[i] > pkHD) pkBD = NaN;
  }
  const dvRecent = Number.isFinite(dvBar) && n - dvBar <= 30;

  /* --- Open Interest */
  const oiMap = new Map((OI || []).map(([t, v]) => [t, v]));
  const oi = K.t.map(t => oiMap.has(t) ? oiMap.get(t) : NaN);
  const n24 = Math.min(480, Math.max(1, Math.round(86400 / tfSec)));
  const have = (i) => Number.isFinite(oi[i]);
  let oiChg = NaN, oiDrop = NaN, pxChg24 = NaN;
  if (have(n) && have(n - n24) && oi[n - n24]) oiChg = (oi[n] - oi[n - n24]) / oi[n - n24] * 100;
  if (have(n)) { const w = oi.slice(Math.max(0, n - n24), n + 1).filter(Number.isFinite); const mx = w.length ? Math.max(...w) : NaN; if (mx > 0) oiDrop = (mx - oi[n]) / mx * 100; }
  if (K.c[n - n24]) pxChg24 = (K.c[n] - K.c[n - n24]) / K.c[n - n24] * 100;
  const oiUse = Number.isFinite(oiChg) && Number.isFinite(pxChg24);
  const crowdL = oiUse && oiChg >= P.oiHot && pxChg24 > 0 && (oiDrop || 0) < P.oiFlush;
  const crowdS = oiUse && oiChg >= P.oiHot && pxChg24 < 0 && (oiDrop || 0) < P.oiFlush;
  const oiDir = !oiUse ? 0 : (oiChg >= 2 && pxChg24 > 0 ? 1 : oiChg >= 2 && pxChg24 < 0 ? -1 : 0);

  /* --- cấu trúc + kháng cự / hỗ trợ chưa bị nến đóng vượt */
  const pvS = pivots(K, P.swLen);
  const RH = [], RL = [];                     // { p, b, n }
  const addLv = (arr, v, bi, isH) => {
    const hit = arr.findIndex(x => Math.abs(x.p - v) <= 0.25 * a);
    if (hit >= 0) { arr[hit].p = isH ? Math.max(arr[hit].p, v) : Math.min(arr[hit].p, v); arr[hit].n++; }
    else { arr.push({ p: v, b: bi, n: 1 }); if (arr.length > 12) arr.shift(); }
  };
  const brkLv = (arr, isH, i) => {            // trả mốc vừa bị nến i đóng vượt
    let lv = NaN, tc = 0, lb = NaN;
    for (let k = arr.length - 1; k >= 0; k--) {
      const v = arr[k].p;
      if (isH ? K.c[i] > v + P.boMin * A[i] : K.c[i] < v - P.boMin * A[i]) {
        const prevIn = isH ? K.c[i - 1] <= v : K.c[i - 1] >= v;
        if (prevIn && (!Number.isFinite(lv) || (isH ? v > lv : v < lv))) { lv = v; tc = arr[k].n; lb = arr[k].b; }
        arr.splice(k, 1);
      }
    }
    return { lv, tc, lb };
  };
  let trd = 0, sH = NaN, sL = NaN, sHx = true, sLx = true;
  let boU = { lv: NaN, tc: 0 }, boD = { lv: NaN, tc: 0 };
  for (let i = 1; i < N; i++) {
    if (i === n) { boU = brkLv(RH, true, i); boD = brkLv(RL, false, i); }
    else { brkLv(RH, true, i); brkLv(RL, false, i); }
    if (Number.isFinite(pvS.ph[i])) { sH = pvS.ph[i]; sHx = false; addLv(RH, pvS.ph[i], i - P.swLen, true); }
    if (Number.isFinite(pvS.pl[i])) { sL = pvS.pl[i]; sLx = false; addLv(RL, pvS.pl[i], i - P.swLen, false); }
    if (!sHx && K.c[i] > sH) { trd = 1; sHx = true; }
    if (!sLx && K.c[i] < sL) { trd = -1; sLx = true; }
  }
  const h = H ? htfState(H) : { tr: 0, res: NaN, sup: NaN, ema: 0 };
  const near = (arr, above, extra) => {        // 2 mốc gần nhất, gộp mốc sát nhau
    let r1 = NaN, r2 = NaN;
    const vals = arr.map(x => x.p).concat(Number.isFinite(extra) ? [extra] : []);
    for (const v of vals) {
      if (!(above ? v > px : v < px)) continue;
      if (Number.isFinite(r1) && Math.abs(v - r1) <= 0.25 * a) r1 = above ? Math.min(r1, v) : Math.max(r1, v);
      else if (!Number.isFinite(r1) || (above ? v < r1 : v > r1)) { r2 = r1; r1 = v; }
      else if (!Number.isFinite(r2) || (above ? v < r2 : v > r2)) r2 = v;
    }
    return [r1, r2];
  };
  const [res1, res2] = near(RH, true, h.res);
  const [sup1, sup2] = near(RL, false, h.sup);

  /* --- vùng OB / FVG rút gọn: FVG 3 nến chưa lấp + nến ngược chiều cuối trước cú đẩy */
  const zones = [];
  for (let i = 2; i < N - 1; i++) {
    if (K.l[i] > K.h[i - 2]) zones.push({ d: 1, b: K.h[i - 2], t: K.l[i], i });
    if (K.h[i] < K.l[i - 2]) zones.push({ d: -1, b: K.h[i], t: K.l[i - 2], i });
    if (force(i, true) && K.c[i - 1] < K.o[i - 1]) zones.push({ d: 1, b: K.l[i - 1], t: K.h[i - 1], i });
    if (force(i, false) && K.c[i - 1] > K.o[i - 1]) zones.push({ d: -1, b: K.l[i - 1], t: K.h[i - 1], i });
  }
  const alive = zones.filter(z => {           // chưa bị lấp hẳn
    for (let k = z.i + 1; k < n; k++) if (z.d > 0 ? K.c[k] < z.b : K.c[k] > z.t) return false;
    return true;
  }).slice(-24);
  const zT_ = d => alive.some(z => z.d === d && K.l[n] <= z.t && K.h[n] >= z.b);
  const zTU = zT_(1), zTD = zT_(-1);

  /* --- năm loại tín hiệu trên nến cuối */
  const okHU = h.tr !== -1, okHD = h.tr !== 1;
  const lo5p = Math.min(...K.l.slice(n - 5, n)), hi5p = Math.max(...K.h.slice(n - 5, n));
  const nearS = Number.isFinite(sup1) && K.l[n] <= sup1 + 0.5 * a, sweepS = Number.isFinite(sup1) && K.l[n] < sup1;
  const nearR = Number.isFinite(res1) && K.h[n] >= res1 - 0.5 * a, sweepR = Number.isFinite(res1) && K.h[n] > res1;
  const contU = trd === 1 && K.l[n] <= lo5p + 0.3 * a, contD = trd === -1 && K.h[n] >= hi5p - 0.3 * a;
  const fU = force(n, true), fD = force(n, false);
  const fcBuy = fU && (nearS || zTU || contU) && (trd !== -1 || sweepS || zTU) && okHU;
  const fcSell = fD && (nearR || zTD || contD) && (trd !== 1 || sweepR || zTD) && okHD;
  const boBuy = Number.isFinite(boU.lv) && (okBo(n, true) || fU) && okHU;
  const boSell = Number.isFinite(boD.lv) && (okBo(n, false) || fD) && okHD;

  const touched = (up) => { for (let k = n - 3; k <= n; k++) if (up ? K.l[k] <= ce1[k] : K.h[k] >= ce1[k]) return true; return false; };
  const w4 = (arr, f) => f(...arr.slice(n - 3, n + 1));
  const emLoC = Math.min(...K.c.slice(n - 3, n + 1)), emHiC = Math.max(...K.c.slice(n - 3, n + 1));
  const emLoR = Math.min(...R.slice(n - 3, n + 1)), emHiR = Math.max(...R.slice(n - 3, n + 1));
  const emBuy = emaSt === 1 && adxDir === 1 && touched(true) && emLoC > ce3[n] && emLoR >= 40 &&
    K.c[n] > K.o[n] && K.c[n] > ce1[n] && K.c[n] > K.h[n - 1] && body[n] >= 0.6 * avgBody[n] && okHU;
  const emSell = emaSt === -1 && adxDir === -1 && touched(false) && emHiC < ce3[n] && emHiR <= 60 &&
    K.c[n] < K.o[n] && K.c[n] < ce1[n] && K.c[n] < K.l[n - 1] && body[n] >= 0.6 * avgBody[n] && okHD;

  const dvBuy = Number.isFinite(pkBU) && n - pkBU <= 10 && K.c[n] > pkTU && K.c[n] > K.o[n] && okHU;
  const dvSell = Number.isFinite(pkBD) && n - pkBD <= 10 && K.c[n] < pkTD && K.c[n] < K.o[n] && okHD;

  // ⑤ OI: nhảy 4 nến thuộc nhóm mạnh nhất, hoặc nến xác nhận sau cú xả đòn bẩy
  const oiS4 = K.t.map((_, i) => (i >= 4 && have(i) && have(i - 4) && oi[i - 4]) ? (oi[i] - oi[i - 4]) / oi[i - 4] * 100 : NaN);
  const win = oiS4.slice(Math.max(0, n - 99), n + 1).filter(Number.isFinite).sort((x, y) => x - y);
  const p90 = win.length ? win[Math.min(win.length - 1, Math.floor(win.length * 0.9))] : 0;
  const oiJump = Number.isFinite(oiS4[n]) && oiS4[n] >= Math.max(P.oiBo, p90);
  let flU = NaN, flD = NaN, flDone = false;
  for (let i = n24 + 1; i < N; i++) {
    const w = oi.slice(Math.max(0, i - n24), i + 1).filter(Number.isFinite);
    const mx = w.length ? Math.max(...w) : NaN;
    const drop = (mx > 0 && have(i)) ? (mx - oi[i]) / mx * 100 : NaN;
    const fl = Number.isFinite(drop) && drop >= P.oiFlush;
    if (!fl) { flDone = false; continue; }
    if (flDone) continue;
    const hi24 = Math.max(...K.h.slice(Math.max(0, i - n24), i + 1));
    const lo24 = Math.min(...K.l.slice(Math.max(0, i - n24), i + 1));
    const pch = K.c[i - n24] ? (K.c[i] - K.c[i - n24]) / K.c[i - n24] * 100 : 0;
    if (pch < 0 && hi24 - K.c[i] >= 2 * A[i]) { flU = i; flDone = true; }
    else if (pch > 0 && K.c[i] - lo24 >= 2 * A[i]) { flD = i; flDone = true; }
  }
  const oiOk = oiUse;
  const oiBoU = Number.isFinite(boU.lv) && oiJump && body[n] >= 0.5 * avgBody[n] && upW[n] <= 0.5 * rng[n];
  const oiBoD = Number.isFinite(boD.lv) && oiJump && body[n] >= 0.5 * avgBody[n] && dnW[n] <= 0.5 * rng[n];
  const oiBuy = oiOk && K.c[n] > K.o[n] && (oiBoU || (Number.isFinite(flU) && n - flU <= 6 && K.c[n] > K.h[n - 1])) && okHU;
  const oiSell = oiOk && K.c[n] < K.o[n] && (oiBoD || (Number.isFinite(flD) && n - flD <= 6 && K.c[n] < K.l[n - 1])) && okHD;

  const bU = boBuy || fcBuy || emBuy || dvBuy || oiBuy;
  const bD = boSell || fcSell || emSell || dvSell || oiSell;
  let dir = 0, kind = 0;
  if (bU && !bD) { dir = 1; kind = boBuy ? 1 : fcBuy ? 2 : emBuy ? 3 : dvBuy ? 4 : 5; }
  else if (bD && !bU) { dir = -1; kind = boSell ? 1 : fcSell ? 2 : emSell ? 3 : dvSell ? 4 : 5; }

  /* --- điểm đồng thuận chỉ số −7..+7 */
  const score = d => {
    const L = d === 1;
    const hE = (h.ema || 0) * d;
    const e = emaSt * d;
    const r = (L ? rsiNow > 50 && rsiNow < 75 : rsiNow < 50 && rsiNow > 25) ? 1 : (L ? rsiNow >= 75 : rsiNow <= 25) ? -1 : 0;
    const v = dvRecent ? dvDir * d : 0;
    const x = adxDir * d;
    const o = (L ? crowdL : crowdS) ? -1 : oiDir * d;
    const s = 2 * hE + e + r + v + x + o;
    const sg = q => (q >= 0 ? '+' : '−') + Math.abs(q);
    const why = [
      `${hE > 0 ? '✓' : hE < 0 ? '✗' : '·'} EMA 21/55/144 khung 4H ${h.ema === 1 ? 'xếp TĂNG' : h.ema === -1 ? 'xếp GIẢM' : 'đan xen'} (${sg(2 * hE)})`,
      `${e > 0 ? '✓' : e < 0 ? '✗' : '·'} EMA chart ${emaSt === 1 ? 'xếp TĂNG' : emaSt === -1 ? 'xếp GIẢM' : 'đan xen'} (${sg(e)})`,
      `${r > 0 ? '✓' : r < 0 ? '✗' : '·'} RSI ${rsiNow.toFixed(0)}${rsiNow >= 75 ? ' quá mua' : rsiNow <= 25 ? ' quá bán' : ''} (${sg(r)})`,
      `${v > 0 ? '✓' : v < 0 ? '✗' : '·'} Phân kỳ RSI ${dvRecent ? (dvDir === 1 ? 'tăng ' : 'giảm ') + (n - dvBar) + ' nến trước' : 'không có'} (${sg(v)})`,
      `${x > 0 ? '✓' : x < 0 ? '✗' : '·'} ADX ${adx.toFixed(0)}${adx >= P.adxMin ? (D.diP[n] > D.diM[n] ? ' · DI+ > DI−' : ' · DI− > DI+') : ' · yếu, đi ngang'} (${sg(x)})`,
      `${o > 0 ? '✓' : o < 0 ? '✗' : '·'} ${!oiUse ? 'OI: không có dữ liệu' : `OI ${oiChg >= 0 ? '+' : '−'}${Math.abs(oiChg).toFixed(1)}%/24h, giá ${pxChg24 >= 0 ? '+' : '−'}${Math.abs(pxChg24).toFixed(1)}% → ${crowdL ? 'ĐÔNG LONG, dễ bị quét' : crowdS ? 'ĐÔNG SHORT, dễ bị quét' : oiDir === 1 ? 'long đang vào' : oiDir === -1 ? 'short đang vào' : (oiDrop || 0) >= P.oiFlush ? 'vừa xả đòn bẩy' : 'đóng lệnh, bình thường'}`}  (${sg(o)})`,
    ];
    return { s, grade: s >= 5 ? 'A+' : s >= 3 ? 'A' : 'B', why };
  };

  /* --- kế hoạch lệnh: vào 2 phần, SL ngoài vùng, TP tính theo R sau phí */
  const plan = (d, lv, isBO, o, lo) => {
    const f = x => d * x;                           // lật giá cho SELL để dùng chung luật
    const c = f(K.c[n]), L = f(lv), oo = f(o), ll = f(lo);
    const n1 = d === 1 ? res1 : sup1, n2 = d === 1 ? res2 : sup2;
    const N1 = Number.isFinite(n1) ? f(n1) : NaN, N2 = Number.isFinite(n2) ? f(n2) : NaN;
    const zT = isBO ? Math.min(L + P.iZone * a, c) : oo + 0.5 * (c - oo);
    const zB = isBO ? Math.min(L - P.iZone * a, zT - 0.1 * a) : oo;
    const e2 = (zT + zB) / 2;
    const p1 = (isBO ? c - L : c - e2) > P.iExt * a ? 0 : P.p1;
    const avg = p1 * c + (1 - p1) * e2;
    let sl = (isBO ? zB : Math.min(ll, zB)) - P.iBuf * a;
    const mr = Math.max(P.iSlAtr * a, Math.abs(avg) * P.slPct / 100);
    if (avg - sl < mr) sl = avg - mr;
    const ru = avg - sl, cst = Math.abs(avg) * P.cost / 100;
    let t1 = avg + P.tp1R * (ru + cst) + cst, t2 = avg + P.tp2R * (ru + cst) + cst;
    let cap = false;
    if (Number.isFinite(N1) && N1 > avg && N1 < t1) { t1 = N1 - 0.1 * a; cap = true; }
    const nx = Number.isFinite(N1) && N1 > t1 + 0.1 * a ? N1 : N2;
    if (Number.isFinite(nx) && nx < t2 && nx - 0.1 * a >= t1 + 0.5 * ru) t2 = nx - 0.1 * a;
    t2 = Math.max(t2, t1 + 0.5 * ru);
    const rr = (t1 - avg - cst) / (ru + cst);
    const bad = rr < P.minRR ? (cap ? 1 : 2) : cst / ru > P.maxCostR ? 3 : 0;
    return { p1, e1: K.c[n], e2: f(e2), zT: d === 1 ? zT : -zB, zB: d === 1 ? zB : -zT, sl: f(sl), tp1: f(t1), tp2: f(t2), rr, bad };
  };

  const out = {
    px, atr: a, atrPct: a / px * 100, bar: K.t[n], rsi: rsiNow, adx, emaSt, htf: h,
    trd, res1, res2, sup1, sup2, oiChg, pxChg24, oiDrop, crowdL, crowdS, oiDir,
    buyPct: (() => { const w = 20; let u = 0, t = 0; for (let i = n - w + 1; i <= n; i++) { const q = volOk ? K.v[i] : body[i]; t += q; if (K.c[i] > K.o[i]) u += q; } return t ? u / t * 100 : 50; })(),
    volX: volOk ? K.v[n] / volMa[n] : null,
    sig: null, planBuy: score(1), planSell: score(-1),
  };
  if (!dir) return out;

  const KIND = { 1: 'Breakout', 2: 'Lực mạnh', 3: 'EMA hồi', 4: 'Phân kỳ RSI', 5: 'OI + giá' };
  const sc = score(dir);
  const isBO = kind === 1 || (kind === 5 && (dir > 0 ? oiBoU : oiBoD));
  const lv = isBO ? (dir > 0 ? boU.lv : boD.lv) : NaN;
  const pl = plan(dir, isBO ? lv : K.o[n], isBO, K.o[n], dir > 0 ? K.l[n] : K.h[n]);
  const why = kind === 1 ? `nến đóng ${dir > 0 ? 'vượt kháng cự' : 'thủng hỗ trợ'} ${lv?.toFixed(4)} (${dir > 0 ? boU.tc : boD.tc} lần chạm)`
    : kind === 2 ? (dir > 0 ? (sweepS ? `quét đáy ${sup1?.toFixed(4)} rồi bật` : zTU ? 'bật từ vùng OB / FVG mua' : nearS ? `bật từ hỗ trợ ${sup1?.toFixed(4)}` : 'nối xu hướng sau nhịp hồi')
                           : (sweepR ? `quét đỉnh ${res1?.toFixed(4)} rồi sập` : zTD ? 'sập từ vùng OB / FVG bán' : nearR ? `sập từ kháng cự ${res1?.toFixed(4)}` : 'nối xu hướng sau nhịp hồi'))
    : kind === 3 ? `hồi về EMA 21 (${ce1[n].toFixed(4)}) rồi bật lại, EMA xếp ${dir > 0 ? 'tăng' : 'giảm'}, ADX ${adx.toFixed(0)}`
    : kind === 4 ? (dir > 0 ? pkSU : pkSD)
    : (dir > 0 ? (oiBoU ? `phá mốc kèm OI 4 nến +${oiS4[n].toFixed(1)}% (tiền mới vào)` : 'nến xác nhận sau cú xả đòn bẩy')
               : (oiBoD ? `thủng mốc kèm OI 4 nến +${oiS4[n].toFixed(1)}% (tiền mới vào)` : 'nến xác nhận sau cú xả đòn bẩy'));
  out.sig = { dir, kind, kindName: KIND[kind], why, score: sc.s, grade: sc.grade, whyList: sc.why, lv, isBO, ...pl };
  return out;
}
