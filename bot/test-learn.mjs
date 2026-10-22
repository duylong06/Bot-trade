// Kiểm thử phần ghi nhớ & tự học. Chạy: node bot/test-learn.mjs
import fs from 'node:fs';
import { outcome, fit, predict, validate, trainAll, buildStats, featuresAt, encode, FEATS, LEARN, evOf, realizedR } from '../core/learn.js';
import { analyze } from '../core/breakout.js';

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const H = 3600000, t0 = Date.UTC(2026, 8, 1);

// nến dựng tay: mảng [h, l, c] sau nến vào lệnh (nến vào lệnh có giá đóng 100)
function mk(after) {
  const K = { t: [t0], o: [100], h: [100], l: [100], c: [100], v: [1] };
  after.forEach(([h, l, c], k) => { K.t.push(t0 + (k + 1) * H); K.o.push(K.c[K.c.length - 1]); K.h.push(h); K.l.push(l); K.c.push(c); K.v.push(1); });
  return K;
}
const flat = n => Array.from({ length: n }, () => [100.5, 99.5, 100]);

console.log('1. Chấm kết quả (vào 100, ATR 1 → mục tiêu 102, dừng lỗ 99)');
{
  let r = outcome(mk([...flat(4), [102.3, 100, 102]]), t0, 1, 100, 1);
  ok(r.o === 'W' && r.h === 5, `LONG chạm 102 ở nến thứ 5 → thắng (được ${r.o}, ${r.h})`);
  r = outcome(mk([...flat(2), [100, 98.8, 99]]), t0, 1, 100, 1);
  ok(r.o === 'L' && r.h === 3, `LONG thủng 99 ở nến thứ 3 → thua (được ${r.o}, ${r.h})`);
  r = outcome(mk([[102.5, 98.5, 100]]), t0, 1, 100, 1);
  ok(r.o === 'L', `cùng một nến chạm cả hai → tính thua (được ${r.o})`);
  r = outcome(mk(flat(80)), t0, 1, 100, 1);
  ok(r.o === 'T' && r.r72 === 0, `72 nến không chạm gì → hết giờ (được ${r.o}, r72=${r.r72})`);
  r = outcome(mk(flat(10)), t0, 1, 100, 1);
  ok(r.o === 'P' && r.now === 0, `mới 10 nến → còn chờ (được ${r.o})`);
  r = outcome(mk([...flat(3), [100, 97.8, 98]]), t0, -1, 100, 1);
  ok(r.o === 'W', `SHORT xuống 98 → thắng (được ${r.o})`);
  r = outcome(mk([...flat(5), [102.4, 101, 102.2], ...flat(30)]), t0, 1, 100, 1);
  ok(r.r6 === 2.2 && r.mfe >= 2.4, `ghi lại lãi sau 6 nến (r6=${r.r6}) và đỉnh lãi (mfe=${r.mfe})`);
  ok(realizedR({ o: 'W' }) === 2 && realizedR({ o: 'L' }) === -1 && realizedR({ o: 'T', r72: 0.4 }) === 0.4, 'quy ra R: thắng +2R, thua −1R, hết giờ = lãi lúc 72 nến');
  ok(Math.abs(evOf(1 / 3)) < 1e-9, 'thắng 33,3% với mục tiêu 2R / dừng 1R là hoà vốn');
}

// dữ liệu học giả: "đã gãy cấu trúc" thắng 60%, còn lại 25%; các yếu tố khác ngẫu nhiên
function rng(s) { let a = s >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function fake(n, seed, signal = true) {
  const r = rng(seed), rows = [];
  for (let i = 0; i < n; i++) {
    const cf = r() < 0.4 ? 1 : 0;
    const p = signal ? (cf ? 0.6 : 0.25) : 0.36;
    const u = r();
    rows.push({ t: t0 + i * H, ty: ['BREAK', 'CONFIRM', 'RETEST'][Math.floor(r() * 3)], d: r() < 0.5 ? 1 : -1, sp: Math.floor(10 + r() * 400), tc: 3 + Math.floor(r() * 3),
      cf, st: r() < 0.3 ? 1 : 0, kd: ['rev', 'flat', 'acc'][Math.floor(r() * 3)], vr: +(r() * 3).toFixed(2), em: r() < 0.5 ? 1 : 0, ds: +(0.5 + r() * 2).toFixed(2),
      o: u < p ? 'W' : u < p + 0.08 ? 'T' : 'L', r72: 0.2 });
  }
  return rows;
}

console.log('2. Học yếu tố thật');
{
  const rows = fake(1500, 1);
  const m = fit(rows.filter(r => r.o !== 'T'));
  const j = FEATS.findIndex(f => f[0] === 'cf') + 1;
  const others = m.w.slice(1).filter((_, k) => k + 1 !== j).map(Math.abs);
  ok(m.w[j] > 1, `"đã gãy cấu trúc" được học là yếu tố tốt (hệ số ${m.w[j].toFixed(2)})`);
  ok(Math.max(...others) < 0.35, `các yếu tố ngẫu nhiên gần 0 (lớn nhất ${Math.max(...others).toFixed(2)})`);
  const pY = predict(m, { ...rows[0], cf: 1 }), pN = predict(m, { ...rows[0], cf: 0 });
  ok(pY > 0.5 && pN < 0.35, `xác suất: gãy cấu trúc ${(pY * 100).toFixed(0)}% · chưa gãy ${(pN * 100).toFixed(0)}%`);
}

console.log('3. Kiểm tra ngoài mẫu: chỉ bật lọc khi lọc thật sự giúp');
{
  const good = validate(fake(1500, 2, true));
  ok(good.ok, `có yếu tố thật → bật lọc (báo tất cả ${good.allR}R → chỉ loại bot chọn ${good.selR}R, giữ ${(good.keep * 100).toFixed(0)}%)`);
  const noise = validate(fake(1500, 3, false));
  ok(!noise.ok, `toàn nhiễu → KHÔNG bật lọc (${noise.reason})`);
  const few = validate(fake(100, 4, true));
  ok(!few.ok && few.reason === 'chưa đủ dữ liệu', 'ít dữ liệu → chưa bật lọc');
  const model = trainAll(fake(1500, 5, true));
  ok(model.ready && model.filtering && model.factors[0].key === 'cf', `mô hình hoàn chỉnh: sẵn sàng, đang lọc, yếu tố mạnh nhất = ${model.factors[0].label}`);
  const st = buildStats(fake(800, 6, true), model);
  ok(st.groups.length >= 8 && st.all.win > 0.2, `bảng thống kê: ${st.all.n} tín hiệu, thắng ${(st.all.win * 100).toFixed(0)}%, kỳ vọng ${st.all.avgR}R`);
}

console.log('3b. Cửa kiểm tra có bị may rủi lừa không');
{
  // 40 bộ toàn nhiễu (thắng 33% mọi loại) — số lần bật lọc nhầm phải gần 0
  let fp = 0; for (let s = 100; s < 140; s++) if (validate(fake(1400, s, false)).ok) fp++;
  ok(fp <= 1, `nhiễu: bật lọc nhầm ${fp}/40 lần`);
  // yếu tố thật nhưng YẾU: gãy cấu trúc 45% so với 30% — phải bắt được phần lớn
  const weak = (n, seed) => fake(n, seed, true).map((r, i) => { const u = rng(seed * 7 + i)(); return { ...r, o: u < (r.cf ? 0.45 : 0.30) ? 'W' : 'L' }; });
  let tp = 0; for (let s = 200; s < 220; s++) if (validate(weak(2000, s)).ok) tp++;
  ok(tp >= 12, `yếu tố yếu (45% vs 30%), 2.000 tín hiệu: bắt được ${tp}/20 lần`);
}

console.log('4. Đặc trưng trên nến thật');
{
  const f = new URL('../out/dryrun-candles.json', import.meta.url).pathname;
  if (fs.existsSync(f)) {
    const { data } = JSON.parse(fs.readFileSync(f, 'utf8'));
    let n = 0, bad = 0;
    const t1 = performance.now();
    for (const K of Object.values(data)) {
      const r = analyze(K);
      for (const e of r.events) {
        const ft = featuresAt(r.W, r.A, e); n++;
        // retest đóng cửa sát đường nên khoảng cách có thể hơi âm (≥ −0,15 ATR)
        if (!(ft.vr > 0 && isFinite(ft.ds) && ft.ds > (e.type === 'RETEST' ? -0.2 : 0) && encode(ft).length === FEATS.length)) bad++;
      }
    }
    ok(n > 100 && bad === 0, `${n} tín hiệu thật, đặc trưng hợp lệ hết (${(performance.now() - t1).toFixed(0)} ms)`);
  } else console.log('  – bỏ qua (chưa có nến thật trong out/)');
}

console.log('5. Tốc độ học');
{
  const rows = fake(10000, 7);
  const t1 = performance.now(); trainAll(rows); const ms = performance.now() - t1;
  ok(ms < 3000, `10.000 tín hiệu học + kiểm tra trong ${ms.toFixed(0)} ms`);
}

console.log(fails ? `\n${fails} kiểm thử sai` : '\nTất cả đều đúng');
process.exit(fails ? 1 : 0);
