// Kiểm thử lõi phát hiện phá vỡ trên dữ liệu dựng sẵn.
// Chạy: node bot/test-core.mjs
import fs from 'node:fs';
import { analyze, CFG, HOUR } from '../core/breakout.js';

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fails++; };

function rng(s) { let a = s >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Dựng nến từ các điểm mốc (chỉ số, giá) + nhiễu; giá đóng bị "ghim" đúng mốc tại các điểm pin.
function gen({ n, keys, seed = 1, amp = 0.6, wick = 0.4, pin = [] }) {
  const r = rng(seed), base = [];
  for (let i = 0; i < n; i++) {
    let j = 0; while (j < keys.length - 2 && keys[j + 1][0] <= i) j++;
    const a = keys[j], b = keys[j + 1];
    const t = Math.max(0, Math.min(1, (i - a[0]) / ((b[0] - a[0]) || 1)));
    base.push(a[1] + (b[1] - a[1]) * (t * t * (3 - 2 * t)));
  }
  const damp = i => { let m = 1; for (const p of pin) { const d = Math.abs(i - p); if (d < 5) m = Math.min(m, d / 5); } return m; };
  let dv = 0; const c = [];
  for (let i = 0; i < n; i++) { dv = dv * 0.8 + (r() * 2 - 1) * amp; c.push(base[i] + dv * damp(i)); }
  const K = { t: [], o: [], h: [], l: [], c, v: [] };
  const t0 = Date.UTC(2026, 8, 1);
  for (let i = 0; i < n; i++) {
    const o = i ? c[i - 1] : c[0];
    K.t.push(t0 + i * HOUR); K.o.push(o);
    K.h.push(Math.max(o, c[i]) + r() * wick); K.l.push(Math.min(o, c[i]) - r() * wick); K.v.push(100);
  }
  return K;
}
// ghi đè một cây nến
function setBar(K, i, o, h, l, c) { K.o[i] = o; K.h[i] = h; K.l[i] = l; K.c[i] = c; if (i + 1 < K.c.length) K.o[i + 1] = c; }
const show = ev => `${ev.type} ${ev.dir} @${ev.i} span=${ev.line.span} touches=${ev.line.touches} ${ev.line.kind}${ev.confirmed ? ' [đã gãy cấu trúc]' : ''}`;

/* 1. Kháng cự giảm 200 nến, phá lên bằng nến thân dài */
{
  console.log('1. Kháng cự giảm — phá LÊN');
  const K = gen({ n: 200, seed: 7, amp: 0.5, wick: 0.35,
    keys: [[0, 125.5], [14, 130], [34, 118], [56, 124.14], [76, 112], [100, 118], [122, 107], [146, 111.58], [158, 105.5], [166, 107], [175, 114], [190, 118], [199, 119]],
    pin: [14, 56, 100, 146] });
  // nến 168 là nến phá dứt khoát
  const y = 130 - (168 - 14) * (12 / 86);
  setBar(K, 168, K.c[167], y + 2.4, K.c[167] - 0.1, y + 2.1);
  const { events } = analyze(K);
  events.slice(-6).forEach(e => console.log('    ' + show(e)));
  const br = events.find(e => e.type === 'BREAK' && e.dir === 'LONG' && e.i >= 165 && e.i <= 172);
  ok(!!br, 'có BREAK LONG quanh nến 168');
  ok(br && br.line.span >= 100, 'đường dài ≥ 100 nến (span=' + (br && br.line.span) + ')');
  ok(br && br.line.touches >= 3, 'đường ≥ 3 chạm');
  ok(br && br.line.kind === 'kháng cự giảm', 'loại: kháng cự giảm');
}

/* 2. Hỗ trợ tăng, phá xuống */
{
  console.log('2. Hỗ trợ tăng — phá XUỐNG');
  const K = gen({ n: 200, seed: 9, amp: 0.5, wick: 0.35,
    keys: [[0, 110], [20, 106], [55, 116], [95, 112], [130, 125], [170, 118], [185, 124], [192, 121], [199, 116]],
    pin: [20, 95, 170] });
  const y = 106 + (192 - 20) * (6 / 75);
  setBar(K, 192, K.c[191], K.c[191] + 0.1, y - 2.6, y - 2.2);
  const { events } = analyze(K);
  events.slice(-6).forEach(e => console.log('    ' + show(e)));
  const br = events.find(e => e.type === 'BREAK' && e.dir === 'SHORT' && e.i >= 189 && e.i <= 195);
  ok(!!br, 'có BREAK SHORT quanh nến 192');
  ok(br && br.line.kind === 'hỗ trợ tăng', 'loại: hỗ trợ tăng');
}

/* 3. Nến thật OKX 22/10/2026 — các ca chủ repo chỉ ra */
{
  console.log('3. Nến thật: báo ngay cây đầu tiên đóng ngoài đường; neo ở đáy thật');
  const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/okx-h1-2026-10-22.json', import.meta.url), 'utf8'));
  const load = c => { const { t0, rows } = fx[c]; return { t: rows.map((_, i) => t0 + i * HOUR), o: rows.map(r => r[0]), h: rows.map(r => r[1]), l: rows.map(r => r[2]), c: rows.map(r => r[3]), v: rows.map(() => 100) }; };
  const VN = (d, h) => Date.UTC(2026, 9, d, h - 7);       // giờ Việt Nam → mili giây
  const breakAt = (coin, t) => analyze(load(coin)).events.find(e => e.type === 'BREAK' && e.dir === 'SHORT' && e.t === t && e.line.kind === 'hỗ trợ tăng');
  for (const [coin, h, was] of [['DASH', 9, 15], ['ETH', 12, 15], ['AAVE', 14, 15]]) {
    const br = breakAt(coin, VN(22, h));
    if (br) console.log(`    ${coin}: ${show(br)}`);
    ok(!!br, `${coin}: báo phá hỗ trợ tăng ngay nến ${h}:00 22/10 (trước đây ${was}:00)`);
  }
  for (const [coin, mid, bottom] of [['APT', VN(20, 1), VN(19, 3)], ['ONDO', VN(20, 2), VN(19, 3)]]) {
    const r = analyze(load(coin));
    const used = [...r.events.map(e => e.line), ...r.lines].filter(L => L.ta === mid);
    ok(!used.length, `${coin}: không kẻ đường neo ở đáy nhỏ giữa vùng (${used.length} đường)`);
    if (coin === 'ONDO') ok(r.events.some(e => e.type === 'BREAK' && e.dir === 'SHORT' && e.line.ta === bottom), 'ONDO: đường neo ở đáy thật 19/10 03:00 bị phá xuống được báo');
  }
}

/* 4. Râu chọc qua nhưng thân đóng trong → KHÔNG báo; sau đó đóng cửa dứt khoát → báo */
{
  console.log('4. Râu không tính');
  const K = gen({ n: 120, seed: 21, amp: 0.4, wick: 0.3,
    keys: [[0, 112], [10, 116], [25, 108], [40, 114], [55, 106], [70, 112], [85, 104], [95, 106], [110, 108], [119, 109]],
    pin: [10, 40, 70] });
  const y = i => 116 - (i - 10) * (2 / 30);
  setBar(K, 96, K.c[95], y(96) + 3, K.c[95] - 0.1, y(96) - 0.6);   // râu xuyên 3, thân đóng trong
  setBar(K, 104, K.c[103], y(104) + 2.4, K.c[103] - 0.1, y(104) + 2.0); // đóng cửa vượt dứt khoát
  const { events } = analyze(K);
  events.slice(-5).forEach(e => console.log('    ' + show(e)));
  ok(!events.some(e => e.type === 'BREAK' && e.i === 96), 'nến 96 (chỉ râu) không thành phá vỡ');
  ok(events.some(e => e.type === 'BREAK' && e.dir === 'LONG' && e.i === 104), 'nến 104 (đóng cửa vượt) là phá vỡ');
}

/* 5. Retest sau khi phá */
{
  console.log('5. Retest');
  const K = gen({ n: 150, seed: 33, amp: 0.35, wick: 0.25,
    keys: [[0, 121], [6, 124], [20, 117], [36, 114], [48, 116], [57, 119.5], [66, 125], [74, 127], [84, 122], [94, 118], [104, 122], [149, 126]],
    pin: [6] });
  // Kháng cự nối 3 đỉnh ở 6, 30, 52: đặt râu đúng đường y = 124 - 0.074*(i-6)
  const y = i => 124 - 0.074 * (i - 6);
  for (const p of [30, 52]) { K.h[p] = y(p); for (const q of [p - 3, p - 2, p - 1, p + 1, p + 2, p + 3]) K.h[q] = Math.min(K.h[q], y(p) - 0.3); }
  setBar(K, 58, K.c[57], y(58) + 2.3, K.c[57] - 0.1, y(58) + 2.0);
  // Lấy đúng đường bot tìm được, rồi đặt nến 94: râu chạm lại đường đó, đóng cửa phía trên.
  const first = analyze(K);
  const L = first.all.filter(x => x.state === 'broken' && x.b === 58).sort((a, b) => b.span - a.span)[0];
  const yl = L.y0 + L.m * 94, a94 = first.A[94];
  setBar(K, 94, K.c[93], K.c[93] + 0.2, yl + 0.1 * a94, yl + 0.9 * a94);
  const { events } = analyze(K);
  events.forEach(e => console.log('    ' + show(e)));
  const br = events.find(e => e.type === 'BREAK' && e.dir === 'LONG' && e.i === 58);
  ok(!!br, 'BREAK LONG ở nến 58');
  ok(events.some(e => e.type === 'RETEST' && e.dir === 'LONG' && e.i >= 88 && e.i <= 96), 'RETEST LONG quanh nến 94');
}

/* 6. Hiệu năng: 500 nến, nhiều nhiễu */
{
  console.log('6. Hiệu năng 520 nến');
  const keys = []; for (let i = 0; i <= 520; i += 13) keys.push([i, 100 + 8 * Math.sin(i / 40) + 3 * Math.sin(i / 9)]);
  const K = gen({ n: 520, seed: 77, amp: 0.8, wick: 0.5, keys });
  const t0 = performance.now(); const r = analyze(K); const ms = performance.now() - t0;
  console.log(`    ${r.all.length} đường hợp lệ, ${r.events.length} sự kiện, vẽ ${r.lines.length} đường — ${ms.toFixed(0)} ms`);
  ok(r.W.c.length === CFG.WINDOW, 'chỉ xét đúng 500 nến cuối');
  ok(ms < 1500, 'chạy dưới 1,5 giây một đồng');
}

/* 7. Hỗ trợ tăng dốc, giá trôi qua bằng nến nhỏ rồi mới sập (NEAR 20–22/10/2026, nến thật): báo ngay cây đầu */
{
  console.log('7. Đường dốc NEAR: báo ngay cây đầu tiên đóng dưới đường (06:00 22/10)');
  const rows = [
  [4.869,5.004,4.861,4.934], [4.935,5.011,4.921,4.994], [4.994,5.061,4.986,5.038], [5.039,5.049,4.966,4.977], [4.977,4.982,4.921,4.938],
  [4.937,5.022,4.93,4.999], [4.999,5.02,4.932,4.965], [4.964,4.995,4.937,4.958], [4.959,5.019,4.949,5.004], [5.004,5.011,4.951,4.968],
  [4.967,4.977,4.89,4.925], [4.925,4.944,4.9,4.925], [4.925,4.925,4.804,4.806], [4.806,4.814,4.677,4.713], [4.713,4.741,4.671,4.737],
  [4.736,4.795,4.719,4.785], [4.785,4.832,4.747,4.773], [4.771,4.795,4.736,4.762], [4.762,4.763,4.631,4.645], [4.645,4.689,4.615,4.677],
  [4.677,4.763,4.676,4.752], [4.752,4.97,4.75,4.956], [4.955,5.034,4.935,5.013], [5.013,5.047,4.969,5.005], [5.005,5.092,5.004,5.048],
  [5.048,5.082,5.001,5.035], [5.035,5.039,4.988,5.028], [5.028,5.088,5.011,5.075], [5.076,5.077,5.026,5.055], [5.055,5.078,5.039,5.049],
  [5.048,5.135,5.048,5.065], [5.065,5.095,5.014,5.076], [5.075,5.092,5.044,5.046], [5.046,5.064,4.955,5.001], [5.001,5.001,4.92,4.95],
  [4.95,5.024,4.942,5.001], [5.001,5.043,4.92,4.923], [4.924,5.002,4.862,4.928], [4.928,4.963,4.883,4.906], [4.905,4.99,4.884,4.954],
  [4.955,4.994,4.918,4.919], [4.92,4.986,4.89,4.942], [4.943,4.973,4.896,4.917], [4.918,4.972,4.892,4.917], [4.917,4.937,4.874,4.889],
  [4.889,4.985,4.889,4.922], [4.921,4.939,4.89,4.899], [4.899,4.912,4.808,4.825], [4.825,4.886,4.782,4.865], [4.865,4.886,4.784,4.837],
  [4.838,4.871,4.802,4.861], [4.861,4.871,4.795,4.798], [4.799,4.829,4.761,4.782], [4.782,4.793,4.744,4.782], [4.783,4.806,4.757,4.78],
  [4.779,4.785,4.708,4.747], [4.746,4.756,4.69,4.701], [4.702,4.709,4.651,4.677], [4.677,4.706,4.628,4.669], [4.668,4.722,4.665,4.687],
  [4.687,4.755,4.651,4.75], [4.75,5.094,4.743,5.053], [5.053,5.056,4.751,4.847], [4.847,4.966,4.804,4.957], [4.957,4.98,4.911,4.961],
  [4.962,4.964,4.881,4.91], [4.911,4.914,4.815,4.862], [4.862,4.98,4.835,4.977], [4.976,4.998,4.949,4.966], [4.966,4.999,4.927,4.929],
  [4.929,4.936,4.883,4.929], [4.929,5.04,4.904,4.995], [4.994,5.08,4.957,5.011], [5.011,5.098,4.98,5.067], [5.067,5.068,4.999,5.031],
  [5.03,5.055,5.003,5.013], [5.013,5.05,4.968,4.97], [4.97,5.084,4.957,5.071], [5.07,5.257,5.068,5.203], [5.204,5.28,5.151,5.218],
  [5.218,5.248,5.194,5.197], [5.198,5.204,5.115,5.173], [5.174,5.217,5.148,5.168], [5.168,5.269,5.158,5.221], [5.221,5.27,5.136,5.174],
  [5.173,5.29,5.144,5.285], [5.286,5.404,5.274,5.385], [5.384,5.452,5.3,5.308], [5.308,5.38,5.298,5.356], [5.356,5.38,5.276,5.288],
  [5.287,5.337,5.229,5.306], [5.306,5.324,5.244,5.279], [5.277,5.379,5.261,5.344], [5.345,5.347,5.28,5.294], [5.294,5.305,5.217,5.259],
  [5.26,5.323,5.249,5.293], [5.293,5.334,5.188,5.207], [5.207,5.228,5.113,5.157], [5.156,5.175,5.099,5.122], [5.123,5.142,5.046,5.08],
  ];
  const t0 = 1792285200000;
  const K = { t: rows.map((_, i) => t0 + i * HOUR), o: rows.map(r => r[0]), h: rows.map(r => r[1]), l: rows.map(r => r[2]), c: rows.map(r => r[3]), v: rows.map(() => 100) };
  const { events } = analyze(K);
  const br = events.find(e => e.type === 'BREAK' && e.dir === 'SHORT' && e.i === 94);
  if (br) console.log('    ' + show(br));
  ok(!!br, 'có BREAK SHORT ở nến 06:00 22/10 (trước đây 08:00)');
  ok(br && br.line.kind === 'hỗ trợ tăng' && br.line.span >= 30, 'đúng đường hỗ trợ tăng ~38 nến');
}

console.log(fails ? `\n${fails} kiểm thử sai` : '\nTất cả đều đúng');
process.exit(fails ? 1 : 0);
