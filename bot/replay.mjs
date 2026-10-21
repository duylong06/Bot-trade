// bot/replay.mjs — phát lại bot trên nến thật để đếm sẽ có bao nhiêu thông báo.
// Dùng khi chỉnh ngưỡng hoặc thêm mô hình mới.
//
// 1. Đẩy code lên nhánh thử (v2): workflow tự chạy dry-run và lưu nến thật vào nhánh data.
// 2. git fetch origin data && git show FETCH_HEAD:dryrun-candles.json > out/dryrun-candles.json
// 3. node bot/replay.mjs [số giờ, mặc định 48] [-v]
//
// Bot thật chỉ xét sự kiện ở cây nến vừa đóng, nên ở đây ta cắt nến lùi dần từng giờ và làm y như vậy:
// chống trùng, giãn cách 3 nến, gộp theo đồng và gộp tóm tắt khi một giờ có nhiều tín hiệu.

import fs from 'node:fs';
import { analyze, HOUR, sliceK } from '../core/breakout.js';
import { ALERTS, MIN_SPAN_ALERT } from '../core/config.js';
import { plan } from './plan.mjs';

const HOURS = +(process.argv.find(a => /^\d+$/.test(a)) || 48);
const VERBOSE = process.argv.includes('-v');
const file = process.env.CANDLES || 'out/dryrun-candles.json';
const { data } = JSON.parse(fs.readFileSync(file, 'utf8'));
const COOLDOWN = 3;
const coins = Object.keys(data);
const tier = s => s < 40 ? 'nhỏ <40' : s < 100 ? 'vừa 40-99' : s < 250 ? 'lớn 100-249' : 'rất lớn 250+';

const st = Object.fromEntries(coins.map(c => [c, { sent: new Set(), lastBreak: {} }]));
let signals = 0, pushes = 0, lines = 0;
const byType = { BREAK: 0, CONFIRM: 0, RETEST: 0 };
const sizes = { 'nhỏ <40': 0, 'vừa 40-99': 0, 'lớn 100-249': 0, 'rất lớn 250+': 0 };
const spanAtLeast = { 0: 0, 30: 0, 60: 0, 100: 0, 150: 0 };
const perHourSig = [], perHourPush = [], log = [];
const t0 = performance.now();

for (let h = HOURS - 1; h >= 0; h--) {
  const fresh = [];
  for (const inst of coins) {
    const K = data[inst], N = K.c.length;
    const Kh = sliceK(K, 0, N - h);
    const r = analyze(Kh);
    if (h === 0) lines += r.all.length;
    const tLast = Kh.t[Kh.t.length - 1], s = st[inst];
    for (const e of r.events) {
      if (e.t !== tLast || !ALERTS.includes(e.type)) continue;
      for (const m of Object.keys(spanAtLeast)) if (e.line.span >= +m) spanAtLeast[m]++;
      if (e.line.span < MIN_SPAN_ALERT) continue;
      const key = `${e.type}|${e.side}|${e.line.tBreak}`;
      if (s.sent.has(key)) continue;
      s.sent.add(key);
      if (e.type === 'BREAK') {
        const lb = s.lastBreak[e.side];
        if (lb && e.t - lb.t <= COOLDOWN * HOUR && e.line.span < 2 * lb.span) continue;
        s.lastBreak[e.side] = { t: e.t, span: e.line.span };
      }
      fresh.push({ ...e, instId: inst, coin: inst.split('-')[0], tickSz: null });
    }
  }
  const batches = fresh.length ? plan(fresh) : [];
  signals += fresh.length; pushes += batches.length;
  perHourSig.push(fresh.length); perHourPush.push(batches.length);
  for (const e of fresh) { byType[e.type]++; sizes[tier(e.line.span)]++; }
  if (VERBOSE) for (const b of batches) log.push(`${new Date(fresh[0].t + 7 * HOUR).toISOString().slice(5, 16)}  ${b.msg.title}${b.summary ? '  | ' + b.msg.body.split('\n').slice(0, -1).join(' | ') : ''}`);
}

const perDay = x => (x * 24 / HOURS).toFixed(0);
console.log(`Phát lại ${HOURS} giờ × ${coins.length} đồng (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
console.log(`Đường hợp lệ trung bình mỗi đồng: ${(lines / coins.length).toFixed(1)}`);
console.log(`Tín hiệu: ${signals} → ${perDay(signals)}/ngày`, byType);
console.log(`Điện thoại rung: ${pushes} → ${perDay(pushes)}/ngày (sau khi gộp)`);
console.log('Theo cỡ mô hình:', sizes);
console.log('Tín hiệu/ngày nếu chỉ báo mô hình ≥ X nến:', Object.fromEntries(Object.entries(spanAtLeast).map(([k, v]) => [k, +perDay(v)])));
console.log('Tín hiệu mỗi giờ :', perHourSig.join(' '));
console.log('Thông báo mỗi giờ:', perHourPush.join(' '));
if (VERBOSE) console.log('\n' + log.slice(-30).join('\n'));
