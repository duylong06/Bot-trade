/*
 * core/learn.js — bot ghi nhớ kết quả từng tín hiệu và tự học loại nào hay ăn.
 * Dùng chung cho bot (học, chấm điểm) và app (hiển thị điểm, yếu tố, thống kê).
 *
 * Nguyên tắc:
 *   - KHÔNG đổi định nghĩa phá vỡ (đó là cách đánh của chủ repo). Bot chỉ học xem trong các cú phá
 *     đúng luật, loại nào thường chạy tiếp, loại nào hay quay đầu.
 *   - Mỗi tín hiệu được chấm như một lệnh giả định: vào ở giá đóng cửa nến tín hiệu,
 *     mục tiêu +2 ATR, dừng lỗ −1 ATR, tối đa 72 nến H1. Chạm cái nào trước thì tính cái đó;
 *     cùng một nến chạm cả hai thì tính THUA (thận trọng). Hoà vốn ở tỷ lệ thắng 33%.
 *   - Chỉ cho bot tự lọc khi mô hình học trên dữ liệu cũ mà vẫn chọn đúng trên dữ liệu mới
 *     (kiểm tra ngoài mẫu theo thời gian). Chưa chứng minh được thì vẫn báo hết.
 */

export const LEARN = {
  TP: 2.0,          // mục tiêu: +2 ATR theo hướng tín hiệu
  SL: 1.0,          // dừng lỗ: −1 ATR
  HORIZON: 72,      // tối đa 72 nến H1
  MIN_TRAIN: 150,   // cần ≥150 tín hiệu đã thắng/thua mới bắt đầu chấm điểm
  MIN_TEST: 60,     // phần kiểm tra ngoài mẫu cần ≥60 tín hiệu
  LIFT: 0.05,       // lọc phải giúp tăng ≥ +0,05R mỗi lệnh trên dữ liệu chưa thấy mới được bật
  EV_MIN: 0,        // khi đang lọc: chỉ đẩy tín hiệu có kỳ vọng ≥ 0R
  L2: 2.0,          // mức "phanh" chống học vẹt
  KEEP_DAYS: 120,   // nhật ký giữ 120 ngày
};

const H = 3600000;
export const evOf = p => p * LEARN.TP - (1 - p) * LEARN.SL;            // kỳ vọng (R) theo xác suất thắng
export const BREAKEVEN = LEARN.SL / (LEARN.TP + LEARN.SL);              // 33,3%

export const eventId = (instId, e) => `${instId}|${e.type}|${e.side}|${e.line.tBreak}`;

/* ---------------- đặc trưng của một tín hiệu ---------------- */

function emaAt(c, i, len) {
  if (i < len - 1) return null;
  const k = 2 / (len + 1);
  let v = 0;
  for (let j = 0; j < len; j++) v += c[j];
  v /= len;
  for (let j = len; j <= i; j++) v = c[j] * k + v * (1 - k);
  return v;
}

export function kindClass(kind) {
  if (/ngang/.test(kind)) return 'flat';
  if (kind === 'kháng cự giảm' || kind === 'hỗ trợ tăng') return 'rev';   // phá ngược chiều đường → đảo chiều
  return 'acc';                                                           // phá theo chiều đường → tăng tốc
}

// W, A: nến và ATR trong cửa sổ lúc tín hiệu xảy ra; e: sự kiện từ analyze()
export function featuresAt(W, A, e) {
  const i = e.i, d = e.dir === 'LONG' ? 1 : -1;
  const ema = emaAt(W.c, i, 200);
  let s = 0, n = 0;
  for (let j = Math.max(0, i - 20); j < i; j++) { s += W.v[j]; n++; }
  const vr = n && s > 0 ? W.v[i] / (s / n) : 1;
  return {
    ty: e.type, d, sp: e.line.span, tc: e.line.touches,
    cf: e.confirmed ? 1 : 0, st: e.line.steep ? 1 : 0, kd: kindClass(e.line.kind),
    vr: +vr.toFixed(2),
    em: ema == null ? null : d * (W.c[i] - ema) > 0 ? 1 : 0,
    ds: +(((W.c[i] - e.linePrice) * d) / A[i]).toFixed(2),
  };
}

// Mỗi cột: [khoá, nhãn hiển thị, hàm bật/tắt]. Nhóm gốc (không có cột) là: PHÁ, SHORT, <40 nến,
// 3 chạm, đảo chiều, khối lượng < trung bình, ngược chiều EMA200, đóng cách đường < 1 ATR.
export const FEATS = [
  ['ty:CONFIRM', 'Loại: xác nhận', f => f.ty === 'CONFIRM'],
  ['ty:RETEST', 'Loại: retest', f => f.ty === 'RETEST'],
  ['long', 'Chiều LONG', f => f.d === 1],
  ['sp:40', 'Mô hình 40–99 nến', f => f.sp >= 40 && f.sp < 100],
  ['sp:100', 'Mô hình 100–249 nến', f => f.sp >= 100 && f.sp < 250],
  ['sp:250', 'Mô hình 250+ nến', f => f.sp >= 250],
  ['tc4', 'Từ 4 lần chạm', f => f.tc >= 4],
  ['cf', 'Đã gãy cấu trúc', f => f.cf === 1],
  ['st', 'Đường dốc', f => f.st === 1],
  ['kd:flat', 'Đường ngang', f => f.kd === 'flat'],
  ['kd:acc', 'Phá theo đà (tăng tốc)', f => f.kd === 'acc'],
  ['vr:1', 'Khối lượng 1–2× trung bình', f => f.vr >= 1 && f.vr < 2],
  ['vr:2', 'Khối lượng ≥ 2× trung bình', f => f.vr >= 2],
  ['em', 'Cùng chiều EMA200', f => f.em === 1],
  ['em:na', 'Chưa đủ nến cho EMA200', f => f.em == null],
  ['ds:1', 'Đóng cách đường 1–2 ATR', f => f.ds >= 1 && f.ds < 2],
  ['ds:2', 'Đóng cách đường ≥ 2 ATR', f => f.ds >= 2],
];
export const encode = f => FEATS.map(([, , on]) => (on(f) ? 1 : 0));

/* ---------------- chấm kết quả ---------------- */

/**
 * K: nến đã đóng của đồng đó (cũ → mới); t: giờ mở nến tín hiệu; d: +1 LONG / −1 SHORT;
 * px: giá vào (đóng cửa nến tín hiệu); a: ATR lúc đó.
 * Trả về { o, h, r6, r24, r72, mfe, mae } — các số đo bằng ATR theo hướng tín hiệu.
 *   o: 'W' chạm mục tiêu · 'L' chạm dừng lỗ · 'T' hết 72 nến · 'P' chưa đủ nến
 */
export function outcome(K, t, d, px, a) {
  let lo = 0, hi = K.t.length - 1, i = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (K.t[m] === t) { i = m; break; } if (K.t[m] < t) lo = m + 1; else hi = m - 1; }
  if (i < 0) return null;
  const tp = px + d * LEARN.TP * a, sl = px - d * LEARN.SL * a;
  const R = c => +((d * (c - px)) / a).toFixed(2);
  const res = { o: 'P', h: null, r6: null, r24: null, r72: null, mfe: 0, mae: 0 };
  const N = K.t.length;
  for (let j = i + 1; j < N && j <= i + LEARN.HORIZON; j++) {
    const fav = d > 0 ? K.h[j] : K.l[j], adv = d > 0 ? K.l[j] : K.h[j];
    res.mfe = Math.max(res.mfe, +((d * (fav - px)) / a).toFixed(2));
    res.mae = Math.min(res.mae, +((d * (adv - px)) / a).toFixed(2));
    const k = j - i;
    if (k === 6) res.r6 = R(K.c[j]);
    if (k === 24) res.r24 = R(K.c[j]);
    if (k === 72) res.r72 = R(K.c[j]);
    if (res.o === 'P') {
      const hitSL = d > 0 ? adv <= sl : adv >= sl;
      const hitTP = d > 0 ? fav >= tp : fav <= tp;
      if (hitSL) { res.o = 'L'; res.h = k; }
      else if (hitTP) { res.o = 'W'; res.h = k; }
    }
    if (res.o !== 'P' && k >= 72) break;
  }
  if (res.o === 'P' && N - 1 - i >= LEARN.HORIZON) { res.o = 'T'; res.h = LEARN.HORIZON; }
  // giá hiện tại (cho tín hiệu đang chạy)
  res.now = R(K.c[N - 1]);
  return res;
}

// Lãi/lỗ thực tế tính bằng R (1R = khoảng dừng lỗ = 1 ATR)
export function realizedR(row) {
  if (row.o === 'W') return LEARN.TP;
  if (row.o === 'L') return -LEARN.SL;
  if (row.o === 'T') return Math.max(-LEARN.SL, Math.min(LEARN.TP, row.r72 ?? 0)) / LEARN.SL;
  return null;
}

/* ---------------- hồi quy logistic (Newton, có phanh L2) ---------------- */

function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const v = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / v;
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-12));
}

export function fit(rows, l2 = LEARN.L2) {
  const X = rows.map(r => encode(r)), y = rows.map(r => (r.o === 'W' ? 1 : 0));
  const k = FEATS.length + 1, n = X.length;
  const w = new Array(k).fill(0);
  const base = y.reduce((a, b) => a + b, 0) / Math.max(1, n);
  w[0] = Math.log((base + 1e-3) / (1 - base + 1e-3));
  for (let it = 0; it < 30; it++) {
    const g = new Array(k).fill(0), Hs = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let r = 0; r < n; r++) {
      const x = X[r];
      let z = w[0];
      for (let j = 1; j < k; j++) if (x[j - 1]) z += w[j];
      const p = 1 / (1 + Math.exp(-z)), s = p * (1 - p), e = p - y[r];
      g[0] += e; Hs[0][0] += s;
      for (let j = 1; j < k; j++) {
        if (!x[j - 1]) continue;
        g[j] += e; Hs[0][j] += s; Hs[j][0] += s;
        for (let m = 1; m < k; m++) if (x[m - 1]) Hs[j][m] += s;
      }
    }
    for (let j = 1; j < k; j++) { g[j] += l2 * w[j]; Hs[j][j] += l2; }
    Hs[0][0] += 1e-6;
    const step = solve(Hs, g);
    let mx = 0;
    for (let j = 0; j < k; j++) { w[j] -= step[j]; mx = Math.max(mx, Math.abs(step[j])); }
    if (mx < 1e-6) break;
  }
  return { w, base, n };
}

export function predict(model, f) {
  if (!model || !model.w) return null;
  const x = encode(f);
  let z = model.w[0];
  for (let j = 0; j < x.length; j++) if (x[j]) z += model.w[j + 1];
  return 1 / (1 + Math.exp(-z));
}

// Những yếu tố đẩy điểm của tín hiệu này lên/xuống (so với nhóm gốc), sắp theo độ mạnh.
export function explain(model, f, top = 4) {
  if (!model || !model.w) return [];
  const p0 = model.base, z0 = Math.log(p0 / (1 - p0));
  const x = encode(f), out = [];
  for (let j = 0; j < x.length; j++) {
    if (!x[j]) continue;
    const c = model.w[j + 1];
    const d = 1 / (1 + Math.exp(-(z0 + c))) - p0;
    if (Math.abs(d) >= 0.01) out.push({ label: FEATS[j][1], delta: +d.toFixed(3) });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, top);
}

function auc(scores, labels) {
  const idx = scores.map((s, i) => i).sort((a, b) => scores[a] - scores[b]);
  let rank = 0, pos = 0, sumR = 0;
  for (const i of idx) { rank++; if (labels[i]) { pos++; sumR += rank; } }
  const neg = labels.length - pos;
  return pos && neg ? (sumR - (pos * (pos + 1)) / 2) / (pos * neg) : null;
}

const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

const variance = (a, m) => (a.length > 1 ? a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1) : 0);

/**
 * Kiểm tra ngoài mẫu theo thời gian, 3 đoạn nối tiếp (walk-forward):
 *   học trên 55% cũ nhất → thử đoạn 55–70% · học 70% → thử 70–85% · học 85% → thử 85–100%.
 * Tín hiệu học nằm sát ranh giới (kết quả chưa ngã ngũ lúc đó) bị bỏ để khỏi "nhìn trước".
 * Chỉ cho bật lọc khi: đoạn nào lọc cũng giúp, gộp lại tăng ≥ LIFT mỗi lệnh, VÀ chênh lệch giữa nhóm
 * được giữ và nhóm bị bỏ có ý nghĩa thống kê (t ≥ 2) — để không bật lọc vì may rủi.
 */
export function validate(rows) {
  const done = rows.filter(r => r.o === 'W' || r.o === 'L' || r.o === 'T').sort((a, b) => a.t - b.t);
  const n = done.length;
  const out = { ok: false, n, folds: [] };
  if (n < LEARN.MIN_TRAIN + LEARN.MIN_TEST) { out.reason = 'chưa đủ dữ liệu'; return out; }
  const cuts = [0.55, 0.7, 0.85, 1];
  const sel = [], rej = [], all = [], ps = [], ys = [];
  for (let k = 0; k < 3; k++) {
    const a = Math.floor(n * cuts[k]), b = Math.floor(n * cuts[k + 1]);
    const cutT = done[a].t;
    const train = done.slice(0, a).filter(r => r.o !== 'T' && r.t <= cutT - LEARN.HORIZON * H);
    const test = done.slice(a, b);
    if (train.length < LEARN.MIN_TRAIN * 0.6 || test.length < 20) continue;
    const m = fit(train);
    const fs = [], fa = [];
    for (const r of test) {
      const p = predict(m, r), R = realizedR(r);
      fa.push(R); all.push(R);
      if (evOf(p) >= LEARN.EV_MIN) { fs.push(R); sel.push(R); } else rej.push(R);
      if (r.o !== 'T') { ps.push(p); ys.push(r.o === 'W' ? 1 : 0); }
    }
    out.folds.push({ nTrain: train.length, nTest: test.length, keep: +(fs.length / test.length).toFixed(3),
      lift: fs.length ? +(avg(fs) - avg(fa)).toFixed(3) : null });
  }
  if (out.folds.length < 2 || !all.length) { out.reason = 'chưa đủ dữ liệu'; return out; }
  const mA = avg(all), mS = sel.length ? avg(sel) : null, mR = rej.length ? avg(rej) : null;
  out.nTest = all.length; out.nSel = sel.length;
  out.allR = +mA.toFixed(3);
  out.selR = mS == null ? null : +mS.toFixed(3);
  out.keep = +(sel.length / all.length).toFixed(3);
  out.lift = mS == null ? null : +(mS - mA).toFixed(3);
  out.t = mS != null && mR != null && sel.length > 1 && rej.length > 1
    ? +((mS - mR) / Math.sqrt(variance(sel, mS) / sel.length + variance(rej, mR) / rej.length || 1e-9)).toFixed(2) : 0;
  const a = auc(ps, ys); out.auc = a == null ? null : +a.toFixed(3);
  out.from = done[Math.floor(n * cuts[0])].t; out.to = done[n - 1].t;
  const steady = out.folds.every(f => f.lift != null && f.lift > 0);
  out.ok = sel.length >= 30 && out.keep >= 0.15 && out.keep <= 0.95 && out.lift >= LEARN.LIFT && out.t >= 2 && steady;
  out.reason = out.ok ? 'lọc giúp tăng kỳ vọng trên dữ liệu mới, ổn định qua 3 đoạn thời gian'
    : out.keep > 0.95 ? 'mô hình không thấy loại nào đáng bỏ'
    : out.keep < 0.15 ? 'lọc bỏ gần hết tín hiệu — chưa tin'
    : out.lift == null || out.lift < LEARN.LIFT ? 'lọc chưa giúp tăng kỳ vọng trên dữ liệu mới'
    : !steady ? 'lọc lúc giúp lúc không qua các đoạn thời gian — có thể là may rủi'
    : 'chênh lệch còn nằm trong mức may rủi (chưa đủ chắc thống kê)';
  return out;
}

/** Học trên toàn bộ dữ liệu đã có kết quả + kiểm tra ngoài mẫu → mô hình dùng cho giờ tới. */
export function trainAll(rows) {
  const wl = rows.filter(r => r.o === 'W' || r.o === 'L');
  const v = validate(rows);
  const model = { at: Date.now(), nWL: wl.length, ready: wl.length >= LEARN.MIN_TRAIN, filtering: false, validation: v, feats: FEATS.map(f => f[0]) };
  if (model.ready) {
    const m = fit(wl);
    Object.assign(model, { w: m.w.map(x => +x.toFixed(4)), base: +m.base.toFixed(4) });
    model.filtering = v.ok;
    model.factors = FEATS.map(([key, label], j) => {
      const z0 = Math.log(m.base / (1 - m.base));
      return { key, label, coef: +m.w[j + 1].toFixed(3), delta: +(1 / (1 + Math.exp(-(z0 + m.w[j + 1]))) - m.base).toFixed(3) };
    }).sort((a, b) => b.delta - a.delta);
  }
  return model;
}

/* ---------------- thống kê cho app ---------------- */

const GROUPS = [
  ['Loại', r => ({ BREAK: 'Phá', CONFIRM: 'Xác nhận', RETEST: 'Retest' }[r.ty])],
  ['Chiều', r => (r.d === 1 ? 'LONG' : 'SHORT')],
  ['Cỡ mô hình', r => (r.sp < 40 ? '< 40 nến' : r.sp < 100 ? '40–99 nến' : r.sp < 250 ? '100–249 nến' : '250+ nến'), ['< 40 nến', '40–99 nến', '100–249 nến', '250+ nến']],
  ['Số lần chạm', r => (r.tc >= 4 ? '4+ chạm' : '3 chạm'), ['3 chạm', '4+ chạm']],
  ['Cấu trúc', r => (r.cf ? 'Đã gãy cấu trúc' : 'Chưa gãy')],
  ['Kiểu đường', r => ({ rev: 'Đảo chiều', flat: 'Đường ngang', acc: 'Theo đà' }[r.kd])],
  ['Độ dốc', r => (r.st ? 'Dốc' : 'Thoải')],
  ['Khối lượng nến', r => (r.vr < 1 ? '< trung bình' : r.vr < 2 ? '1–2×' : '≥ 2×'), ['< trung bình', '1–2×', '≥ 2×']],
  ['Đóng cách đường', r => (r.ds < 1 ? '< 1 ATR' : r.ds < 2 ? '1–2 ATR' : '≥ 2 ATR'), ['< 1 ATR', '1–2 ATR', '≥ 2 ATR']],
  ['EMA200', r => (r.em == null ? 'Chưa đủ nến' : r.em ? 'Cùng chiều' : 'Ngược chiều')],
  ['Đã đẩy về máy', r => (r.pu == null ? 'Trước khi bot chạy' : r.pu ? 'Có' : 'Không')],
];

function summarize(rows) {
  const W = rows.filter(r => r.o === 'W').length, Lo = rows.filter(r => r.o === 'L').length, T = rows.filter(r => r.o === 'T').length;
  const Rs = rows.map(realizedR).filter(x => x != null);
  const d24 = rows.filter(r => r.r24 != null);
  return {
    n: rows.length, W, L: Lo, T,
    win: W + Lo ? +(W / (W + Lo)).toFixed(3) : null,
    avgR: Rs.length ? +avg(Rs).toFixed(3) : null,
    dir24: d24.length ? +(d24.filter(r => r.r24 > 0).length / d24.length).toFixed(3) : null,
  };
}

export function buildStats(rows, model) {
  const done = rows.filter(r => ['W', 'L', 'T'].includes(r.o));
  const week = done.filter(r => r.t >= Date.now() - 7 * 24 * H);
  return {
    at: Date.now(),
    rule: { TP: LEARN.TP, SL: LEARN.SL, HORIZON: LEARN.HORIZON, breakeven: +BREAKEVEN.toFixed(3) },
    all: { ...summarize(done), pending: rows.filter(r => r.o === 'P').length, from: done.length ? Math.min(...done.map(r => r.t)) : null },
    week: summarize(week),
    groups: GROUPS.map(([name, key, order]) => {
      const m = new Map();
      for (const r of done) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
      const rank = l => (order ? order.indexOf(l) : -1);
      return { name, rows: [...m.entries()].map(([label, rs]) => ({ label, ...summarize(rs) })).sort((a, b) => (order ? rank(a.label) - rank(b.label) : b.n - a.n)) };
    }),
    model: model ? { ready: model.ready, filtering: model.filtering, nWL: model.nWL, base: model.base, validation: model.validation, factors: model.factors || [] } : null,
  };
}
