// TẠM (chỉ cho workflow thử): tạo vài cú phá H1 đang "chờ M30" đã tới hạn để bước M30 chạy thật
// (lấy nến M30, xét luật, chấm điểm). Xoá cùng workflow thử trước khi gộp vào main.
import fs from 'node:fs';
import * as okx from '../../core/okx.js';
import { analyze, HOUR } from '../../core/breakout.js';
import { m30CloseOf } from '../../core/confirm.js';
const st = JSON.parse(fs.readFileSync('out/state.json')), sig = JSON.parse(fs.readFileSync('out/signals.json'));
const top = JSON.parse(fs.readFileSync('out/top.json'));
okx.setThrottle(80); await okx.pickHost();
const now = Date.now(), picked = [];
for (const u of top.list.slice(0, 60)) {
  if (picked.length >= 4) break;
  const K = (await okx.candles(u.instId, '1H', 1200)).K;
  const r = analyze(K, '1H');
  const e = r.events.filter(x => x.type === 'BREAK' && m30CloseOf(x.t) < now - 60e3 && now - m30CloseOf(x.t) < 20 * HOUR).pop();
  if (!e) continue;
  const key = `${u.instId}|BREAK|${e.side}|${e.line.tBreak}`;
  st.pending[key] = { key, instId: u.instId, coin: u.coin, dir: e.dir, t: e.t, h1: e.bar, m30Close: m30CloseOf(e.t) };
  sig.unshift({ id: key, instId: u.instId, coin: u.coin, type: 'BREAK', dir: e.dir, side: e.side, t: e.t, close: e.close, atr: e.atr, linePrice: e.linePrice, level: e.level,
    confirmed: e.confirmed, others: e.others, tickSz: null, line: e.line, bar: e.bar, tf: '1H', cls: e.cls, vol: e.vol, sc: null, sentAt: now, pushed: 0, pu: 0, why: null, m30: 'wait', m30Close: m30CloseOf(e.t) });
  picked.push(`${u.coin} ${e.dir} ${new Date(e.t).toISOString()}`);
}
fs.writeFileSync('out/state.json', JSON.stringify(st)); fs.writeFileSync('out/signals.json', JSON.stringify(sig));
console.log('Đã tạo cú phá chờ M30:', picked.join(' · ') || 'không có');
