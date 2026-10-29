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
 *   - Hướng chặt: hỗ trợ tăng nối đáy thấp → đáy CAO HƠN (bị phá xuống → SHORT); kháng cự giảm nối đỉnh cao → đỉnh
 *     THẤP HƠN (bị phá lên → LONG). Đáy thấp dần / đỉnh cao dần / gần như nằm ngang không phải trendline.
 *   - Đáy/đỉnh đầu tiên kẻ ở ĐẦU RÂU: nến đẹp (không rút râu), là đáy/đỉnh thật của cả xu hướng (không có râu nào
 *     thấp hơn / cao hơn, cả phía trước lẫn phía sau tới cây phá).
 *   - Từ đáy/đỉnh thứ hai trở đi tính THÂN: đường chạm thân nến, râu được xuyên qua. Râu dài lẻ loi chạm đường mà
 *     thân còn xa không tính là chạm.
 *   - Mỗi lần chạm là đáy/đỉnh của MỘT CON SÓNG riêng (giá chạy ra xa đường rõ rệt, sóng hồi đủ sâu); đáy/đỉnh thứ hai
 *     không nằm sát đáy/đỉnh đầu (cùng một vùng đáy thì chưa phải hai con sóng).
 *   - Chọn đường chạm NHIỀU đáy/đỉnh nhất, không bỏ sót. Từ điểm neo đầu tới cây phá không thân nến nào vượt đường;
 *     râu nến khác cắt qua quá vài cây = kẻ bừa → bỏ (khi đó xem đường ở khung H4).
 *   - Biên sideway: kháng cự ngang + hỗ trợ ngang của cùng một vùng đi ngang. Phá biên chỉ là tín hiệu khi cây phá có
 *     khối lượng lớn (≥ VOL_K lần trung bình).
 *   - Kênh giá: chỉ khi phía bên kia cũng có một trendline thật chạy gần song song.
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
  WARMUP: 200,        // nến thêm phía trước: tính ATR cho chuẩn và kiểm tra điểm neo sát mép trái có phải đáy/đỉnh thật
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
  RETR: 0.25,         // … và sóng hồi về lần chạm sau phải sâu ≥ 25% sóng trước (đáy/đỉnh của một con sóng thật,
                      //   không phải nhấp nhô nhỏ giữa đường đi)
  ANCHOR_GAP: 0.2,    // điểm neo thứ hai cách điểm neo đầu ≥ 20% chiều dài mô hình (hai con sóng khác nhau)
  NEAR_TOUCH: 2,      // râu của các cây ±2 quanh một lần chạm được xuyên đường (đường chạm thân, không tính râu)
  GAP: 0.08,          // hai lần chạm cách nhau ≥ 8% chiều dài đường (và ≥ 5 nến)
  ATR: 14,
  TOL: 0.05,          // sai số khi vẽ: GIỮA hai điểm neo, thân nến (giá đóng cửa) vượt đường ≤ 0,05 ATR
  BREAK: 0,           // sau điểm neo thứ hai: nến đầu tiên đóng cửa ra ngoài đường là cây PHÁ …
  BREAK_MIN: 0.15,    //   … đóng ngoài chưa tới 0,15 ATR (sát đường) thì coi như cây phá yếu: chờ cây sau
  FAIL: 0.5,          // sau khi phá, đóng cửa quay vào sâu ≥ 0,5 ATR → phá hụt (thôi tìm retest)
  TOUCH: 0.35,        // râu cách đường ≤ 0,35 ATR coi là một lần chạm …
  BODY_TOUCH: 0.6,    //   … và thân nến của đáy/đỉnh đó cách đường ≤ 0,6 ATR (tính thân, không kẻ theo râu dài),
  WICK_TOUCH: 1.2,    //   hoặc đường đi qua râu bình thường của vùng đáy/đỉnh: râu ≤ 1,2 cây nến bình thường …
  OUT_TOUCH: 0.5,     //   … và không chọc ra khỏi các nến ±3 bên cạnh quá 0,5 cây nến bình thường
  WICK_MAX: 0.35,     // từ điểm neo đầu tới cây phá: râu xuyên đường quá 0,35 ATR (quá mức "chạm") là râu cắt qua
  WICK_ALLOW: 1,      //   … cho phép tối đa 1 râu như vậy của nến thường …
  RUT_ALLOW: 2,       //   … và 2 râu của cây rút râu (không phải đỉnh/đáy thật) …
  POKE_TOTAL: 2,      //   … tổng cộng tối đa 2; nhiều hơn = đường cắt qua râu → bỏ
  SHORT_WICK: 0.6,    // râu ngắn: ≤ 0,6 lần cây nến bình thường (râu ngắn mà thân trong đường thì không tính là cắt râu)
  CL_MIN: 4,          // vùng đỉnh/đáy đi ngang: ≥ 4 cây trong ±4 nến …
  CL_BODY: 0.6,       //   … thân cách thân cao nhất ≤ 0,6 ATR …
  CL_TIP: 1.0,        //   … đầu râu cách đầu râu cao nhất ≤ 1 ATR → kẻ qua trung bình các đầu râu
  PAR: 0.25,          // kênh giá: hai biên lệch nhau (hội tụ/loe ra) không quá 25% bề rộng kênh trên đoạn chung
  PROM: 0.3,          // giữa hai lần chạm, giá phải lùi khỏi đường ≥ 30% bề rộng mô hình (đỉnh/đáy rõ ràng)
  LEFT: 0.5,          // điểm neo đầu là đáy/đỉnh thấp/cao nhất trong khoảng phía trước dài bằng 0,5 × chiều dài đường
  LEFT_MAX: 120,      //   (tối đa 120 nến)
  LEFT_NEAR: 24,      //   cây vọt/sập biên độ lớn cách xa hơn 24 nến thì bỏ qua (như đỉnh giật ALGO 08/10); sát bên thì không
  AWAY: 2.0,          // phải chạy ra xa ≥ 2 ATR rồi quay về mới tính là retest
  RETEST_MAX: 120,    // tìm retest trong 120 nến sau khi phá
  VOL_N: 20,          // khối lượng trung bình 20 cây trước
  VOL_K: 2.0,         // biên sideway: cây phá phải có khối lượng ≥ 2 lần trung bình mới là tín hiệu
  RANGE_MAX: 8,       // biên sideway cao tối đa 8 ATR (rộng hơn là sóng lớn, không phải đi ngang)
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

// Bao nhiêu nến phía TRƯỚC đáy (đỉnh) này không có đáy thấp hơn (đỉnh cao hơn) — xét trên TOÀN BỘ nến đã tải
// (cả phần trước cửa sổ), để đáy ở sát mép trái cửa sổ không bị coi là đáy thật khi trước đó còn đáy thấp hơn
// (STX 18/09: đáy thật nằm dưới đường). Hết dữ liệu mà vẫn chưa gặp → coi như đủ.
// Bỏ qua các cây BẤT THƯỜNG khi xét "đỉnh/đáy thật": cây rút râu, hoặc cây có biên độ lớn hơn ABNORMAL lần
// cây bình thường (giá vọt lên/xuống rồi quay về ngay — như cây giật ALGO 08/10). Bạn dạy: đỉnh râu dài thì bỏ.
// Kfull/Afull: toàn bộ nến; from: vị trí nến đầu cửa sổ trong Kfull. Trả về hàm theo chỉ số trong cửa sổ.
function leftOf(Kfull, Afull, from, side, base) {
  const s = side === 'R' ? 1 : -1, X = side === 'R' ? Kfull.h : Kfull.l;
  const rut = j => !isClean(Kfull, Afull, j, side, base);
  const odd = j => Kfull.h[j] - Kfull.l[j] > CFG.ABNORMAL * base || rut(j);
  const memo = new Map();
  return i => {
    if (memo.has(i)) return memo.get(i);
    const g = i + from;
    let j = g - 1;
    // Cây rút râu luôn được bỏ qua. Cây biên độ lớn bất thường (nến vọt/sập) chỉ bỏ qua khi ở xa (> LEFT_NEAR nến):
    // một cây sập lớn ngay sát bên mà đáy thấp hơn thì đó mới là đáy thật của vùng (PI 26/10).
    while (j >= 0 && ((X[g] - X[j]) * s >= 0 || rut(j) || (g - j > CFG.LEFT_NEAR && odd(j)))) j--;
    const v = j < 0 ? Infinity : g - j - 1;
    memo.set(i, v);
    return v;
  };
}

// Khối lượng cây nến so với trung bình VOL_N cây trước đó (null nếu không có dữ liệu khối lượng).
export function volRatio(K, i, n = CFG.VOL_N) {
  if (!K.v || i < 1) return null;
  let sum = 0, k = 0;
  for (let j = Math.max(0, i - n); j < i; j++) { sum += K.v[j] || 0; k++; }
  return k && sum > 0 && K.v[i] > 0 ? K.v[i] / (sum / k) : null;
}

/* ---------- dò đường ---------- */

// Mức kẻ đường tại một đỉnh/đáy. Thường là đầu râu. Nhưng nếu đỉnh/đáy là một VÙNG ĐI NGANG nhiều râu ngắn
// (≥ 4 cây trong ±4 nến có thân sát thân cao nhất và đầu râu sát đầu râu cao nhất), đường đi qua TRUNG BÌNH các
// đầu râu đó, không thấp hơn thân nến cao nhất (kháng cự) / không cao hơn thân thấp nhất (hỗ trợ) — như ICP 22/10.
// Đỉnh/đáy nhọn (giá quay đầu nhanh) vẫn kẻ ở đầu râu.
function levelAt(K, A, i, side, base) {
  const s = side === 'R' ? 1 : -1, X = side === 'R' ? K.h : K.l, N = X.length;
  const edge = j => (side === 'R' ? Math.max(K.o[j], K.c[j]) : Math.min(K.o[j], K.c[j]));
  const lo = Math.max(0, i - 4), hi = Math.min(N - 1, i + 4);
  let top = -Infinity;
  for (let j = lo; j <= hi; j++) top = Math.max(top, edge(j) * s);
  const mem = [];
  for (let j = lo; j <= hi; j++)
    if (top - edge(j) * s <= CFG.CL_BODY * A[i] && (X[i] - X[j]) * s <= CFG.CL_TIP * A[i] && isClean(K, A, j, side, base)) mem.push(j);
  const shortN = mem.filter(j => j !== i && (X[j] - edge(j)) * s <= CFG.SHORT_WICK * base).length;
  if (mem.length < CFG.CL_MIN || shortN < CFG.CL_MIN) return X[i];      // phải là vùng NHIỀU RÂU NGẮN
  const avg = mem.reduce((t, j) => t + X[j], 0) / mem.length;
  const body = top * s;
  return s > 0 ? Math.max(avg, body) : Math.min(avg, body);
}

/**
 * Dò đường của một phía. side 'R' = kháng cự (nối đỉnh, phá LÊN → LONG); 'S' = hỗ trợ (nối đáy, phá XUỐNG → SHORT).
 * mode 'trend': đường xiên. mode 'flat': đường ngang (biên sideway).
 *
 * Cách kẻ (như bạn dạy):
 *   - Hướng: hỗ trợ nối đáy thấp → đáy CAO HƠN, kháng cự nối đỉnh cao → đỉnh THẤP HƠN (tính cả râu). Gần như nằm
 *     ngang thì không phải trendline (xem biên sideway).
 *   - Điểm neo đầu: ĐÁY/ĐỈNH THẬT, kẻ ở ĐẦU RÂU (nến đẹp, không rút râu; không có đáy thấp hơn / đỉnh cao hơn cả phía
 *     trước lẫn phía sau cho tới cây phá).
 *   - Từ đáy (đỉnh) thứ hai trở đi: không tính râu, tính THÂN — đường chạm thân nến, râu được phép xuyên qua.
 *     Đường được xoay từ điểm neo đầu cho tới khi chạm thân của cụm nến đáy (đỉnh) sau, không cắt thân nến nào.
 *   - Mỗi lần chạm phải là đáy (đỉnh) của MỘT CON SÓNG riêng: giữa hai lần chạm giá phải bật ra xa đường rõ rệt
 *     và sóng hồi về lần chạm sau phải đủ sâu (≥ RETR của sóng trước) — không lấy mấy cái nhấp nhô nhỏ.
 *   - Chọn đường chạm được NHIỀU đáy (đỉnh) nhất, không bỏ sót đáy nào nằm trên đường.
 *   - Râu của nến khác (không phải cụm đáy/đỉnh đang chạm) cắt qua đường: tối đa vài cây; nhiều hơn = kẻ bừa → bỏ.
 */
function candidates(K, A, piv, side, base, leftFn, mode = 'trend') {
  const s = side === 'R' ? 1 : -1;
  const X = s > 0 ? K.h : K.l;            // phía đường (đầu râu)
  const Y = s > 0 ? K.l : K.h;            // phía bật ra xa đường
  const C = K.c, N = C.length;
  const edge = j => (s > 0 ? Math.max(K.o[j], K.c[j]) : Math.min(K.o[j], K.c[j]));   // thân nến phía đường
  const st = pivotStrength(K, piv, side);
  const stReal = pivotStrength(K, piv, side, 60, false);            // độ lớn đã được nến thật xác nhận (không tính mép)
  const isPiv = new Uint8Array(N); for (const p of piv) isPiv[p] = 1;
  const clean = i => isClean(K, A, i, side, base);
  const dirStr = s > 0 ? 'LONG' : 'SHORT';
  const flat = mode === 'flat';
  const out = [];
  // râu ngắn mà thân vẫn nằm trong đường thì không tính là "râu cắt qua đường"
  const pokesOut = (i, y) => (X[i] - y) * s > CFG.WICK_MAX * A[i]
    && !((X[i] - edge(i)) * s <= CFG.SHORT_WICK * base && (edge(i) - y) * s <= CFG.TOL * A[i]);

  // Chạm (từ đáy/đỉnh thứ hai trở đi tính THÂN): trong cụm nến của đáy/đỉnh (±NEAR_TOUCH) râu chạm tới đường, và
  // thân nến sát đường (cách ≤ BODY_TOUCH ATR) — hoặc đường đi qua râu BÌNH THƯỜNG của vùng đáy/đỉnh đó (râu ngắn,
  // không chọc lẻ loi ra khỏi các nến bên cạnh). Một cây râu dài chọc ra một mình chạm đường mà thân còn xa thì
  // KHÔNG tính — kẻ vậy là kẻ theo râu, không có căn cứ. Đáy/đỉnh không thẳng hàng → đường đi giữa thân và râu.
  const normalWick = j => {
    if ((X[j] - edge(j)) * s > CFG.WICK_TOUCH * base) return false;
    let nb = -Infinity;
    for (let q = Math.max(0, j - 3); q <= Math.min(N - 1, j + 3); q++) if (q !== j) nb = Math.max(nb, X[q] * s);
    return X[j] * s - nb <= CFG.OUT_TOUCH * base;
  };
  const touchAt = (p, y) => {
    let body = false, wick = false;
    for (let j = Math.max(0, p - CFG.NEAR_TOUCH); j <= Math.min(N - 1, p + CFG.NEAR_TOUCH); j++) {
      const yj = y(j), reach = (X[j] - yj) * s >= -CFG.TOUCH * A[j];
      if (reach) wick = true;
      if ((edge(j) - yj) * s >= -CFG.BODY_TOUCH * A[j] || (reach && normalWick(j))) body = true;
    }
    return body && wick;
  };

  // Đầu râu xa nhất của cụm đáy/đỉnh. Đáy sau phải CAO HƠN đáy trước (đỉnh sau THẤP HƠN đỉnh trước) tính cả râu:
  // râu đáy sau thủng xuống dưới đáy trước là đáy bằng / đáy thấp hơn, không phải xu hướng tăng.
  const tipOf = p => {
    let x = X[p];
    for (let j = Math.max(0, p - CFG.NEAR_TOUCH); j <= Math.min(N - 1, p + CFG.NEAR_TOUCH); j++) if ((X[j] - x) * s > 0) x = X[j];
    return x;
  };

  // Sóng hồi về lần chạm p so với sóng trước (từ lần chạm q): đủ xa đường và đủ sâu.
  // F = giá xa đường nhất giữa q và p (đỉnh sóng với hỗ trợ / đáy sóng với kháng cự).
  const wave = (yq, q, p, y) => {
    let away = 0, F = s > 0 ? Infinity : -Infinity;
    for (let i = q + 1; i < p; i++) {
      const d = (y(i) - Y[i]) * s; if (d > away) away = d;
      if (s > 0 ? Y[i] < F : Y[i] > F) F = Y[i];
    }
    const leg = (yq - F) * s, back = (y(p) - F) * s;
    return { away, retr: leg > 0 ? back / leg : 0 };
  };

  for (const ia of piv) {
    if (!clean(ia)) continue;                                        // điểm neo đầu: nến đẹp, kẻ ở đầu râu
    if (st.get(ia) < CFG.PIVOT) continue;
    // phải là đáy/đỉnh thật (biên sideway thì không cần: vùng đi ngang có thể hình thành sau một cây vọt/sập)
    if (!flat && leftFn(ia) < Math.ceil(CFG.LEFT * CFG.MIN_PATTERN)) continue;
    // Mức kẻ ở điểm neo đầu: ĐẦU RÂU (vùng đỉnh/đáy nhiều râu ngắn: trung bình các đầu râu — levelAt).
    const pa = levelAt(K, A, ia, side, base);
    const group = new Map();                                         // các đường thử, theo đáy/đỉnh thứ hai

    // Các độ dốc thử: đường từ điểm neo đầu chạm THÂN cụm nến (±PIVOT) quanh mỗi đáy/đỉnh phía sau.
    let slopes = [];
    if (mode === 'flat') slopes = [0];
    else {
      for (const p of piv) {
        if (p - ia < CFG.MIN_SPAN) continue;
        let m = null;
        for (let j = Math.max(ia + 1, p - CFG.PIVOT); j <= Math.min(N - 1, p + CFG.PIVOT); j++) {
          const mj = (edge(j) - pa) / (j - ia);
          if (m === null || (s > 0 ? mj > m : mj < m)) m = mj;      // vào sát giá nhất mà không cắt thân cụm đó
        }
        slopes.push(m);
      }
      slopes.sort((a, b) => a - b);
      slopes = slopes.filter((m, k) => k === 0 || Math.abs(m - slopes[k - 1]) > 1e-12);
    }

    for (const m of slopes) {
      const y = i => pa + m * (i - ia);

      // Lượt 1: đi tới cây phá. Trước khi có lần chạm thứ hai (đúng sóng): không thân nến nào vượt đường.
      // Sau đó: cây đầu tiên ĐÓNG CỬA ra ngoài đường = phá (cây phá yếu mà cây sau quay lại trong đường = phá giả).
      const raw = [];
      let est = false, v = -1, fakes = 0, ok = true;
      for (let i = ia + 1; i < N; i++) {
        const yi = y(i);
        if (!est) {
          if ((edge(i) - yi) * s > CFG.TOL * A[i]) { ok = false; break; }
        } else if ((C[i] - yi) * s > Math.max(CFG.BREAK, CFG.TOL) * A[i]) {
          let weak = breakClass(K.o[i], K.h[i], K.l[i], C[i], dirStr) === 'weak' || (C[i] - yi) * s < CFG.BREAK_MIN * A[i];
          if (mode === 'flat') { const vr = volRatio(K, i); if (vr !== null && vr < CFG.VOL_K) weak = true; }
          if (weak && i + 1 < N && (C[i + 1] - y(i + 1)) * s <= 0 && fakes < 1) { fakes++; continue; }
          v = i; break;
        }
        if (isPiv[i] && touchAt(i, y)) {
          raw.push(i);
          if (!est && (flat || (tipOf(i) - X[ia]) * s < 0)) {
            const w = wave(pa, ia, i, y);
            if (w.away >= CFG.REACT * A[i] && w.retr >= CFG.RETR) est = true;
          }
        }
      }
      if (!ok || !raw.length) continue;
      const end = v < 0 ? N : v;
      if (end - ia < CFG.MIN_PATTERN) continue;                     // mô hình quá ngắn

      // Điểm neo đầu là đáy (đỉnh) của cả xu hướng: từ đó tới cây phá không râu nào thấp hơn (cao hơn) nó.
      if (!flat) {
        let bad = false;
        for (let i = ia + 1; i < end && !bad; i++) if ((X[i] - X[ia]) * s > CFG.TOL * A[i]) bad = true;
        if (bad) continue;
      }
      // Đường càng dài thì điểm neo đầu càng phải là đáy/đỉnh lớn, và là đáy/đỉnh thật của cả vùng phía trước.
      const need = needFor(end - ia);
      if (st.get(ia) < need) continue;
      if (!flat && leftFn(ia) < Math.min(CFG.LEFT_MAX, Math.ceil(CFG.LEFT * (end - ia)))) continue;
      const needTouch = Math.max(CFG.PIVOT, Math.ceil(need / 2));

      // Bề rộng mô hình: giá lùi xa đường nhất bao nhiêu (để đòi mỗi nhịp phải lùi rõ ràng).
      let width = 0;
      for (let i = ia; i < end; i++) { const d = (y(i) - Y[i]) * s; if (d > width) width = d; }

      // Lượt 2: đếm chạm — mỗi lần chạm là đáy/đỉnh của một con sóng riêng.
      const gap = Math.max(5, Math.round((end - ia) * CFG.GAP));
      const T = [ia];
      for (const p of raw) {
        if (p >= end) break;
        if (st.get(p) < needTouch) continue;
        const q = T[T.length - 1];
        if (p - q < gap) continue;
        if (q === ia && p - ia < CFG.ANCHOR_GAP * (end - ia)) continue;    // đáy 2 sát đáy 1 = cùng một vùng đáy, chưa phải sóng mới
        if (!flat && (tipOf(p) - (q === ia ? X[ia] : tipOf(q))) * s >= 0) continue;   // đáy cao dần / đỉnh thấp dần
        const w = wave(y(q), q, p, y);
        if (w.away < CFG.REACT * A[p] || w.away < CFG.PROM * width || w.retr < CFG.RETR) continue;
        T.push(p);
      }
      if (T.length < 2) continue;
      const ib = T[1];
      // Đủ chạm: ≥ 3 lần; hoặc 2 lần nếu cả hai điểm neo là đỉnh/đáy LỚN (cao/thấp nhất ≥ MAJOR nến mỗi bên).
      const major = st.get(ia) >= CFG.MAJOR && stReal.get(ib) >= CFG.MAJOR;
      if (T.length < (major || flat ? 2 : CFG.MIN_TOUCH)) continue;     // biên sideway: mỗi biên ≥ 2 lần chạm

      // Râu cắt qua đường (trừ cụm nến của các lần chạm — râu ở đó được phép xuyên vì đường chạm thân):
      // tối đa WICK_ALLOW râu của nến thường + RUT_ALLOW râu của cây rút râu, tổng không quá POKE_TOTAL.
      const near = new Uint8Array(N);
      for (const p of [ia, ...raw]) for (let j = Math.max(0, p - CFG.NEAR_TOUCH); j <= Math.min(N - 1, p + CFG.NEAR_TOUCH); j++) near[j] = 1;
      let pokes = 0, ruts = 0;
      for (let i = ia + 1; i < end && ok; i++) {
        if (near[i] || !pokesOut(i, y(i))) continue;
        if (clean(i)) pokes++; else ruts++;
        if (pokes > CFG.WICK_ALLOW || ruts > CFG.RUT_ALLOW || pokes + ruts > CFG.POKE_TOTAL) ok = false;
      }
      if (!ok) continue;

      const L = { side, s, ia, ib, m, y0: pa - m * ia, v, end, touches: T.length, last: T[T.length - 1], width, T, flat };
      if (!group.has(ib)) group.set(ib, []);
      group.get(ib).push(L);
    }
    // Cùng điểm neo đầu và cùng đáy/đỉnh thứ hai là MỘT đường (người kẻ tay chỉ kẻ một): đường chạm nhiều đáy/đỉnh
    // nhất; bằng nhau thì đường có lần chạm cuối mới hơn (không bỏ sót đáy/đỉnh mới), rồi đường sát thân hơn.
    // Nếu đường đó có lần chạm SAU khi một đường dốc hơn cùng gốc đã bị phá (giá thủng đường dốc rồi bật lên ở đường
    // thoải hơn), giữ cả đường đã bị phá — cú phá đó đã xảy ra thật.
    const better = (a, b) => (b.touches - a.touches) || (b.last - a.last) || (a.m - b.m) * s;
    for (const g of group.values()) {
      g.sort(better);
      out.push(g[0]);
      const prev = g.find(L => L.v >= 0 && L.end < g[0].last);
      if (prev) out.push(prev);
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
  const leftR = leftOf(Kfull, Afull, from, 'R', base), leftS = leftOf(Kfull, Afull, from, 'S', base);
  const endOf = L => (L.b >= 0 ? L.b : N - 1);

  // Đường xiên: chỉ đường có hướng rõ ràng (hỗ trợ đi lên nối đáy thấp → đáy cao hơn, kháng cự đi xuống nối đỉnh
  // cao → đỉnh thấp hơn). Đường gần như nằm ngang không phải trendline. Kháng cự tăng / hỗ trợ giảm chỉ giữ để nhận
  // ra kênh giá, không vẽ, không báo.
  const trend = [
    ...candidates(W, A, piv.hi, 'R', base, leftR, 'trend'),
    ...candidates(W, A, piv.lo, 'S', base, leftS, 'trend'),
  ].map(L => classify(W, A, L)).filter(L => !L.kind.endsWith('ngang'));

  // Biên sideway: kháng cự ngang + hỗ trợ ngang của cùng một vùng đi ngang (mỗi biên ≥ 2 lần chạm, hai biên cùng
  // thời gian). Đường ngang lẻ không thành biên thì bỏ. Phá biên chỉ là tín hiệu khi cây phá có khối lượng lớn.
  const flats = [
    ...candidates(W, A, piv.hi, 'R', base, leftR, 'flat'),
    ...candidates(W, A, piv.lo, 'S', base, leftS, 'flat'),
  ].map(L => classify(W, A, L));
  const ranges = [];
  for (const L of flats) {
    let best = null;
    for (const M of flats) {
      if (M.side === L.side || (L.y0 - M.y0) * L.s <= 0) continue;      // biên bên kia nằm đúng phía
      if (M.ib >= endOf(L) || (M.b >= 0 && M.b < endOf(L))) continue;    // đã thành hình và còn nguyên khi L bị phá
      const p = Math.max(L.ia, M.ia), span = endOf(L) - Math.min(L.ia, M.ia);
      if (endOf(L) - p < 0.4 * span) continue;                            // hai biên của cùng một vùng đi ngang
      const h = Math.abs(L.y0 - M.y0), a0 = Math.min(L.ia, M.ia);
      const aMed = A.slice(a0, endOf(L) + 1).sort((x, y) => x - y)[(endOf(L) - a0) >> 1];   // ATR trung vị trong vùng đi ngang
      if (h < CFG.REACT * aMed || h > CFG.RANGE_MAX * aMed) continue;      // biên đi ngang: không quá hẹp, không quá rộng
      if (!best || M.touches > best.touches || (M.touches === best.touches && M.span > best.span)) best = M;
    }
    if (best) {
      L.range = best;
      if (L.b >= 0) { L.vol = volRatio(W, L.b); L.lowVol = L.vol !== null && L.vol < CFG.VOL_K; }
      ranges.push(L);
    }
  }

  const any = [...trend, ...ranges];
  const counter = L => L.kind === 'kháng cự tăng' || L.kind === 'hỗ trợ giảm';
  const all = CFG.TREND_ONLY ? any.filter(L => !counter(L)) : any;

  // ---- sự kiện ----
  // Một cú phá = mọi đường cùng phía bị phá trên cùng một cây nến. Đường chính là đường dài nhất;
  // xác nhận và retest lấy theo đường chính, nên mỗi cú phá có tối đa 1 BREAK, 1 CONFIRM, 1 RETEST.
  const byBreak = new Map();
  for (const L of all) {
    if (L.state !== 'broken' || L.lowVol) continue;          // phá biên sideway mà khối lượng nhỏ: không phải tín hiệu
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
    const dup = kept.find(k => k.L.side === br.L.side && br.L.b - k.L.b <= 3 && similar(A, k.L, br.L, N));
    if (dup) dup.others++; else kept.push(br);
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
  const liveShown = [...pick(live.filter(L => L.side === 'R'), CFG.SHOW_PER_SIDE), ...pick(live.filter(L => L.side === 'S'), CFG.SHOW_PER_SIDE)];
  const brokenShown = [];
  for (const L of kept.map(k => k.L).filter(L => last - lastAct(L) <= CFG.SHOW_BROKEN_WITHIN).sort((x, y) => lastAct(y) - lastAct(x))) {
    if (brokenShown.length >= CFG.SHOW_BROKEN) break;
    // đường đã phá gần trùng một đường cùng gốc vẫn còn hiệu lực (cú phá đó là phá giả) → chỉ vẽ đường còn hiệu lực
    if (liveShown.some(K2 => K2.side === L.side && K2.ia === L.ia && similar(A, K2, L, N))) continue;
    if (!brokenShown.some(B => B.side === L.side)) brokenShown.push(L);
  }
  const lines = [
    ...liveShown,
    ...brokenShown,
  ].map(L => ({ ...lineInfo(W, A, L), tf,
    ch: L.range ? { line: lineInfo(W, A, L.range), touches: L.range.touches, range: true } : channelOf(W, A, L, trend) }));

  return { W, A, lines, events, all, tf };
}

/**
 * Kênh giá: chỉ có kênh khi PHÍA BÊN KIA cũng có một trendline thật (đủ luật: đỉnh/đáy đẹp, không cắt râu, đủ chạm)
 * chạy gần SONG SONG với đường này trên ít nhất nửa mô hình — hai biên lệch nhau không quá PAR × bề rộng kênh.
 * Không tự kẻ song song qua một đỉnh/đáy lẻ (không có căn cứ). Trả về đường biên bên kia.
 */
function channelOf(W, A, L, pool) {
  const N = W.c.length, endL = L.b >= 0 ? L.b : N - 1;
  let best = null;
  for (const M of pool) {
    if (M.side === L.side) continue;
    const endM = M.b >= 0 ? M.b : N - 1;
    const p = Math.max(L.ia, M.ia), q = Math.min(endL, endM);
    if (q - p < 0.5 * Math.max(endL - L.ia, endM - M.ia)) continue;            // hai biên cùng một mô hình, cùng cỡ
    const w = i => ((L.y0 + L.m * i) - (M.y0 + M.m * i)) * L.s;     // bề rộng kênh tại nến i
    const w0 = w(p), w1 = w(q);
    if (w0 <= 0 || w1 <= 0) continue;
    if (Math.abs(w0 - w1) > CFG.PAR * (w0 + w1) / 2) continue;
    if (!best || M.touches > best.touches || (M.touches === best.touches && M.span > best.span)) best = M;
  }
  return best ? { line: lineInfo(W, A, best), touches: best.touches } : null;
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
    ta: W.t[L.ia], pa: L.y0 + L.m * L.ia, tb: W.t[L.ib], pb: L.y0 + L.m * L.ib,
    mPerH: L.m / (stepOf(W) / HOUR), slopeAtr: +L.slopeAtr.toFixed(4), steep: L.steep,
    touches: L.touches, span: L.span, level: L.level, tLevel: W.t[L.last],
    tTouch: (L.T || []).map(i => W.t[i]), range: !!L.range,
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
    vol: volRatio(W, i),                                    // khối lượng cây này so với trung bình 20 cây trước
    spike: cls === 'weak',
    confirmed: L.confirm >= 0 && L.confirm <= i,     // đã gãy cấu trúc tính tới nến này
    level: L.level, others,
    line: { ...lineInfo(W, A, L), tf },
  };
}
