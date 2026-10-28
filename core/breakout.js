/*
 * core/breakout.js — lõi phát hiện phá vỡ đường xu hướng.
 * Dùng chung cho bot (Node, GitHub Actions) và app (trình duyệt) để đường bot báo
 * và đường app vẽ luôn là một.
 *
 * Không gọi mạng, không phụ thuộc thư viện.
 * Đầu vào: nến H1 ĐÃ ĐÓNG, xếp cũ → mới, dạng { t, o, h, l, c, v } (mảng số, t = mili giây).
 *
 * Dùng được cho mọi khung nến (bot chạy H1 và H4). "Nến" dưới đây là nến của khung đang xét.
 *
 * Luật kẻ đường (theo cách bạn dạy + tài liệu kẻ trendline chuẩn):
 *   - Cửa sổ tối đa 1000 nến; mô hình (từ điểm neo đầu tới cây phá) dài ít nhất 45 nến.
 *   - Downtrend → kháng cự giảm: nối các ĐỈNH thấp dần. Uptrend → hỗ trợ tăng: nối các ĐÁY cao dần.
 *     Sideway → kháng cự / hỗ trợ ngang. Không kẻ kháng cự tăng, hỗ trợ giảm.
 *   - Điểm neo và mọi lần chạm phải là ĐỈNH/ĐÁY ĐẸP: nến có râu (phía đường) không dài hơn thân, không phải
 *     cây giật râu chọc hẳn ra khỏi các nến xung quanh. Rút râu không phải đỉnh/đáy.
 *   - Đỉnh/đáy phải rõ ràng: là cao/thấp nhất trong một khoảng đủ rộng, và giữa hai lần chạm giá phải
 *     bật ra khỏi đường rõ rệt.
 *   - Từ điểm neo đầu tới cây phá: không thân nến nào vượt đường, râu chỉ được chạm (xuyên rất ít).
 *     Đường bị nhiều râu xuyên qua là đường sai → bỏ (khi đó xem đường ở khung H4).
 *   - Một đỉnh/đáy có thể là điểm neo của nhiều đường khác nhau.
 *   - Điểm neo đầu phải là ĐÁY/ĐỈNH THẬT của vùng (không có đáy thấp hơn / đỉnh cao hơn ngay phía trước).
 *   - Kênh giá: đường song song đi qua đáy thấp nhất (kênh giảm) / đỉnh cao nhất (kênh tăng) trong mô hình,
 *     nếu biên đó cũng được chạm ≥ 2 lần — dùng để thấy giá đang chạy trong biên nào.
 *
 * Phá vỡ = cây nến ĐẦU TIÊN đóng cửa ra ngoài đường (râu không tính). Phân loại cây phá:
 *   - 'clean': đúng màu (phá lên nến xanh, phá xuống nến đỏ) và thân dài hơn cả hai râu;
 *   - 'weak' : sai màu hoặc có râu dài hơn thân → phải chờ cây kế tiếp đóng cửa tiếp tục ngoài đường, đúng màu.
 * Xác nhận: đóng cửa vượt đỉnh/đáy cuối cùng nằm trên đường (gãy cấu trúc).
 * Retest: giá chạy ra xa ít nhất 2 ATR rồi quay về chạm đường và đóng cửa giữ được.
 */

import { TUNE } from './config.js';

const DEFAULTS = {
  WINDOW: 1000,       // tối đa 1000 nến H1 (≈ 42 ngày) — bắt được cả đường dài 500–1000 nến
  WARMUP: 20,         // nến thêm phía trước chỉ để tính ATR cho chuẩn
  PIVOT: 3,           // đỉnh/đáy: cao/thấp nhất trong ±3 nến
  SCALE: 12,          // đường dài S nến chỉ được neo vào đỉnh/đáy lớn: cao/thấp nhất trong ±S/12 nến
  SCALE_MAX: 30,      //   (tối đa ±30 nến); lần chạm thứ ba trở đi chỉ cần một nửa độ lớn đó
  MIN_SPAN: 10,       // hai điểm neo cách nhau tối thiểu 10 nến
  MIN_PATTERN: 45,    // mô hình (từ điểm neo đầu tới cây phá, hoặc tới hiện tại) dài tối thiểu 45 nến
  TREND_ONLY: true,   // chỉ hỗ trợ đi lên/ngang và kháng cự đi xuống/ngang
  NEEDLE_OUT: 1.5,    // râu kim: chọc ra khỏi râu các cây ±5 bên cạnh ≥ 1,5 ATR …
  NEEDLE_WICK: 2,     //   … và râu dài ≥ 2 lần thân → không dùng làm điểm neo
  RUT_WICK: 2.0,      // rút râu: râu phía đường dài hơn 2 lần một cây nến bình thường (trung vị biên độ nến) …
  RUT_OUT: 1.2,       //   … hoặc đỉnh/đáy chọc ra khỏi 3 nến mỗi bên hơn 1,2 lần cây nến bình thường
  ABNORMAL: 2.5,      // cây có biên độ > 2,5 lần cây bình thường = cây bất thường (vọt/sập), không dùng để xét đỉnh/đáy thật
                      //   → không phải đỉnh/đáy, không được neo / tính chạm ở đó
  SPIKE_WICK: 1.0,    // (giữ để tương thích) cây phá có râu theo hướng phá ≥ 1 ATR …
  SPIKE_RATIO: 2,     //   … và ≥ 2 lần thân
  MIN_TOUCH: 3,       // tối thiểu 3 lần chạm (tính cả 2 điểm neo) …
  MAJOR: 24,          //   … hoặc 2 lần nếu cả hai điểm neo đều là đỉnh/đáy lớn (cao/thấp nhất trong ±24 nến)
  REACT: 1.5,         // giữa hai lần chạm, giá phải bật ra xa đường ≥ 1,5 ATR thì lần sau mới tính là chạm mới
  GAP: 0.08,          // hai lần chạm cách nhau ≥ 8% chiều dài đường (và ≥ 5 nến)
  ATR: 14,
  TOL: 0.05,          // sai số khi vẽ: GIỮA hai điểm neo, thân nến (giá đóng cửa) vượt đường ≤ 0,05 ATR
  BREAK: 0,           // sau điểm neo thứ hai: nến đầu tiên đóng cửa ra ngoài đường là cây PHÁ …
  BREAK_MIN: 0.15,    //   … đóng ngoài chưa tới 0,15 ATR (sát đường) thì coi như cây phá yếu: chờ cây sau
  FAIL: 0.5,          // sau khi phá, đóng cửa quay vào sâu ≥ 0,5 ATR → phá hụt (thôi tìm retest)
  TOUCH: 0.35,        // râu cách đường ≤ 0,35 ATR coi là một lần chạm
  WICK_MAX: 0.35,     // từ điểm neo đầu tới cây phá: râu xuyên đường quá 0,35 ATR (quá mức "chạm") là râu cắt qua
  WICK_ALLOW: 1,      //   … cho phép tối đa 1 râu như vậy của nến thường …
  RUT_ALLOW: 2,       //   … và 2 râu của cây rút râu (không phải đỉnh/đáy thật) …
  POKE_TOTAL: 2,      //   … tổng cộng tối đa 2; nhiều hơn = đường cắt qua râu → bỏ
  CH_TOUCH: 0.12,     // kênh giá: đáy/đỉnh cách biên kênh ≤ 12% bề rộng kênh coi là chạm biên
  PROM: 0.3,          // giữa hai lần chạm, giá phải lùi khỏi đường ≥ 30% bề rộng mô hình (đỉnh/đáy rõ ràng)
  LEFT: 0.5,          // điểm neo đầu là đáy/đỉnh thấp/cao nhất trong khoảng phía trước dài bằng 0,5 × chiều dài đường
  LEFT_MAX: 120,      //   (tối đa 120 nến)
  AWAY: 2.0,          // phải chạy ra xa ≥ 2 ATR rồi quay về mới tính là retest
  RETEST_MAX: 120,    // tìm retest trong 120 nến sau khi phá
  FLAT: 0.02,         // |độ dốc| < 0,02 ATR/nến …
  FLAT_TOTAL: 1.5,    //   … và cả đường lệch không quá 1,5 ATR từ đầu tới cuối → đường ngang
  STEEP: 0.25,        // |độ dốc| ≥ 0,25 ATR/nến coi là đường dốc (thường không retest)
  SHOW_PER_SIDE: 2,   // app: số đường còn hiệu lực hiển thị mỗi phía (hỗ trợ / kháng cự)
  SHOW_BROKEN: 2,     // app: số đường vừa bị phá hiển thị (tối đa 1 kháng cự + 1 hỗ trợ)
  SHOW_BROKEN_WITHIN: 48,   // … chỉ đường có động tĩnh (phá / xác nhận / retest) trong 48 nến gần nhất
  ZONE_ATR: 3,        // app: hai đường cùng phía cách nhau ≤ 3 ATR ở giá hiện tại là một vùng → chỉ vẽ đường rõ nhất
  NEAR_ATR: 8,        // app: chỉ hiện đường còn hiệu lực nằm trong 8 ATR quanh giá
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
export function pivotStrength(K, piv, side, kmax = 60, edgeFree = true) {
  const X = side === 'R' ? K.h : K.l, s = side === 'R' ? 1 : -1, N = X.length;
  const st = new Map();
  for (const i of piv) {
    let L = 0; while (L < kmax && i - L - 1 >= 0 && (X[i] - X[i - L - 1]) * s >= 0) L++;
    let R = 0; while (R < kmax && i + R + 1 < N && (X[i] - X[i + R + 1]) * s > 0) R++;
    // edgeFree: chạm mép dữ liệu thì bên đó coi như không giới hạn. Không edgeFree: chỉ tính số nến thật có.
    const l = edgeFree && i - L - 1 < 0 ? kmax : L, r = edgeFree && i + R + 1 >= N ? kmax : R;
    st.set(i, Math.min(l, r));
  }
  return st;
}

const needFor = span => Math.max(CFG.PIVOT, Math.min(CFG.SCALE_MAX, Math.round(span / CFG.SCALE)));

// Râu kim: râu dài ≥ NEEDLE_WICK lần thân và chọc ra khỏi râu các cây ±5 bên cạnh ≥ NEEDLE_OUT ATR.
export function isNeedle(K, A, i, side) {
  const s = side === 'R' ? 1 : -1, X = side === 'R' ? K.h : K.l;
  const edge = side === 'R' ? Math.max(K.o[i], K.c[i]) : Math.min(K.o[i], K.c[i]);
  const wick = (X[i] - edge) * s, body = Math.abs(K.c[i] - K.o[i]);
  let nb = -Infinity;
  for (let j = Math.max(0, i - 5); j <= Math.min(X.length - 1, i + 5); j++) if (j !== i) nb = Math.max(nb, X[j] * s);
  return wick >= CFG.NEEDLE_WICK * Math.max(body, 0.05 * A[i]) && X[i] * s - nb >= CFG.NEEDLE_OUT * A[i];
}

// Cây nến "bình thường" của chuỗi: trung vị biên độ (cao − thấp). Dùng để biết râu nào là râu dài bất thường
// (so với ATR thì không được: ngay lúc giá vọt, ATR cũng phình lên theo).
export function typicalRange(K) {
  const r = K.h.map((h, i) => h - K.l[i]).filter(x => x > 0).sort((a, b) => a - b);
  return r.length ? r[Math.floor(r.length / 2)] : 1e-12;
}

// Đỉnh/đáy ĐẸP để kẻ đường — không phải cây RÚT RÂU: râu phía đường dài bất thường, hoặc đỉnh/đáy chọc hẳn
// ra khỏi các nến xung quanh rồi quay về ngay. Rút râu không phải đỉnh/đáy.
export function isClean(K, A, i, side, base = typicalRange(K)) {
  const s = side === 'R' ? 1 : -1, X = side === 'R' ? K.h : K.l;
  const edge = side === 'R' ? Math.max(K.o[i], K.c[i]) : Math.min(K.o[i], K.c[i]);
  const wick = (X[i] - edge) * s;
  if (wick > CFG.RUT_WICK * base) return false;
  let nb = -Infinity;
  for (let j = Math.max(0, i - 3); j <= Math.min(X.length - 1, i + 3); j++) if (j !== i) nb = Math.max(nb, X[j] * s);
  return !(X[i] * s - nb > CFG.RUT_OUT * base);
}

// Cây phá: 'clean' = đúng màu (phá lên nến xanh, phá xuống nến đỏ) và thân dài hơn cả hai râu;
// còn lại 'weak' (sai màu, hoặc râu dài hơn thân) → chờ cây kế tiếp phá tiếp mới báo.
export function breakClass(o, h, l, c, dir) {
  const up = dir === 'LONG';
  const body = Math.abs(c - o), upW = h - Math.max(o, c), loW = Math.min(o, c) - l;
  const colorOk = up ? c > o : c < o;
  return colorOk && body > upW && body > loW ? 'clean' : 'weak';
}

// Cây phá "giật râu": râu theo hướng phá dài ≥ SPIKE_WICK ATR và ≥ SPIKE_RATIO lần thân (giá vọt ra rồi rút về).
export function isSpike(K, A, i, dir) {
  const up = dir === 'LONG';
  const wick = up ? K.h[i] - Math.max(K.o[i], K.c[i]) : Math.min(K.o[i], K.c[i]) - K.l[i];
  const body = Math.abs(K.c[i] - K.o[i]);
  return wick >= CFG.SPIKE_WICK * A[i] && wick >= CFG.SPIKE_RATIO * Math.max(body, 0.05 * A[i]);
}

// Bao nhiêu nến phía TRƯỚC đáy (đỉnh) này không có đáy thấp hơn (đỉnh cao hơn). Chạm đầu dữ liệu → vô hạn.
// Bỏ qua các cây BẤT THƯỜNG khi xét "đỉnh/đáy thật": cây rút râu, hoặc cây có biên độ lớn hơn ABNORMAL lần
// cây bình thường (giá vọt lên/xuống rồi quay về ngay — như cây giật ALGO 08/10). Bạn dạy: đỉnh râu dài thì bỏ.
function leftStrength(K, A, X, piv, s, side, base) {
  const m = new Map();
  const odd = j => K.h[j] - K.l[j] > CFG.ABNORMAL * base || !isClean(K, A, j, side, base);
  for (const i of piv) {
    let j = i - 1;
    while (j >= 0 && ((X[i] - X[j]) * s >= 0 || odd(j))) j--;
    m.set(i, j < 0 ? Infinity : i - j - 1);
  }
  return m;
}

/* ---------- dò đường ---------- */

// side 'R' = kháng cự (nối đỉnh, phá LÊN → LONG); 'S' = hỗ trợ (nối đáy, phá XUỐNG → SHORT)
function candidates(K, A, piv, side, base) {
  const s = side === 'R' ? 1 : -1;
  const X = side === 'R' ? K.h : K.l;
  const Y = side === 'R' ? K.l : K.h;   // phía bật ra xa đường
  const C = K.c, N = C.length, out = [];
  const st = pivotStrength(K, piv, side);
  const stReal = pivotStrength(K, piv, side, 60, false);            // độ lớn đã được nến thật xác nhận (không tính mép)
  const left = leftStrength(K, A, X, piv, s, side, base);
  const clean = new Map(piv.map(i => [i, isClean(K, A, i, side, base)]));
  const good = piv.filter(i => clean.get(i));                      // chỉ đỉnh/đáy đẹp mới dùng để kẻ

  for (let a = 0; a < good.length; a++) {
    const ia = good[a];
    for (let b = a + 1; b < good.length; b++) {
      const ib = good[b];
      if (ib - ia < CFG.MIN_SPAN) continue;
      const m = (X[ib] - X[ia]) / (ib - ia);
      const y0 = X[ia] - m * ia;

      // Giữa hai điểm neo: không thân nến nào vượt đường; râu xuyên quá WICK_MAX thì đếm. Râu của cây rút râu
      // (không phải đỉnh/đáy thật) đếm riêng, cho phép nhiều hơn một chút; tổng cộng tối đa POKE_TOTAL.
      let ok = true, pokes = 0, ruts = 0;
      const poke = i => {
        if (isClean(K, A, i, side, base)) pokes++; else ruts++;
        return pokes > CFG.WICK_ALLOW || ruts > CFG.RUT_ALLOW || pokes + ruts > CFG.POKE_TOTAL;
      };
      for (let i = ia + 1; i < ib; i++) {
        const y = y0 + m * i;
        if ((C[i] - y) * s > CFG.TOL * A[i]) { ok = false; break; }
        if ((X[i] - y) * s > CFG.WICK_MAX * A[i] && poke(i)) { ok = false; break; }
      }
      if (!ok) continue;

      // Sau điểm neo thứ hai: nến đầu tiên đóng cửa ra ngoài đường (≥ BREAK ATR) = phá. Trước đó râu cũng không
      // được xuyên nhiều. Cây phá yếu (sai màu / râu dài hơn thân) mà cây kế tiếp đóng cửa quay lại trong đường
      // là phá giả: đường vẫn còn (tối đa 1 lần).
      let v = -1, fakes = 0;
      const dirStr = s > 0 ? 'LONG' : 'SHORT';
      for (let i = ib + 1; i < N; i++) {
        const y = y0 + m * i;
        if ((C[i] - y) * s > CFG.BREAK * A[i]) {
          const weak = breakClass(K.o[i], K.h[i], K.l[i], C[i], dirStr) === 'weak' || (C[i] - y) * s < CFG.BREAK_MIN * A[i];
          if (weak && i + 1 < N && (C[i + 1] - (y0 + m * (i + 1))) * s <= 0 && fakes < 1) { fakes++; continue; }
          v = i; break;
        }
        if ((X[i] - y) * s > CFG.WICK_MAX * A[i] && poke(i)) { ok = false; break; }
      }
      if (!ok) continue;
      const end = v < 0 ? N : v;
      if (end - ia < CFG.MIN_PATTERN) continue;                     // mô hình quá ngắn

      // Chỉ đường thuận xu hướng: hỗ trợ không đi xuống, kháng cự không đi lên.
      if (CFG.TREND_ONLY) {
        const slope = m / ((A[ia] + A[Math.min(end, N - 1)]) / 2);
        if (s * slope > 0 && kindOf(side, slope, end - ia).endsWith(s > 0 ? 'tăng' : 'giảm')) continue;
      }

      // Đường càng dài thì hai điểm neo càng phải là đỉnh/đáy lớn.
      const need = needFor(end - ia);
      if (st.get(ia) < need || st.get(ib) < need) continue;
      // Điểm neo đầu phải là đáy (đỉnh) thật của vùng, không phải đáy (đỉnh) nhỏ ở khoảng giữa.
      if (left.get(ia) < Math.min(CFG.LEFT_MAX, Math.ceil(CFG.LEFT * (end - ia)))) continue;
      const needTouch = Math.max(CFG.PIVOT, Math.ceil(need / 2));

      // Bề rộng mô hình: giá lùi xa đường nhất bao nhiêu (để đòi mỗi nhịp phải lùi rõ ràng).
      let width = 0;
      for (let i = ia; i < end; i++) { const d = ((y0 + m * i) - Y[i]) * s; if (d > width) width = d; }

      // Đếm chạm: đỉnh/đáy đẹp, đủ lớn, sát đường, cách lần chạm trước đủ xa, và giữa hai lần giá đã
      // lùi khỏi đường rõ ràng (≥ REACT ATR và ≥ PROM × bề rộng). Giá lình xình sát đường không tạo thêm chạm.
      const gap = Math.max(5, Math.round((end - ia) * CFG.GAP));
      let touches = 0, last = -1, hasB = false;
      for (let q = a; q < good.length && good[q] < end; q++) {
        const p = good[q];
        if (p !== ia && p !== ib && st.get(p) < needTouch) continue;
        if (Math.abs(X[p] - (y0 + m * p)) > CFG.TOUCH * A[p]) continue;
        if (last >= 0) {
          if (p - last < gap) continue;
          let away = 0;
          for (let i = last + 1; i < p; i++) { const d = ((y0 + m * i) - Y[i]) * s; if (d > away) away = d; }
          if (away < CFG.REACT * A[p] || away < CFG.PROM * width) continue;
        }
        touches++; last = p;
        if (p === ib) hasB = true;
      }
      // Đủ chạm: ≥ 3 lần; hoặc 2 lần nếu cả hai điểm neo là đỉnh/đáy LỚN (cao/thấp nhất ≥ MAJOR nến mỗi bên).
      // (đỉnh/đáy vừa hình thành vài nến gần đây chưa được xác nhận là đỉnh/đáy lớn)
      const major = st.get(ia) >= CFG.MAJOR && stReal.get(ib) >= CFG.MAJOR;
      if (!hasB || touches < (major ? 2 : CFG.MIN_TOUCH)) continue;

      out.push({ side, s, ia, ib, m, y0, v, touches, last, width });
    }
  }
  return out;
}

function classify(K, A, L) {
  const N = K.c.length, s = L.s;
  const y = i => L.y0 + L.m * i;
  L.b = L.confirm = L.retest = L.fail = -1;
  L.state = 'active';

  if (L.v >= 0) { L.state = 'broken'; L.b = L.v; }      // cây đầu tiên đóng cửa ra ngoài = phá, báo ngay

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
      if (i > L.b && (ci - yi) * s < -CFG.FAIL * A[i]) { L.fail = i; break; }  // đóng ngược vào sâu → phá hụt
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
  L.kind = kindOf(L.side, L.slopeAtr, L.span);
  L.score = L.touches + L.span / 80;
  return L;
}

// Ngang = dốc rất ít mỗi nến VÀ cả đường không lệch quá FLAT_TOTAL ATR (đường dài mà nghiêng đều vẫn là đường dốc).
export function kindOf(side, slopeAtr, span = 0) {
  const flat = Math.abs(slopeAtr) < CFG.FLAT && Math.abs(slopeAtr) * span <= CFG.FLAT_TOTAL;
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
 * analyze(K) — K là nến H1 đã đóng, cũ → mới (có thể dài hơn CFG.WINDOW; chỉ CFG.WINDOW nến cuối được xét).
 * Trả về:
 *   W       nến trong cửa sổ
 *   A       ATR theo từng nến của W
 *   lines   đường để vẽ (đã lọc trùng): còn hiệu lực gần giá + vừa bị phá
 *   events  mọi sự kiện trong cửa sổ: BREAK / CONFIRM / RETEST, mỗi (loại, phía, nến) một sự kiện
 */
export function analyze(Kfull, tf = '1H') {
  const Nf = Kfull.c.length;
  const from = Math.max(0, Nf - CFG.WINDOW);
  const Afull = atrSeries(Kfull);
  const W = sliceK(Kfull, from);
  const A = Afull.slice(from);
  const N = W.c.length;
  if (N < 40) return { W, A, lines: [], events: [], all: [], tf };

  const piv = findPivots(W);
  const base = typicalRange(W);
  const all = [
    ...candidates(W, A, piv.hi, 'R', base),
    ...candidates(W, A, piv.lo, 'S', base),
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
    events.push(makeEvent(W, A, 'BREAK', L.b, L, others, tf));
    if (L.confirm > L.b) events.push(makeEvent(W, A, 'CONFIRM', L.confirm, L, others, tf));
    if (L.retest > 0) events.push(makeEvent(W, A, 'RETEST', L.retest, L, others, tf));
  }
  events.sort((x, y) => x.t - y.t);

  // ---- đường để vẽ ----
  const last = N - 1, price = W.c[last];
  // Mỗi phía chỉ giữ vài đường rõ nhất; bỏ đường gần trùng và đường nằm cùng một vùng giá.
  // (Một đỉnh/đáy vẫn được làm điểm neo cho nhiều đường khác nhau.)
  const pick = (list, n) => {
    const kept = [];
    for (const L of list.sort((x, y) => y.score - x.score)) {
      if (kept.length >= n) break;
      const now = L2 => L2.y0 + L2.m * (N - 1);
      if (!kept.some(K2 => similar(A, K2, L, N)
        || (L.state === 'active' && K2.state === 'active' && Math.abs(now(L) - now(K2)) <= CFG.ZONE_ATR * A[N - 1]))) kept.push(L);
    }
    return kept;
  };
  const live = all.filter(L => L.state === 'active'
    && Math.abs(L.y0 + L.m * last - price) <= CFG.NEAR_ATR * A[last]);
  // Đường đã phá: lấy đúng đường của các tín hiệu (đường chính mỗi cú phá), cái nào vừa có động tĩnh
  // (phá / xác nhận / retest) gần nhất thì vẽ trước — để mũi tên nào cũng có đường đi kèm.
  const lastAct = L => Math.max(L.b, L.confirm, L.retest);
  const brokenShown = [];
  for (const L of kept.map(k => k.L).filter(L => last - lastAct(L) <= CFG.SHOW_BROKEN_WITHIN).sort((x, y) => lastAct(y) - lastAct(x))) {
    if (brokenShown.length >= CFG.SHOW_BROKEN) break;
    if (!brokenShown.some(B => B.side === L.side)) brokenShown.push(L);
  }
  const lines = [
    ...pick(live.filter(L => L.side === 'R'), CFG.SHOW_PER_SIDE),
    ...pick(live.filter(L => L.side === 'S'), CFG.SHOW_PER_SIDE),
    ...brokenShown,
  ].map(L => ({ ...lineInfo(W, A, L), tf, ch: channelOf(W, A, L, L.side === 'R' ? piv.lo : piv.hi, base) }));

  return { W, A, lines, events, all, tf };
}

/**
 * Kênh giá: đường song song với trendline, đi qua đáy thấp nhất (trendline là kháng cự) / đỉnh cao nhất
 * (trendline là hỗ trợ) trong mô hình. Chỉ coi là kênh khi biên này cũng được chạm ≥ 2 lần bởi đáy/đỉnh đẹp,
 * giữa hai lần chạm giá có chạy về phía trendline rõ ràng. Trả về độ lệch giá của biên so với trendline.
 */
function channelOf(W, A, L, oppPiv, base) {
  const N = W.c.length, s = L.s, end = L.b >= 0 ? L.b : N - 1;
  const Y = s > 0 ? W.l : W.h, oppSide = s > 0 ? 'S' : 'R';
  const y = i => L.y0 + L.m * i;
  let width = 0, at = -1;
  for (let i = L.ia; i <= end; i++) { const d = (y(i) - Y[i]) * s; if (d > width) { width = d; at = i; } }
  if (width <= 0) return null;
  const par = i => y(i) - s * width;
  const gap = Math.max(5, Math.round((end - L.ia) * CFG.GAP));
  let touches = 0, last = -1;
  for (const p of oppPiv) {
    if (p < L.ia || p > end || !isClean(W, A, p, oppSide, base)) continue;
    if (Math.abs(Y[p] - par(p)) > Math.max(CFG.TOUCH * A[p], CFG.CH_TOUCH * width)) continue;
    if (last >= 0) {
      if (p - last < gap) continue;
      let back = 0;     // giữa hai lần chạm biên kênh, giá phải chạy về phía trendline rõ ràng
      for (let i = last + 1; i < p; i++) { const d = ((s > 0 ? W.h[i] : W.l[i]) - par(i)) * s; if (d > back) back = d; }
      if (back < Math.max(CFG.REACT * A[p], CFG.PROM * width)) continue;
    }
    touches++; last = p;
  }
  if (touches < 2) return null;
  return { off: -s * width, touches, tAt: W.t[at] };
}

export function lineAt(info, tMs) {
  return info.pa + info.mPerH * (tMs - info.ta) / HOUR;
}

// Độ dài một nến (mili giây) của chuỗi nến — H1 = 1 giờ, H4 = 4 giờ.
export const stepOf = W => {
  let m = Infinity;
  for (let i = 1; i < Math.min(W.t.length, 30); i++) m = Math.min(m, W.t[i] - W.t[i - 1]);
  return isFinite(m) && m > 0 ? m : HOUR;
};

export function lineInfo(W, A, L) {
  const X = L.side === 'R' ? W.h : W.l;
  const T = i => (i >= 0 ? W.t[i] : null);
  return {
    side: L.side, kind: L.kind, state: L.state,
    ta: W.t[L.ia], pa: X[L.ia], tb: W.t[L.ib], pb: X[L.ib],
    mPerH: L.m / (stepOf(W) / HOUR), slopeAtr: +L.slopeAtr.toFixed(4), steep: L.steep,
    touches: L.touches, span: L.span, level: L.level, tLevel: W.t[L.last],
    tBreak: T(L.b), tConfirm: T(L.confirm), tRetest: T(L.retest), tFail: T(L.fail),
  };
}

function makeEvent(W, A, type, i, L, others, tf) {
  const dir = L.side === 'R' ? 'LONG' : 'SHORT';
  const y = L.y0 + L.m * i;
  const N = W.c.length, s = L.s;
  let cls = null, follow = null;
  if (type === 'BREAK') {
    cls = breakClass(W.o[i], W.h[i], W.l[i], W.c[i], dir);
    if ((W.c[i] - y) * s < CFG.BREAK_MIN * A[i]) cls = 'weak';          // đóng sát đường: chưa dứt khoát
    // cây kế tiếp (nếu đã có): đóng cửa vẫn ngoài đường và đúng màu → phá tiếp
    if (i + 1 < N) {
      const j = i + 1, up = dir === 'LONG';
      follow = (W.c[j] - (L.y0 + L.m * j)) * s > 0 && (up ? W.c[j] > W.o[j] : W.c[j] < W.o[j]);
    }
  }
  return {
    type, dir, side: L.side, i, t: W.t[i], tf,
    close: W.c[i], linePrice: y, atr: A[i],
    bar: { o: W.o[i], h: W.h[i], l: W.l[i], c: W.c[i] },   // cây nến của sự kiện (dùng cho luật M30)
    cls, follow,                                            // cây phá đẹp / yếu (chờ cây sau), cây sau có phá tiếp không
    spike: cls === 'weak',
    confirmed: L.confirm >= 0 && L.confirm <= i,     // đã gãy cấu trúc tính tới nến này
    level: L.level, others,
    line: { ...lineInfo(W, A, L), tf },
  };
}
