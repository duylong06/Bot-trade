// core/score.js — Thang chấm điểm 100 điểm, 6 cờ đỏ, khoá Stoch, phân loại SCALP/INTRADAY/SWING và TP/SL
// theo prompt V8.0 (module 3–6). Không gọi mạng: dữ liệu do bot tải sẵn (bot/context.mjs).
//
// Đầu vào:
//   e  sự kiện trendline của bot: { type, dir, tf, t, close, linePrice, atr, line, bar, vol, m30, nextBar, entry }
//   D  dữ liệu đồng đó: { coin, K: { '1M','1W','1D','4H','1H','30m','15m' }, oi, taker, book, ctVal, ticker, vol1D, btc }
//   M  bối cảnh thị trường: { scenario, blackout, flow, whale, insight, btc }
// Trả về { score, grade, rank, enter, layers, flags, locks, warns, style, entry, sl, tp1, tp2, rr, ... }.

import {
  ema, sma, atr, rsi, adx, dualStoch, pivots, structure, fvgs, orderBlocks, candlePattern, divergence, nuocRut,
  liquidityPools, purpleBoxes, rhythm, macroTrend, fibOfLastLeg,
} from './ta.js';
import { liqMap } from './liqmap.js';
import { lineAt } from './breakout.js';

const HOUR = 3600e3;
export const STEP = { '15m': HOUR / 4, '30m': HOUR / 2, '1H': HOUR, '4H': 4 * HOUR, '1D': 24 * HOUR, '1W': 7 * 24 * HOUR, '1M': 30 * 24 * HOUR };
export const STYLE = {
  SCALP: { label: 'SCALP', vi: 'Lướt sóng nhanh', trendTf: '1H', confTf: '4H', buf: 0.30, minRisk: 0.8, timeStop: 16, timeStopTp1: 32, liqH: 24, flowH: 4, cvdH: 3 },
  INTRADAY: { label: 'INTRADAY', vi: 'Trong ngày', trendTf: '4H', confTf: '1D', buf: 0.40, minRisk: 0.6, timeStop: 60, timeStopTp1: 60, liqH: 72, flowH: 12, cvdH: 6 },
  SWING: { label: 'SWING', vi: 'Giữ vài ngày/tuần', trendTf: '1D', confTf: '1W', buf: 0.50, minRisk: 0.6, timeStop: 240, timeStopTp1: 240, liqH: 168, flowH: 24, cvdH: 12 },
};
export const GRADES = ['C', 'B', 'A', 'S+', 'S++'];
const gradeOf = s => s >= 92 ? 'S++' : s >= 88 ? 'S+' : s >= 80 ? 'A' : s >= 70 ? 'B' : 'C';
const last = a => a[a.length - 1];
const fin = x => typeof x === 'number' && isFinite(x);
const pct = x => (x * 100).toFixed(2) + '%';

// Cắt chuỗi nến: chỉ giữ nến đã đóng tới thời điểm asOf.
export function cutAt(K, tf, asOf) {
  if (!K || !K.t || !K.t.length) return null;
  const step = STEP[tf] || HOUR;
  let n = K.t.length;
  while (n > 0 && K.t[n - 1] + step > asOf) n--;
  if (n === K.t.length) return K;
  const s = a => a.slice(0, n);
  return { t: s(K.t), o: s(K.o), h: s(K.h), l: s(K.l), c: s(K.c), v: s(K.v) };
}

/* ---------- bối cảnh thị trường: ma trận BTC.D × USDT.D (prompt 2.3) ---------- */

/**
 * dom: { dBtc, dUsdt } — biến động 24h (điểm %) của BTC.D và USDT.D; btcChg: % thay đổi BTC 24h.
 */
export function domScenario(dom, btcChg) {
  if (!dom || !fin(dom.dBtc) || !fin(dom.dUsdt)) return { id: 0, text: 'chưa đủ dữ liệu BTC.D/USDT.D (cần 24 giờ lưu)', riskOff: false, altLong: 0, btcLong: 0 };
  const uUp = dom.dUsdt >= 0.10, uDn = dom.dUsdt <= -0.10, bUp = dom.dBtc >= 0.15, bDn = dom.dBtc <= -0.15;
  const btcUp = btcChg >= 0.005, btcDn = btcChg <= -0.005, btcFlat = !btcUp && !btcDn;
  if (uUp && btcDn) return { id: 3, text: 'RISK-OFF: USDT.D tăng + BTC giảm — tiền tháo về USDT. Khoá LONG toàn thị trường, chỉ canh SHORT', riskOff: true, altLong: -1, btcLong: -1 };
  if (uDn && bDn && !btcDn) return { id: 1, text: 'USDT.D giảm + BTC.D giảm + BTC tăng/ngang — tiền chảy sang Altcoin: ưu tiên LONG Altcoin', riskOff: false, altLong: 1, btcLong: 0 };
  if (uDn && bUp && btcUp) return { id: 2, text: 'USDT.D giảm + BTC.D tăng + BTC tăng — BTC hút máu: ưu tiên LONG BTC, hạn chế Long Altcoin yếu', riskOff: false, altLong: -0.5, btcLong: 1 };
  if (uUp && !btcDn) return { id: 4, text: 'Phân kỳ ngầm: USDT.D tăng mà BTC không giảm — Altcoin đang bị xả âm thầm: cấm Long Altcoin', riskOff: false, altLong: -1, btcLong: 0 };
  if (uDn && btcFlat) return { id: 5, text: 'Phân kỳ ngầm: USDT.D giảm mà BTC đi ngang — tiền đang âm thầm gom Altcoin', riskOff: false, altLong: 1, btcLong: 0 };
  return { id: 0, text: 'Trung tính (BTC.D, USDT.D chưa biến động đáng kể)', riskOff: false, altLong: 0, btcLong: 0 };
}

/* ---------- chấm điểm một sự kiện ---------- */

export function scoreEvent(e, D, M = {}, asOf = Date.now()) {
  const s = e.dir === 'LONG' ? 1 : -1, tf = e.tf || '1H';
  const notes = [], warns = [], flags = [], locks = [];
  const K = {};
  for (const k of Object.keys(D.K || {})) K[k] = cutAt(D.K[k], k, asOf);
  const Kc = K[tf];
  if (!Kc || Kc.c.length < 60) return { error: 'thiếu nến khung ' + tf };
  const n = Kc.c.length - 1;
  let ie = Kc.t.indexOf(e.t); if (ie < 0) ie = n;
  const A = atr(Kc, 14), a = e.atr || A[ie] || A[n];
  const isBtc = D.coin === 'BTC', isAlt = !isBtc && !['XAU', 'CL', 'XAG', 'BZ'].includes(D.coin);
  const entry = fin(e.entry) ? e.entry : e.close;
  const lineNow = e.line && fin(e.line.pa) ? lineAt(e.line, Kc.t[n]) : e.linePrice;

  /* ---- phong cách: SCALP (30m) / INTRADAY (1H, 4H) / SWING (khi đủ điều kiện) ---- */
  let styleKey = tf === '30m' || tf === '15m' ? 'SCALP' : 'INTRADAY';
  const mt1D = K['1D'] ? macroTrend(K['1D']) : { bias: 0, g1: 0, strong: false };
  const adx1D = K['1D'] && K['1D'].c.length > 40 ? last(adx(K['1D']).adx) : null;
  const rh = {};
  for (const f of ['1M', '1W', '1D', '4H', '1H']) rh[f] = K[f] ? rhythm(K[f]) : 0;

  /* ---- TP/SL (cần trước để xét SWING: R:R ≥ 3) ---- */
  const plan = planTrade(e, Kc, ie, n, a, s, entry, K, D, M, styleKey);
  const swingOk = tf !== '30m' && mt1D.strong && mt1D.bias === s && fin(adx1D) && adx1D >= 25 && rh['1W'] === s && rh['1D'] === s && rh['4H'] === s && plan.rr >= 3;
  if (swingOk) styleKey = 'SWING';
  const ST = STYLE[styleKey];
  const P = swingOk ? planTrade(e, Kc, ie, n, a, s, entry, K, D, M, styleKey) : plan;
  const trendK = tf === '4H' && styleKey === 'INTRADAY' ? K['1D'] : K[ST.trendTf];
  const confK = tf === '4H' && styleKey === 'INTRADAY' ? K['1W'] : K[ST.confTf];
  const trendTf = tf === '4H' && styleKey === 'INTRADAY' ? '1D' : ST.trendTf, confTf = tf === '4H' && styleKey === 'INTRADAY' ? '1W' : ST.confTf;

  /* ---- Lớp 1 (20): đồng thuận đa khung ---- */
  const L1 = { name: 'Đồng thuận đa khung', max: 20, pts: 0, notes: [] };
  const mt = trendK ? macroTrend(trendK) : { bias: 0, g1: 0, above200: null };
  if (mt.short) L1.notes.push(`khung ${trendTf} chưa đủ 150 nến`);
  const stackOk = mt.bias === s, e200Ok = mt.above200 === null ? false : (s > 0 ? mt.above200 : !mt.above200);
  if (stackOk && e200Ok) { L1.pts += 10; L1.notes.push(`${trendTf}: EMA21/55/144 xếp tầng ${s > 0 ? 'tăng' : 'giảm'} + giá ${s > 0 ? 'trên' : 'dưới'} EMA200 (+10)`); }
  else if (stackOk) { L1.pts += 6; L1.notes.push(`${trendTf}: EMA xếp tầng thuận, giá chưa ${s > 0 ? 'trên' : 'dưới'} EMA200 (+6)`); }
  else if (e200Ok) { L1.pts += 4; L1.notes.push(`${trendTf}: giá ${s > 0 ? 'trên' : 'dưới'} EMA200, EMA chưa xếp tầng (+4)`); }
  else L1.notes.push(`${trendTf}: EMA ${mt.bias === -s ? 'xếp tầng NGƯỢC hướng' : 'chưa xếp tầng'} (0)`);
  const frames = (tf === '4H' ? ['1M', '1W', '1D', '4H'] : ['1M', '1W', '1D', '4H', '1H']);
  const agree = frames.filter(f => rh[f] === s).length, against = frames.filter(f => rh[f] === -s).length;
  const rConf = confK ? rhythm(confK) : 0;
  let r5 = 0;
  if (rConf === s) r5 += 3; else if (rConf === 0) r5 += 1;
  if (agree > against && agree >= Math.ceil(frames.length / 2)) r5 += 2;
  L1.pts += r5;
  L1.notes.push(`nhịp ngắn ${frames.map(f => f.replace('1M', 'M').replace('1W', 'W') + (rh[f] > 0 ? '↑' : rh[f] < 0 ? '↓' : '→')).join(' ')} · khung xác nhận ${confTf} ${rConf > 0 ? '↑' : rConf < 0 ? '↓' : '→'} (+${r5})`);
  const adxT = trendK && trendK.c.length > 40 ? last(adx(trendK).adx) : null;
  if (fin(adxT) && adxT >= 22) { L1.pts += 5; L1.notes.push(`ADX ${trendTf} ${adxT.toFixed(0)} ≥ 22 (+5)`); }
  else if (fin(adxT) && adxT >= 18) { L1.pts += 2; L1.notes.push(`ADX ${trendTf} ${adxT.toFixed(0)} (+2)`); }
  else L1.notes.push(`ADX ${trendTf} ${fin(adxT) ? adxT.toFixed(0) : '—'} < 18 (0)`);

  /* ---- Dual Stoch trên khung tín hiệu: trạng thái + khoá (prompt 4.2) ---- */
  const ds = dualStoch(Kc), adxC = adx(Kc).adx;
  const sk = ds.slowK[n], sd = ds.slowD[n], fk = ds.fastK[n], fd = ds.fastD[n], aF = ds.angFast[n], aS = ds.angSlow[n];
  const e200c = ema(Kc.c, 200)[n];
  const run = (cond, k = 3) => { for (let j = n - k + 1; j <= n; j++) if (j < 0 || !cond(j)) return false; return true; };
  const topPinned = run(j => ds.slowK[j] >= 80 && ds.fastK[j] >= 75) || (fin(e200c) && Kc.c[n] > e200c && fin(aS) && aS >= 60);
  const botPinned = run(j => ds.slowK[j] <= 20 && ds.fastK[j] <= 25) || (fin(e200c) && Kc.c[n] < e200c && fin(aS) && aS <= -60);
  const stC = structure(Kc, 5);
  if (topPinned) {
    if (s < 0) locks.push({ code: 'TOP_PINNED', text: `Stoch ghim đỉnh (32/13/5 ≥ 80, 10/5/5 ≥ 75) — khoá SHORT chặn tàu` });
    else locks.push({ code: 'FOMO', text: 'Cả 2 Stoch neo đỉnh — khoá LONG đuổi giá (chờ nhịp chỉnh: 10/5/5 rơi về < 20–25 rồi cắt lên)' });
  }
  if (botPinned && s > 0) {
    const unlock = divergence(Kc, ds.fastK, 1) && sk > 22 && stC.lastBreak && stC.lastBreak.dir === 1 && stC.lastBreak.kind === 'CHoCH' && n - stC.lastBreak.i <= 20;
    if (!unlock) locks.push({ code: 'BOTTOM_PINNED', text: 'Stoch ghim đáy — khoá LONG bắt đáy (cần phân kỳ dương + 32/13/5 vượt 22 + CHoCH)' });
  }
  const adxNow = adxC[n];
  if (fin(sk) && sk >= 35 && sk <= 65 && fin(aS) && Math.abs(aS) < 20 && fin(aF) && Math.abs(aF) < 30 && fin(adxNow) && adxNow < 20)
    locks.push({ code: 'CHOPPY', text: `Stoch lờ đờ giữa (32/13/5 = ${sk.toFixed(0)}, ADX ${adxNow.toFixed(0)} < 20) — thị trường nhiễu, khoá mọi tín hiệu` });
  if (fin(aF) && Math.abs(aF) >= 70 && Math.sign(aF) === -s)
    locks.push({ code: 'VERTICAL', text: `Stoch 10/5/5 lao thẳng đứng ${aF > 0 ? 'lên' : 'xuống'} (${aF.toFixed(0)}°) — cấm đánh ngược chiều` });

  /* ---- Lớp 2 (20): Dual Stoch & góc dốc ---- */
  const L2 = { name: 'Dual Stochastic & góc dốc', max: 20, pts: 0, notes: [] };
  const slowRight = s > 0
    ? (sk >= sd && sk < 80) || (sk > 55 && !topPinned)
    : (sk <= sd && sk > 20) || (sk < 45 && !botPinned);
  if (fin(sk) && slowRight && !locks.some(l => l.code === 'BOTTOM_PINNED' || l.code === 'TOP_PINNED')) { L2.pts += 10; L2.notes.push(`32/13/5 = ${sk.toFixed(0)} đúng vị thế ${s > 0 ? 'Long' : 'Short'} (+10)`); }
  else if (fin(sk) && (s > 0 ? sk >= sd : sk <= sd)) { L2.pts += 5; L2.notes.push(`32/13/5 = ${sk.toFixed(0)} đang ${s > 0 ? 'quay lên' : 'quay xuống'} (+5)`); }
  else L2.notes.push(`32/13/5 = ${fin(sk) ? sk.toFixed(0) : '—'} chưa ủng hộ (0)`);
  let cross = -1;
  for (let j = n; j >= Math.max(1, n - 3); j--) {
    if (!fin(ds.fastK[j]) || !fin(ds.fastD[j]) || !fin(ds.fastK[j - 1]) || !fin(ds.fastD[j - 1])) continue;
    const was = (ds.fastK[j - 1] - ds.fastD[j - 1]) * s, now = (ds.fastK[j] - ds.fastD[j]) * s;
    if (was <= 0 && now > 0) { cross = j; break; }
  }
  const fromExt = cross >= 0 && (s > 0 ? Math.min(ds.fastK[cross - 1], ds.fastK[cross]) < 25 : Math.max(ds.fastK[cross - 1], ds.fastK[cross]) > 75);
  const angOk = fin(aF) && aF * s >= 35 && aF * s <= 68;
  if (cross >= 0 && fromExt && angOk) { L2.pts += 10; L2.notes.push(`10/5/5 cắt ${s > 0 ? 'lên từ < 25' : 'xuống từ > 75'}, góc ${aF.toFixed(0)}° (+10)`); }
  else if (angOk) { L2.pts += 6; L2.notes.push(`10/5/5 dốc ${aF.toFixed(0)}° thuận chiều (+6)`); }
  else if (fin(fk) && (fk - fd) * s > 0) { L2.pts += 3; L2.notes.push(`10/5/5 = ${fk.toFixed(0)} trên đường tín hiệu thuận chiều, góc ${fin(aF) ? aF.toFixed(0) : '—'}° (+3)`); }
  else L2.notes.push(`10/5/5 = ${fin(fk) ? fk.toFixed(0) : '—'} chưa cắt thuận chiều (0)`);

  /* ---- Lớp 3 (20): cấu trúc trendline + Hộp Tím + nến 2 ---- */
  const L3 = { name: 'Trendline râu nến & Hộp Tím', max: 20, pts: 0, notes: [] };
  const L = e.line || {};
  if ((L.touches || 0) >= 3) { L3.pts += 7; L3.notes.push(`${L.kind || 'đường'} ${L.span} nến, ${L.touches} chạm, không cắt thân (+7)`); }
  else { L3.pts += 4; L3.notes.push(`${L.kind || 'đường'} ${L.span || '—'} nến, ${L.touches || 2} chạm (+4)`); }
  const boxes = purpleBoxes(cutAt(Kc, tf, Kc.t[Math.max(0, ie - 1)] + (STEP[tf] || HOUR)) || Kc, A);
  const pools = liquidityPools(cutAt(Kc, tf, Kc.t[Math.max(0, ie - 1)] + (STEP[tf] || HOUR)) || Kc, A);
  const lp = e.linePrice;
  const inBox = boxes.find(b => lp >= b.bot - 0.3 * a && lp <= b.top + 0.3 * a);
  const tookPool = pools.find(p => p.alive && p.side === (s > 0 ? 'high' : 'low') && (e.close - p.level) * s > 0 && Math.abs(p.level - lp) <= 1.5 * a);
  if (inBox || tookPool) { L3.pts += 6; L3.notes.push(inBox ? `điểm phá trùng Hộp Tím ${inBox.poc ? '(có POC)' : ''} (+6)` : `phá luôn ổ thanh khoản 💧 ${tookPool.n} ${s > 0 ? 'đỉnh' : 'đáy'} bằng nhau (+6)`); }
  else L3.notes.push('không có Hộp Tím / ổ thanh khoản tại điểm phá (0)');
  // Nến 2 xác nhận
  const c2 = candle2(e, Kc, ie, n, s, K, a);
  if (c2.ok && c2.strong) { L3.pts += 7; L3.notes.push(`${c2.text} + Stoch dốc thuận + volume ≥ 1,2× (+7)`); }
  else if (c2.ok) { L3.pts += 4; L3.notes.push(`${c2.text} (+4)${c2.miss ? ' — thiếu: ' + c2.miss : ''}`); }
  else L3.notes.push(`${c2.text} (0)`);
  // Thưởng cấu trúc trưởng thành: H1 45–90 nến, ≥ 3 chạm, phá cùng EMA200 ở nến xác nhận
  const e200 = ema(Kc.c, 200);
  if (tf === '1H' && L.span >= 45 && L.span <= 90 && L.touches >= 3 && c2.ok && fin(e200[ie]) && ie > 0 && fin(e200[ie - 1])) {
    const before = (Kc.c[ie - 1] - e200[ie - 1]) * s <= 0, after = ((c2.close ?? Kc.c[n]) - e200[n]) * s > 0;
    if (before && after) { L3.pts = 20; L3.notes.push('Thưởng cấu trúc trưởng thành: H1 45–90 nến, ≥ 3 chạm, phá cùng EMA200 ở nến xác nhận (20/20)'); }
  }
  L3.pts = Math.min(20, L3.pts);

  /* ---- Lớp 4 (15): SMC & Price Action ---- */
  const L4 = { name: 'Hợp lưu SMC & Price Action', max: 15, pts: 0, notes: [] };
  const fv = fvgs(Kc).filter(z => z.dir === s && entry >= z.bot - 0.25 * a && entry <= z.top + 0.25 * a);
  const ob = orderBlocks(Kc, A).filter(z => z.dir === s && entry >= z.bot - 0.25 * a && entry <= z.top + 0.25 * a);
  const fib = fibOfLastLeg(Kc, s);
  const ote = fib && fib.retr >= 0.618 && fib.retr <= 0.79;
  if (fv.length || ob.length || ote) { L4.pts += 8; L4.notes.push(`giá vào nằm trong ${[fv.length && 'FVG chưa lấp', ob.length && 'Order Block', ote && `OTE ${fib.retr.toFixed(2)}`].filter(Boolean).join(' + ')} (+8)`); }
  else L4.notes.push('giá vào không nằm trong OTE / OB / FVG (0)');
  const pat = candlePattern(Kc, n, s, A) || (ie !== n ? candlePattern(Kc, ie, s, A) : null);
  const rs14 = rsi(Kc.c, 14);
  const div = divergence(Kc, ds.fastK, s) || divergence(Kc, rs14, s);
  if (pat || div) { L4.pts += 4; L4.notes.push(`${[pat, div && 'phân kỳ Stoch/RSI'].filter(Boolean).join(' + ')} (+4)`); }
  else L4.notes.push('không có mẫu nến đảo chiều / phân kỳ (0)');
  const lastTouch = L.tTouch && L.tTouch.length ? Kc.t.indexOf(last(L.tTouch)) : -1;
  const nrFrom = Math.max(ie - 30, lastTouch >= 0 ? lastTouch : ie - 30), nr = nuocRut(Kc, s, nrFrom, Math.max(nrFrom, ie - 1));
  if (nr < 0) { L4.pts += 3; L4.notes.push('không dính nến nước rút ngược chiều (+3)'); }
  else {
    L4.notes.push(`có nến nước rút ${s > 0 ? 'đỏ' : 'xanh'} volume > 2,5× lúc ${new Date(Kc.t[nr] + 7 * HOUR).toISOString().slice(11, 16)} (0)`);
    if (e.type === 'RETEST') locks.push({ code: 'NUOC_RUT', text: `Nhịp hồi có nến nước rút ${s > 0 ? 'xả' : 'bơm'} mạnh ngược chiều — chặn lệnh bắt hồi` });
  }

  /* ---- Lớp 5 (15): dòng tiền phái sinh & thanh khoản ---- */
  const L5 = { name: 'Dòng tiền phái sinh & thanh khoản', max: 15, pts: 0, notes: [] };
  const vr = e.vol;
  const tk = (D.taker || []).filter(r => r[0] + HOUR <= asOf).slice(-ST.cvdH);
  const cvd = tk.reduce((t, r) => t + (r[1] - r[2]), 0);
  const cvdOk = tk.length && Math.sign(cvd) === s;
  let v5 = (fin(vr) && vr >= 1.3 ? 3 : 0) + (cvdOk ? 2 : 0);
  L5.pts += v5;
  L5.notes.push(`volume ${fin(vr) ? vr.toFixed(1) + '×' : '—'} MA20${fin(vr) && vr >= 1.3 ? ' ✓' : ''} · CVD ${ST.cvdH}h ${tk.length ? (cvd >= 0 ? 'mua chủ động' : 'bán chủ động') : 'không có'}${cvdOk ? ' ✓' : ''} (+${v5})`);
  const oi = (D.oi || []).filter(r => r[0] <= asOf);
  const K1 = K['1H'];
  let quad = null;
  if (oi.length > ST.flowH && K1 && K1.c.length > ST.flowH) {
    const o1 = last(oi)[1], o0 = oi[oi.length - 1 - ST.flowH][1];
    const p1 = last(K1.c), p0 = K1.c[K1.c.length - 1 - ST.flowH];
    const dOi = (o1 - o0) / Math.max(o0, 1), dP = (p1 - p0) / Math.max(p0, 1e-10);
    const oiUp = dOi > 0.003, oiDn = dOi < -0.003;
    quad = dP >= 0 ? (oiUp ? 'LONG_BUILD' : oiDn ? 'SHORT_COVER' : 'FLAT') : (oiUp ? 'SHORT_BUILD' : oiDn ? 'LONG_LIQ' : 'FLAT');
    const qTxt = { LONG_BUILD: '🟢 Giá ↑ + OI ↑: tiền mới vào cửa mua', SHORT_BUILD: '🔴 Giá ↓ + OI ↑: tiền mới vào cửa bán', SHORT_COVER: '🟡 Giá ↑ + OI ↓: Short bị ép đóng, thiếu tiền mua mới', LONG_LIQ: '⚪ Giá ↓ + OI ↓: tiền rút, đà giảm sắp cạn', FLAT: 'OI đi ngang' }[quad];
    const good = (s > 0 && quad === 'LONG_BUILD') || (s < 0 && quad === 'SHORT_BUILD');
    const pts = good ? 5 : quad === 'FLAT' ? 2 : 0;
    L5.pts += pts;
    L5.notes.push(`${qTxt} (${ST.flowH}h: giá ${pct(dP)}, OI ${pct(dOi)}) (+${pts})`);
    if (s > 0 && quad === 'SHORT_COVER') locks.push({ code: 'NO_CHASE_LONG', text: 'Giá ↑ + OI ↓ (Short cover) — cấm LONG đuổi' });
    if (s < 0 && quad === 'LONG_LIQ') locks.push({ code: 'NO_CHASE_SHORT', text: 'Giá ↓ + OI ↓ (Long thanh lý) — cấm SHORT đuổi ở đáy' });
  } else L5.notes.push('chưa lấy được OI để xét ma trận Giá × OI (0)');
  let lm = null;
  if (K1 && oi.length > 24) {
    lm = liqMap(K1, oi, ST.liqH);
    const sweptOpp = s > 0 ? lm.sweptLong : lm.sweptShort;
    const toward = (s > 0 && lm.magnet === 'up') || (s < 0 && lm.magnet === 'down');
    const swept = sweptPool(Kc, A, s);
    if (sweptOpp || toward || swept) {
      L5.pts += 5;
      L5.notes.push(`${[sweptOpp && `vừa quét cụm thanh lý ${s > 0 ? 'Long' : 'Short'} lớn`, swept && 'vừa quét ổ thanh khoản 💧 rồi rút chân', toward && `nam châm thanh lý ${s > 0 ? 'phía trên' : 'phía dưới'}${(s > 0 ? lm.upPeakAt : lm.dnPeakAt) ? ' ~' + (s > 0 ? lm.upPeakAt : lm.dnPeakAt).toPrecision(6) : ''}`].filter(Boolean).join(' + ')} (+5)`);
    } else L5.notes.push(`nam châm thanh lý ${lm.magnet === 'none' ? 'cân bằng' : lm.magnet === 'up' ? 'phía trên' : 'phía dưới'} — chưa thuận (0)`);
  } else L5.notes.push('chưa đủ OI để dựng bản đồ thanh lý (0)');

  /* ---- Lớp 6 (10): on-chain & vĩ mô ---- */
  const L6 = { name: 'On-chain ví cá voi & vĩ mô', max: 10, pts: 0, notes: [] };
  const fl = M.flow || {};
  const bias = fin(fl.bias) ? fl.bias : 0;
  const fp = bias * s >= 2 ? 5 : Math.abs(bias) < 2 ? 2 : 0;
  L6.pts += fp;
  L6.notes.push(`dòng tiền sàn (ví 28c / TDqSq / BTC netflow / whale alert): ${bias > 0 ? 'nghiêng tăng' : bias < 0 ? 'nghiêng giảm' : 'trung tính'} ${bias ? '(' + (bias > 0 ? '+' : '') + bias + ')' : ''} (+${fp})`);
  const sc = M.scenario || { id: 0, altLong: 0, btcLong: 0 };
  const favor = s > 0 ? (isAlt ? sc.altLong : sc.btcLong) : (sc.riskOff ? 1 : -(isAlt ? sc.altLong : sc.btcLong));
  const bo = M.blackout && M.blackout.active;
  const mp = bo ? 0 : favor > 0 ? 5 : favor === 0 ? 3 : 0;
  L6.pts += mp;
  L6.notes.push(`ma trận BTC.D × USDT.D: ${sc.text || '—'}${bo ? ` · đang trong giờ tin Đỏ (${M.blackout.title})` : ''} (+${mp})`);
  if (bo) locks.push({ code: 'BLACKOUT', text: `Tin Đỏ ${M.blackout.title} lúc ${M.blackout.hhmm} — đóng băng lệnh mới ±45 phút` });

  /* ---- cảnh báo phụ (module 1) ---- */
  const tick = D.ticker || {};
  const spread = tick.ask > 0 && tick.bid > 0 ? (tick.ask - tick.bid) / tick.bid : null;
  if (fin(spread) && spread > 0.0005) warns.push(`Spread ${(spread * 100).toFixed(3)}% > 0,05% — dễ trượt giá`);
  if (fin(tick.volUsd) && tick.volUsd < 25e6) warns.push(`Khối lượng 24h ${(tick.volUsd / 1e6).toFixed(1)}M$ < 25M$ — thanh khoản mỏng`);
  if (K['4H'] && K['4H'].c.length < 250) warns.push('Mới niêm yết: chưa đủ 250 nến 4H — EMA144/200 chưa chuẩn');
  if (K1 && K1.c.length > 2) { const j = K1.c.length - 1; if ((K1.h[j] - K1.l[j]) / Math.max(K1.l[j], 1e-10) > 0.15) warns.push('Nến H1 biên độ > 15% — đang bơm/xả hỗn loạn'); }
  // Altcoin đi đường riêng / ngược sóng
  let rieng = false, nguoc = false;
  const btc = D.btc || {};
  if (isAlt && K['1D'] && btc.K1D) {
    const rs = relStrength(K['1D'], btc.K1D, 14), rs30 = relStrength(K['1D'], btc.K1D, 30);
    const st4 = K['4H'] ? structure(K['4H'], 5) : null;
    if (fin(rs) && fin(rs30) && rs * s >= 0.10 && rs30 * s >= 0.10 && st4 && st4.trend === s) { rieng = true; notes.push(`Altcoin đi đường riêng: mạnh/yếu hơn BTC ${pct(rs)} (14 ngày), ${pct(rs30)} (30 ngày), cấu trúc 4H riêng thuận chiều`); }
    const btcChg = btc.chg24 ?? 0, chg = tick.chg ?? 0;
    const v7 = (D.vol1D || []).slice(-8, -1), avg7 = v7.length ? v7.reduce((x, y) => x + y, 0) / v7.length : null;
    const oiUp24 = oi.length > 24 ? (last(oi)[1] - oi[oi.length - 25][1]) / Math.max(oi[oi.length - 25][1], 1) : null;
    if (btcChg <= 0.005 && chg >= 0.10 && ((fin(tick.volUsd) && tick.volUsd >= 15e6 && avg7 && tick.volUsd >= 2 * avg7) || (fin(oiUp24) && oiUp24 >= 0.20))) {
      nguoc = true;
      warns.push('⚠️ COIN NGƯỢC SÓNG: BTC giảm/đi ngang mà coin bơm ≥ 10% kèm volume/OI đột biến — dễ quét râu 2 đầu. Độ tự tin tối đa 5/10, giảm 50% khối lượng');
    }
    if (!rieng && btc.trend1D && btc.trend1D === -s) warns.push(`Ngược hướng BTC 1D (BTC đang ${btc.trend1D > 0 ? 'tăng' : 'giảm'}) — altcoin nên thuận BTC`);
  }

  /* ---- 6 cờ đỏ (prompt 6.2) ---- */
  if (P.rr < 1.5) flags.push({ code: 'RR_FLOOR', text: `R:R tới TP1 = ${P.rr.toFixed(2)} < 1,5` });
  if (mt.bias === -s) {
    const chain = reversalChain(Kc, A, s, ds, rs14);
    if (!chain.ok) flags.push({ code: 'TREND_CONFLICT', text: `Xu hướng ${trendTf} đang ${s > 0 ? 'GIẢM' : 'TĂNG'} mà báo ${s > 0 ? 'LONG' : 'SHORT'}, chưa đủ chuỗi đảo chiều 4 bước (thiếu: ${chain.miss.join(', ')})` });
  }
  if (s > 0 && sc.riskOff && !(isAlt && rieng)) flags.push({ code: 'RISK_OFF', text: 'RISK-OFF (USDT.D tăng + BTC 1D giảm) mà báo LONG' });
  else if (s > 0 && isAlt && sc.altLong < 0 && sc.id === 4 && !rieng) flags.push({ code: 'RISK_OFF', text: 'USDT.D tăng mà BTC không giảm — Altcoin đang bị xả âm thầm, cấm LONG Altcoin' });
  if (s > 0) {
    const w = (M.whale || {})[D.coin], th = isBtc || D.coin === 'ETH' ? 150e6 : 25e6;
    const ins = (M.insight || {})[D.coin];
    const btcIn = isBtc && fl.btcEx2h >= 150e6;
    if ((w && w.in12 >= th) || ins || btcIn)
      flags.push({ code: 'WHALE_DUMP', text: ins ? `Kênh on-chain báo cá voi xả ${D.coin} trong 12 giờ qua: “${ins.text.slice(0, 90)}…”` : btcIn ? `Ví sàn nhận thêm ${(fl.btcEx2h / 1e6).toFixed(0)}M$ BTC trong 2 giờ — cá mập nạp BTC lên sàn` : `Cá voi nạp ${(w.in12 / 1e6).toFixed(0)}M$ ${D.coin} lên sàn trong 12 giờ qua` });
  }
  if (styleKey === 'SCALP') {
    const K15 = K['15m'], e20 = K15 ? last(ema(K15.c, 20)) : null;
    if (fin(e20) && Math.abs(entry - e20) / e20 > 0.02) flags.push({ code: 'LATE_ENTRY', text: `Vào trễ: giá cách EMA20 khung 15m ${pct(Math.abs(entry - e20) / e20)} > 2%` });
  } else if (fin(lineNow) && Math.abs(entry - lineNow) > 1.2 * a) flags.push({ code: 'LATE_ENTRY', text: `Vào trễ: giá cách điểm phá ${(Math.abs(entry - lineNow) / a).toFixed(1)} ATR > 1,2 ATR` });
  const slCap = tf === '4H' ? 0.064 : 0.032;
  if (P.riskPct > slCap) flags.push({ code: 'WIDE_SL', text: `SL rộng ${pct(P.riskPct)} > ${pct(slCap)}` });
  if (P.wall) flags.push({ code: 'WALL', text: `Sổ lệnh OKX có tường ${s > 0 ? 'bán' : 'mua'} lớn ~${P.wall.usd >= 1e6 ? (P.wall.usd / 1e6).toFixed(1) + 'M$' : (P.wall.usd / 1e3).toFixed(0) + 'K$'} tại ${P.wall.px.toPrecision(6)}, chặn trước TP1` });

  /* ---- tổng điểm, hạng ---- */
  const layers = [L1, L2, L3, L4, L5, L6];
  const score = Math.round(layers.reduce((t, x) => t + x.pts, 0));
  let grade = gradeOf(score);
  const downs = [];
  if (rConf === -s) downs.push(`ngược khung xác nhận ${confTf}`);
  if (fin(adxNow) && adxNow < 20) downs.push(`ADX ${tf} ${adxNow.toFixed(0)} < 20 (đi ngang)`);
  if (downs.length) grade = GRADES[Math.max(0, GRADES.indexOf(grade) - 1)];
  const enter = (grade === 'S++' || grade === 'S+') && !flags.length && !locks.length;
  let conf = Math.max(1, Math.min(10, Math.round(score / 10)));
  if (nguoc) conf = Math.min(conf, 5);
  let risk = grade === 'S++' ? 1.0 : grade === 'S+' ? 0.75 : 0;
  if (nguoc) risk /= 2; else if (rieng) risk *= 0.75;

  return {
    v: 1, score, grade, enter, downs, layers: layers.map(x => ({ name: x.name, pts: x.pts, max: x.max, notes: x.notes })),
    flags, locks, warns, notes, style: styleKey, styleVi: STYLE[styleKey].vi, trendTf, confTf,
    entry, sl: P.sl, tp1: P.tp1, tp2: P.tp2, rr: P.rr, riskPct: P.riskPct, tp1Why: P.tp1Why,
    risk: enter ? risk : 0, conf, rieng, nguoc, quad, magnet: lm ? lm.magnet : null,
    mgmt: mgmtOf(styleKey, s, entry, P.sl, P.tp1, P.tp2),
    timeStopH: STYLE[styleKey].timeStop, timeStopTp1H: STYLE[styleKey].timeStopTp1,
  };
}

/* ---------- TP/SL ---------- */

function planTrade(e, Kc, ie, n, a, s, entry, K, D, M, styleKey) {
  const ST = STYLE[styleKey];
  const X = s > 0 ? Kc.l : Kc.h;
  let ext = X[ie];
  for (let j = ie; j <= n; j++) ext = s > 0 ? Math.min(ext, X[j]) : Math.max(ext, X[j]);
  if (e.type !== 'RETEST' && fin(e.linePrice)) ext = s > 0 ? Math.min(ext, e.linePrice) : Math.max(ext, e.linePrice);
  let sl = ext - s * ST.buf * a;
  if ((entry - sl) * s < ST.minRisk * a) sl = entry - s * ST.minRisk * a;
  const R = (entry - sl) * s;
  // TP1: mốc cấu trúc gần nhất phía trước (đỉnh/đáy swing chưa bị vượt, ổ thanh khoản, đỉnh/đáy ngày & tuần trước, nam châm thanh lý)
  const cands = [];
  const pv = pivots(Kc, 3, 3), Y = s > 0 ? Kc.h : Kc.l;
  for (const i of (s > 0 ? pv.hi : pv.lo)) {
    if (i < Kc.c.length - 300) continue;
    let alive = true;
    for (let j = i + 1; j <= n; j++) if ((Kc.c[j] - Y[i]) * s > 0) { alive = false; break; }
    if (alive) cands.push({ px: Y[i], why: `${s > 0 ? 'đỉnh' : 'đáy'} swing chưa bị vượt` });
  }
  const Ac = atr(Kc, 14);
  for (const p of liquidityPools(Kc, Ac)) if (p.alive && p.side === (s > 0 ? 'high' : 'low')) cands.push({ px: p.level, why: 'ổ thanh khoản 💧' });
  const d1 = K['1D'], w1 = K['1W'];
  if (d1 && d1.c.length) cands.push({ px: s > 0 ? last(d1.h) : last(d1.l), why: s > 0 ? 'đỉnh ngày trước (PDH)' : 'đáy ngày trước (PDL)' });
  if (w1 && w1.c.length) cands.push({ px: s > 0 ? last(w1.h) : last(w1.l), why: s > 0 ? 'đỉnh tuần trước (PWH)' : 'đáy tuần trước (PWL)' });
  const ahead = cands.filter(c => (c.px - entry) * s > 0.25 * a && (c.px - entry) * s <= 12 * a).sort((x, y) => (x.px - y.px) * s);
  let tp1, tp1Why;
  if (ahead.length) { tp1 = ahead[0].px; tp1Why = ahead[0].why; }
  else { tp1 = entry + s * 2 * R; tp1Why = 'không có cản gần phía trước — đặt +2R'; }
  const rr = (tp1 - entry) * s / Math.max(R, 1e-10);
  let tp2 = entry + s * 2.2 * R;
  if ((tp2 - tp1) * s <= 0) { const nx = ahead.find(c => (c.px - tp1) * s > 0.25 * a); tp2 = nx ? nx.px : tp1 + s * R; }
  // tường lệnh trên sổ lệnh OKX giữa giá vào và TP1
  let wall = null;
  const book = D.book;
  if (book && book.asks && book.bids) {
    const side = s > 0 ? book.asks : book.bids;
    const sizes = side.map(r => r[1]).sort((x, y) => x - y), med = sizes[sizes.length >> 1] || 0;
    const ct = D.ctVal || 1;
    for (const [px, sz] of side) {
      if ((px - entry) * s <= 0 || (px - tp1) * s >= 0) continue;
      const usd = px * sz * ct;
      if (sz >= 8 * med && usd >= 250e3 && (!wall || usd > wall.usd)) wall = { px, usd };
    }
  }
  return { sl, tp1, tp2, rr, riskPct: R / entry, R, tp1Why, wall };
}

function mgmtOf(styleKey, s, entry, sl, tp1, tp2) {
  const R = (entry - sl) * s, ST = STYLE[styleKey];
  const half = entry - s * 0.5 * R, be = entry + s * 0.15 * R;
  const out = [
    `+0,6R (${(entry + s * 0.6 * R).toPrecision(6)}): thu hẹp 50% SL → ${half.toPrecision(6)}`,
    `TP1 ${tp1.toPrecision(6)}: chốt 50%, dời SL về ${be.toPrecision(6)} (Entry ${s > 0 ? '+' : '−'} 0,15R, bù phí)`,
    `TP2 ${tp2.toPrecision(6)}: chốt thêm 30%${styleKey === 'SWING' ? '; phần còn lại ôm sóng: lãi ≥ 2% mới trailing, cho hồi 1,2% từ đỉnh' : ''}`,
    `Đóng theo thời gian: ${ST.timeStop} giờ chưa tới TP1 thì đóng hoà vốn${ST.timeStopTp1 !== ST.timeStop ? ` (sau TP1: ${ST.timeStopTp1} giờ)` : ''}`,
  ];
  return out;
}

/* ---------- nến 2 xác nhận (prompt 5.2, kịch bản B) ---------- */

function candle2(e, Kc, ie, n, s, K, a) {
  const vma = sma(Kc.v, 20);
  const check = (Kx, j, y) => {
    const ds = dualStoch(Kx), e200 = ema(Kx.c, 200);
    const stochOk = fin(ds.angFast[j]) && ds.angFast[j] * s >= 35 && fin(ds.angSlow[j]) && ds.angSlow[j] * s > 0;
    const vm = sma(Kx.v, 20)[j - 1], volOk = vm > 0 && Kx.v[j] >= 1.2 * vm;
    const e200Ok = !fin(e200[j]) || (Kx.c[j] - e200[j]) * s > 0;
    const holdOk = !fin(y) || (Kx.c[j] - y) * s > 0;
    const miss = [!stochOk && 'Stoch chưa dốc thuận ≥ 35°', !volOk && 'volume < 1,2×', !e200Ok && 'chưa qua EMA200'].filter(Boolean).join(', ');
    return { strong: stochOk && volOk && e200Ok && holdOk, miss, close: Kx.c[j] };
  };
  if (e.type === 'BREAK') {
    // H1 phá → nến M30 kế tiếp (luật M30 của bot) là nến 2
    if (e.tf === '1H' && e.m30 && typeof e.m30 === 'object' && !e.m30.missing) {
      const K30 = K['30m'];
      const j = K30 ? K30.t.indexOf(e.t + 3600e3) : -1;
      if (j > 0) {
        const r = check(K30, j, e.line ? lineAt(e.line, K30.t[j]) : e.linePrice);
        return { ok: true, strong: r.strong && !e.m30.touch, miss: r.miss, close: r.close, text: `nến M30 kế tiếp đóng giữ ngoài đường${e.m30.touch ? ' (có rút râu)' : ''}` };
      }
      return { ok: true, strong: false, miss: 'không đọc được nến M30', text: 'nến M30 kế tiếp giữ được' };
    }
    if (e.nextBar && n > ie) {
      const r = check(Kc, n, e.line ? lineAt(e.line, Kc.t[n]) : e.linePrice);
      return { ok: true, strong: r.strong, miss: r.miss, close: r.close, text: `nến ${e.tf} thứ 2 đóng tiếp ngoài đường` };
    }
    return { ok: false, text: `chưa có nến 2 xác nhận (vào ở nến phá là dễ dính bẫy — chờ nến ${e.tf === '4H' ? 'H1/H4' : e.tf} kế tiếp giữ ngoài đường)` };
  }
  const r = check(Kc, n, e.linePrice);
  if (e.type === 'RETEST') return { ok: true, strong: r.strong, miss: r.miss, close: r.close, text: 'retest giữ được đường vừa phá' };
  return { ok: true, strong: r.strong, miss: r.miss, close: r.close, text: 'đã gãy cấu trúc (đóng qua đỉnh/đáy cũ)' };
}

/* ---------- tiện ích ---------- */

// Vừa quét ổ thanh khoản rồi rút chân (5 nến gần nhất): râu chọc qua mức đỉnh/đáy bằng nhau, đóng cửa quay vào.
function sweptPool(Kc, A, s) {
  const N = Kc.c.length;
  for (let j = N - 1; j >= Math.max(30, N - 5); j--) {
    const sub = { t: Kc.t.slice(0, j), o: Kc.o.slice(0, j), h: Kc.h.slice(0, j), l: Kc.l.slice(0, j), c: Kc.c.slice(0, j), v: Kc.v.slice(0, j) };
    const pools = liquidityPools(sub, A.slice(0, j)).filter(p => p.alive && p.side === (s > 0 ? 'low' : 'high'));
    for (const p of pools) if (s > 0 ? (Kc.l[j] < p.level && Kc.c[j] > p.level) : (Kc.h[j] > p.level && Kc.c[j] < p.level)) return true;
  }
  return false;
}

// Chuỗi đảo chiều 4 bước (luật Gói 73): Sweep → CHoCH → Climax Volume → Phân kỳ, trong 40 nến gần nhất.
function reversalChain(Kc, A, s, ds, rs14) {
  const N = Kc.c.length, from = Math.max(21, N - 40), vma = sma(Kc.v, 20);
  let sweep = -1;
  for (let j = from; j < N; j++) {
    let ext = s > 0 ? Infinity : -Infinity;
    for (let q = j - 20; q < j; q++) ext = s > 0 ? Math.min(ext, Kc.l[q]) : Math.max(ext, Kc.h[q]);
    if (s > 0 ? (Kc.l[j] < ext && Kc.c[j] > ext) : (Kc.h[j] > ext && Kc.c[j] < ext)) sweep = j;
  }
  const st = structure(Kc, 5);
  const choch = st.breaks.some(b => b.dir === s && b.kind === 'CHoCH' && b.i >= from);
  let climax = false;
  for (let j = Math.max(1, sweep - 3); sweep >= 0 && j <= Math.min(N - 1, sweep + 3); j++) if (vma[j - 1] > 0 && Kc.v[j] >= 1.5 * vma[j - 1]) climax = true;
  const div = divergence(Kc, ds.fastK, s) || divergence(Kc, rs14, s);
  const miss = [sweep < 0 && 'Sweep', !choch && 'CHoCH', !climax && 'Climax Volume', !div && 'Phân kỳ'].filter(Boolean);
  return { ok: !miss.length, miss };
}

// Sức mạnh tương đối ALT/BTC: thay đổi tỷ giá ALT/BTC trong `days` ngày gần nhất.
function relStrength(Ka, Kb, days) {
  const mb = new Map(Kb.t.map((t, i) => [t, Kb.c[i]]));
  const pts = Ka.t.map((t, i) => (mb.has(t) ? Ka.c[i] / mb.get(t) : null)).filter(x => x !== null);
  if (pts.length <= days) return null;
  return last(pts) / pts[pts.length - 1 - days] - 1;
}

/* ---------- gọn để lưu vào signals.json ---------- */

export function compactScore(r) {
  if (!r || r.error) return r ? { err: r.error } : null;
  const P8 = x => (fin(x) ? +x.toPrecision(8) : x);
  return {
    v: 1, s: r.score, g: r.grade, in: r.enter ? 1 : 0, st: r.style, ttf: r.trendTf, ctf: r.confTf,
    L: r.layers.map(x => [x.pts, x.max, x.notes]), f: r.flags.map(x => x.text), k: r.locks.map(x => x.text), w: r.warns, n: r.notes, dn: r.downs,
    en: P8(r.entry), sl: P8(r.sl), tp1: P8(r.tp1), tp2: P8(r.tp2), rr: +r.rr.toFixed(2), rp: +(r.riskPct * 100).toFixed(2), tw: r.tp1Why,
    rk: r.risk, cf: r.conf, mg: r.mgmt, ts: r.timeStopH, ts1: r.timeStopTp1H, q: r.quad, mag: r.magnet,
  };
}
