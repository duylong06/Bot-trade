/*
 * core/breakout.js — lõi phát hiện phá vỡ đường xu hướng.
 * Dùng chung cho bot (Node, GitHub Actions) và app (trình duyệt) để đường bot báo
 * và đường app vẽ luôn là một.
 *
 * Không gọi mạng, không phụ thuộc thư viện.
 * Đầu vào: nến H1 ĐÃ ĐÓNG, xếp cũ → mới, dạng { t, o, h, l, c, v } (mảng số, t = mili giây).
 *
 * Luật:
 *   - Cửa sổ tối đa 500 nến H1. Đường to hay nhỏ đều xét.
 *   - Đường neo vào RÂU (đỉnh/đáy), nhưng phá vỡ tính bằng GIÁ ĐÓNG CỬA — râu không tính.
 *   - Một cú phá đạt chuẩn khi nến đóng cửa ra ngoài vùng đệm 0,5 ATR và thân nến ≥ 0,5 ATR.
 *     Nếu nến đầu tiên đóng ra ngoài còn yếu (giá trôi qua đường bằng nến nhỏ — hay gặp ở đường dốc),
 *     đường CHƯA bị bỏ: chừng nào giá còn nằm ngoài, bot theo dõi thêm tối đa 4 nến; nến nào đạt chuẩn,
 *     hoặc giá đã cách đường ≥ 1 ATR, thì đó là cú phá. Đóng cửa quay lại trong đường thì đường hết hiệu lực.
 *   - Xác nhận: đóng cửa vượt đỉnh/đáy cuối cùng nằm trên đường (gãy cấu trúc).
 *   - Retest: giá chạy ra xa ít nhất 1 ATR rồi quay về chạm đường và đóng cửa giữ được.
 */

import { TUNE } from './config.js';

const DEFAULTS = {
  WINDOW: 500,        // tối đa 500 nến H1
  WARMUP: 20,         // nến thêm phía trước chỉ để tính ATR cho chuẩn
  PIVOT: 3,           // đỉnh/đáy: cao/thấp nhất trong ±3 nến
  SCALE: 12,          // đường dài S nến chỉ được neo vào đỉnh/đáy lớn: cao/thấp nhất trong ±S/12 nến
  SCALE_MAX: 30,      //   (tối đa ±30 nến); lần chạm thứ ba trở đi chỉ cần một nửa độ lớn đó
  MIN_SPAN: 10,       // hai điểm neo cách nhau tối thiểu 10 nến
  MIN_TOUCH: 3,       // tối thiểu 3 lần chạm (tính cả 2 điểm neo)
  REACT: 1.5,         // giữa hai lần chạm, giá phải bật ra xa đường ≥ 1,5 ATR thì lần sau mới tính là chạm mới
  GAP: 0.08,          // hai lần chạm cách nhau ≥ 8% chiều dài đường (và ≥ 5 nến)
  ATR: 14,
  TOL: 0.15,          // sai số khi vẽ: đóng cửa vượt ≤ 0,15 ATR vẫn coi như còn trong đường
  BUF: 0.5,           // vùng đệm: nến phá phải đóng cửa ra ngoài ≥ 0,5 ATR
  BODY: 0.5,          // thân nến phá ≥ 0,5 ATR và cùng chiều phá
  TOUCH: 0.35,        // râu cách đường ≤ 0,35 ATR coi là một lần chạm
  WICK_MAX: 1.0,      // giữa hai điểm neo, râu không được xuyên đường quá 1 ATR (đường vẽ sai)
  FOLLOW: 4,          // lần vượt đầu tiên chưa đạt chuẩn: giá còn nằm ngoài thì theo dõi thêm tối đa 4 nến
  FAR: 1.0,           //   trong lúc đó, nến đóng cách đường ≥ 1 ATR cũng tính là phá (giá trôi dần ra xa)
  AWAY: 2.0,          // phải chạy ra xa ≥ 2 ATR rồi quay về mới tính là retest
  RETEST_MAX: 120,    // tìm retest trong 120 nến sau khi phá
  FLAT: 0.02,         // |độ dốc| < 0,02 ATR/nến coi là đường ngang
  STEEP: 0.25,        // |độ dốc| ≥ 0,25 ATR/nến coi là đường dốc (thường không retest)
  SHOW_PER_SIDE: 3,   // app: số đường còn hiệu lực hiển thị mỗi phía
  SHOW_BROKEN: 3,     // app: số đường vừa bị phá hiển thị
  SHOW_BROKEN_WITHIN: 120,
  NEAR_ATR: 10,       // app: chỉ hiện đường còn hiệu lực nằm trong 10 ATR quanh giá
};

export const CFG = Object.freeze({ ...DEFAULTS, ...TUNE });

export const HOUR = 3600000;

/* ---------- tiện ích nến ---------- */

export function fromRows(rows) {
  // rows: [[ts, o, h, l, c, vol, ...], ...] theo bất kỳ thứ tự nào → {t,o,h,l,c,v} cũ → mới
  const r = rows.map(x => x.map(Number)).sort((a, b) => a[0] - b[0]);
  return {
    t: r.map(x => x[0]), o: r.map(x => x[1]), h: r.map(x => x[2]),
    l: r.map(x => x[3]), c: r.map(x => x[4]), v: r.map(x => x[5] || 0),
  };
}

export function sliceK(K, from, to = K.c.length) {
  const s = a => a.slice(from, to);
  return { t: s(K.t), o: s(K.o), h: s(K.h), l: s(K.l), c: s(K.c), v: s(K.v) };
}

export function atrSeries(K, n = CFG.ATR) {
  const N = K.c.length, out = new Array(N);
  let sum = 0, prev = 0;
  for (let i = 0; i < N; i++) {
    const tr = i === 0
      ? K.h[0] - K.l[0]
      : Math.max(K.h[i] - K.l[i], Math.abs(K.h[i] - K.c[i - 1]), Math.abs(K.l[i] - K.c[i - 1]));
    if (i < n) { sum += tr; prev = sum / (i + 1); } else prev = (prev * (n - 1) + tr) / n;
    out[i] = prev > 0 ? prev : 1e-12;
  }
  return out;
}

export function findPivots(K, k = CFG.PIVOT) {
  const N = K.c.length, hi = [], lo = [];
  for (let i = k; i < N - k; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= k && (isH || isL); j++) {
      if (!(K.h[i] >= K.h[i - j] && K.h[i] > K.h[i + j])) isH = false;
      if (!(K.l[i] <= K.l[i - j] && K.l[i] < K.l[i + j])) isL = false;
    }
    if (isH) hi.push(i);
    if (isL) lo.push(i);
  }
  return { hi, lo };
}

/**
 * Độ lớn của mỗi đỉnh/đáy: nó là cực trị trong bao nhiêu nến mỗi bên (lấy bên ngắn hơn).
 * Chạm mép dữ liệu thì bên đó coi như không giới hạn — đỉnh mới hình thành không bị coi là nhỏ.
 */
export function pivotStrength(K, piv, side, kmax = 60) {
  const X = side === 'R' ? K.h : K.l, s = side === 'R' ? 1 : -1, N = X.length;
  const st = new Map();
  for (const i of piv) {
    let L = 0; while (L < kmax && i - L - 1 >= 0 && (X[i] - X[i - L - 1]) * s >= 0) L++;
    let R = 0; while (R < kmax && i + R + 1 < N && (X[i] - X[i + R + 1]) * s > 0) R++;
    const l = i - L - 1 < 0 ? kmax : L, r = i + R + 1 >= N ? kmax : R;
    st.set(i, Math.min(l, r));
  }
  return st;
}

const needFor = span => Math.max(CFG.PIVOT, Math.min(CFG.SCALE_MAX, Math.round(span / CFG.SCALE)));

/* ---------- dò đường ---------- */

// side 'R' = kháng cự (nối đỉnh, phá LÊN → LONG); 'S' = hỗ trợ (nối đáy, phá XUỐNG → SHORT)
function candidates(K, A, piv, side) {
  const s = side === 'R' ? 1 : -1;
  const X = side === 'R' ? K.h : K.l;
  const C = K.c, N = C.length, out = [];
  const st = pivotStrength(K, piv, side);

  for (let a = 0; a < piv.length; a++) {
    const ia = piv[a];
    for (let b = a + 1; b < piv.length; b++) {
      const ib = piv[b];
      if (ib - ia < CFG.MIN_SPAN) continue;
      const m = (X[ib] - X[ia]) / (ib - ia);
      const y0 = X[ia] - m * ia;

      // Giữa hai điểm neo: không nến nào đóng cửa vượt đường, râu không xuyên quá sâu.
      let ok = true;
      for (let i = ia + 1; i < ib; i++) {
        const y = y0 + m * i;
        if ((C[i] - y) * s > CFG.TOL * A[i] || (X[i] - y) * s > CFG.WICK_MAX * A[i]) { ok = false; break; }
      }
      if (!ok) continue;

      // Sau điểm neo thứ hai: nến đầu tiên đóng cửa vượt đường.
      let v = -1;
      for (let i = ib + 1; i < N; i++) {
        if ((C[i] - (y0 + m * i)) * s > CFG.TOL * A[i]) { v = i; break; }
      }
      const end = v < 0 ? N : v;

      // Đường càng dài thì hai điểm neo càng phải là đỉnh/đáy lớn.
      const need = needFor(end - ia);
      if (st.get(ia) < need || st.get(ib) < need) continue;
      const needTouch = Math.max(CFG.PIVOT, Math.ceil(need / 2));

      // Đếm chạm: đỉnh/đáy đủ lớn, sát đường, cách lần chạm trước đủ xa, và giữa hai lần giá đã
      // bật ra khỏi đường rõ ràng. Giá đi lình xình sát đường không tạo thêm lần chạm nào.
      const Y = side === 'R' ? K.l : K.h;   // phía bật ra xa đường
      const gap = Math.max(5, Math.round((end - ia) * CFG.GAP));
      let touches = 0, last = -1, hasB = false;
      for (let q = a; q < piv.length && piv[q] < end; q++) {
        const p = piv[q];
        if (p !== ia && p !== ib && st.get(p) < needTouch) continue;
        if ((X[p] - (y0 + m * p)) * s < -CFG.TOUCH * A[p]) continue;
        if (last >= 0) {
          if (p - last < gap) continue;
          let away = 0;
          for (let i = last + 1; i < p; i++) { const d = ((y0 + m * i) - Y[i]) * s; if (d > away) away = d; }
          if (away < CFG.REACT * A[p]) continue;
        }
        touches++; last = p;
        if (p === ib) hasB = true;
      }
      if (!hasB || touches < CFG.MIN_TOUCH) continue;

      out.push({ side, s, ia, ib, m, y0, v, touches, last });
    }
  }
  return out;
}

function classify(K, A, L) {
  const N = K.c.length, s = L.s;
  const y = i => L.y0 + L.m * i;
  L.b = L.confirm = L.retest = L.fail = -1;
  L.state = 'active';

  if (L.v >= 0) {
    L.state = 'dead';
    for (let i = L.v; i <= L.v + CFG.FOLLOW; i++) {
      if (i >= N) { L.state = 'pending'; break; }          // chờ thêm nến để kết luận
      const d = (K.c[i] - y(i)) * s;
      if (i > L.v && d <= CFG.TOL * A[i]) break;           // đã quay lại trong đường
      const body = (K.c[i] - K.o[i]) * s;
      if ((d >= CFG.BUF * A[i] && body >= CFG.BODY * A[i]) || (i > L.v && d >= CFG.FAR * A[i])) { L.state = 'broken'; L.b = i; break; }
    }
  }

  // Mốc cấu trúc: đỉnh (kháng cự) / đáy (hỗ trợ) cuối cùng nằm trên đường.
  L.level = (s > 0 ? K.h : K.l)[L.last];

  if (L.state === 'broken') {
    const far = s > 0 ? K.h : K.l;   // phía chạy ra xa sau khi phá
    const near = s > 0 ? K.l : K.h;  // phía quay về đường khi retest
    // "Chạy ra xa" chỉ tính từ các nến SAU nến phá: râu dài của chính nến phá không được tính,
    // nếu không thì nến ngay sau nến phá nào cũng thành retest.
    let away = 0;
    for (let i = L.b; i < N && i <= L.b + CFG.RETEST_MAX; i++) {
      const yi = y(i), ci = K.c[i];
      if (i > L.b && (ci - yi) * s < -CFG.BUF * A[i]) { L.fail = i; break; }   // đóng ngược vào sâu → phá hụt
      if (L.confirm < 0 && (ci - L.level) * s > 0) L.confirm = i;
      if (i >= L.b + 2 && L.retest < 0 && away >= CFG.AWAY * A[i]
          && (near[i] - yi) * s <= CFG.TOUCH * A[i]
          && (ci - yi) * s >= -CFG.TOL * A[i]) L.retest = i;
      if (i > L.b) away = Math.max(away, (far[i] - yi) * s);
      if (L.confirm >= 0 && L.retest >= 0) break;
    }
  }

  const endIdx = L.state === 'broken' ? L.b : N - 1;
  L.span = endIdx - L.ia;
  const aRef = (A[L.ia] + A[Math.min(endIdx, N - 1)]) / 2;
  L.slopeAtr = L.m / aRef;
  L.steep = Math.abs(L.slopeAtr) >= CFG.STEEP;
  L.kind = kindOf(L.side, L.slopeAtr);
  L.score = L.touches + L.span / 80;
  return L;
}

export function kindOf(side, slopeAtr) {
  const flat = Math.abs(slopeAtr) < CFG.FLAT;
  if (side === 'R') return flat ? 'kháng cự ngang' : slopeAtr < 0 ? 'kháng cự giảm' : 'kháng cự tăng';
  return flat ? 'hỗ trợ ngang' : slopeAtr > 0 ? 'hỗ trợ tăng' : 'hỗ trợ giảm';
}

function similar(A, L1, L2, N) {
  if (L1.side !== L2.side) return false;
  const e1 = L1.b >= 0 ? L1.b : N - 1, e2 = L2.b >= 0 ? L2.b : N - 1;
  const p = Math.max(L1.ia, L2.ia), q = Math.min(e1, e2);
  if (q < p) return false;
  const y1 = i => L1.y0 + L1.m * i, y2 = i => L2.y0 + L2.m * i;
  return Math.abs(y1(p) - y2(p)) <= 0.6 * A[p] && Math.abs(y1(q) - y2(q)) <= 0.6 * A[q];
}

/* ---------- phân tích ---------- */

/**
 * analyze(K) — K là nến H1 đã đóng, cũ → mới (có thể dài hơn 500; chỉ 500 nến cuối được xét).
 * Trả về:
 *   W       nến trong cửa sổ
 *   A       ATR theo từng nến của W
 *   lines   đường để vẽ (đã lọc trùng): còn hiệu lực gần giá + vừa bị phá
 *   events  mọi sự kiện trong cửa sổ: BREAK / CONFIRM / RETEST, mỗi (loại, phía, nến) một sự kiện
 */
export function analyze(Kfull) {
  const Nf = Kfull.c.length;
  const from = Math.max(0, Nf - CFG.WINDOW);
  const Afull = atrSeries(Kfull);
  const W = sliceK(Kfull, from);
  const A = Afull.slice(from);
  const N = W.c.length;
  if (N < 40) return { W, A, lines: [], events: [], all: [] };

  const piv = findPivots(W);
  const all = [
    ...candidates(W, A, piv.hi, 'R'),
    ...candidates(W, A, piv.lo, 'S'),
  ].map(L => classify(W, A, L)).filter(L => L.state !== 'dead');

  // ---- sự kiện ----
  // Một cú phá = mọi đường cùng phía bị phá trên cùng một cây nến. Đường chính là đường dài nhất;
  // xác nhận và retest lấy theo đường chính, nên mỗi cú phá có tối đa 1 BREAK, 1 CONFIRM, 1 RETEST.
  const byBreak = new Map();
  for (const L of all) {
    if (L.state !== 'broken') continue;
    const k = L.side + '|' + L.b;
    if (!byBreak.has(k)) byBreak.set(k, []);
    byBreak.get(k).push(L);
  }
  const breaks = [...byBreak.values()].map(g => {
    g.sort((x, y) => (y.span - x.span) || (y.touches - x.touches));
    const distinct = [];
    for (const L of g) if (!distinct.some(d => similar(A, d, L, N))) distinct.push(L);
    return { L: g[0], others: distinct.length - 1 };
  }).sort((x, y) => x.L.b - y.L.b);

  // Hai cú phá cách nhau ≤ 3 nến của hai đường gần trùng nhau là một sự kiện, giữ cú đầu.
  const kept = [];
  for (const br of breaks) {
    const dup = kept.some(k => k.L.side === br.L.side && br.L.b - k.L.b <= 3 && similar(A, k.L, br.L, N));
    if (!dup) kept.push(br);
  }

  const events = [];
  for (const { L, others } of kept) {
    events.push(makeEvent(W, A, 'BREAK', L.b, L, others));
    if (L.confirm > L.b) events.push(makeEvent(W, A, 'CONFIRM', L.confirm, L, others));
    if (L.retest > 0) events.push(makeEvent(W, A, 'RETEST', L.retest, L, others));
  }
  events.sort((x, y) => x.t - y.t);

  // ---- đường để vẽ ----
  const last = N - 1, price = W.c[last];
  const pick = (list, n) => {
    const kept = [];
    for (const L of list.sort((x, y) => y.score - x.score)) {
      if (kept.length >= n) break;
      if (!kept.some(K2 => similar(A, K2, L, N))) kept.push(L);
    }
    return kept;
  };
  const live = all.filter(L => (L.state === 'active' || L.state === 'pending')
    && Math.abs(L.y0 + L.m * last - price) <= CFG.NEAR_ATR * A[last]);
  // Đường đã phá: lấy đúng đường của các tín hiệu (đường chính mỗi cú phá), cái nào vừa có động tĩnh
  // (phá / xác nhận / retest) gần nhất thì vẽ trước — để mũi tên nào cũng có đường đi kèm.
  const lastAct = L => Math.max(L.b, L.confirm, L.retest);
  const brokenShown = kept.map(k => k.L)
    .filter(L => last - lastAct(L) <= CFG.SHOW_BROKEN_WITHIN)
    .sort((x, y) => lastAct(y) - lastAct(x))
    .slice(0, CFG.SHOW_BROKEN);
  const lines = [
    ...pick(live.filter(L => L.side === 'R'), CFG.SHOW_PER_SIDE),
    ...pick(live.filter(L => L.side === 'S'), CFG.SHOW_PER_SIDE),
    ...brokenShown,
  ].map(L => lineInfo(W, A, L));

  return { W, A, lines, events, all };
}

export function lineAt(info, tMs) {
  return info.pa + info.mPerH * (tMs - info.ta) / HOUR;
}

export function lineInfo(W, A, L) {
  const X = L.side === 'R' ? W.h : W.l;
  const T = i => (i >= 0 ? W.t[i] : null);
  return {
    side: L.side, kind: L.kind, state: L.state,
    ta: W.t[L.ia], pa: X[L.ia], tb: W.t[L.ib], pb: X[L.ib],
    mPerH: L.m, slopeAtr: +L.slopeAtr.toFixed(4), steep: L.steep,
    touches: L.touches, span: L.span, level: L.level, tLevel: W.t[L.last],
    tBreak: T(L.b), tConfirm: T(L.confirm), tRetest: T(L.retest), tFail: T(L.fail),
  };
}

function makeEvent(W, A, type, i, L, others) {
  const dir = L.side === 'R' ? 'LONG' : 'SHORT';
  const y = L.y0 + L.m * i;
  return {
    type, dir, side: L.side, i, t: W.t[i],
    close: W.c[i], linePrice: y, atr: A[i],
    confirmed: L.confirm >= 0 && L.confirm <= i,     // đã gãy cấu trúc tính tới nến này
    level: L.level, others,
    line: lineInfo(W, A, L),
  };
}
