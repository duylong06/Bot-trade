// Lấy lịch sử nến H1 nhiều đồng để kiểm chứng cách đặt SL. Nhánh tạm, không liên quan bot.
import fs from 'node:fs';
const API = 'https://www.okx.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BARS = +(process.env.BARS || 12000);

async function okx(path, q) {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'bot-trade-research' } });
      const j = await r.json();
      if (j.code === '0') return j.data;
      console.log('  okx code', j.code, j.msg);
    } catch (e) { console.log('  lỗi mạng', e.message); }
    await sleep(800 * (i + 1));
  }
  return null;
}

async function candles(inst, bar, want) {
  let all = [], after;
  while (all.length < want) {
    const q = { instId: inst, bar, limit: '100' }; if (after) q.after = after;
    const d = await okx('/api/v5/market/history-candles', q);
    if (!d || !d.length) break;
    all = all.concat(d); after = d[d.length - 1][0];
    await sleep(170);
  }
  // chỉ nến đã đóng, cũ → mới, bỏ cột không cần
  return all.filter(r => r[8] === '1').map(r => [+r[0], +r[1], +r[2], +r[3], +r[4], +r[5]]).sort((a, b) => a[0] - b[0]);
}

const top = await okx('/api/v5/public/instruments', { instType: 'SWAP' });
const tick = await okx('/api/v5/market/tickers', { instType: 'SWAP' });
// volCcy24h là khối lượng tính bằng SỐ COIN, nên coin giá rẻ sẽ có số khổng lồ.
// Phải quy ra USD bằng cách nhân giá, nếu không danh sách toàn meme coin.
const vol = new Map((tick || []).map(t => [t.instId, (+t.volCcy24h || 0) * (+t.last || 0)]));
const NOT = new Set(['XAU','XAG','XPT','XPD','CL','BZ','NG','HG','SPX','NDX','DJI','VIX']);
const list = (top || [])
  .filter(x => x.settleCcy === 'USDT' && x.state === 'live' && String(x.instCategory || '') === '1')
  .filter(x => !NOT.has(x.instId.split('-')[0]))
  .sort((a, b) => (vol.get(b.instId) || 0) - (vol.get(a.instId) || 0))
  .slice(0, +(process.env.COINS_N || 20))
  .map(x => x.instId);

console.log(`${list.length} đồng: ${list.join(' ')}`);
fs.mkdirSync('out', { recursive: true });
const meta = {};
for (const inst of list) {
  const k = await candles(inst, '1H', BARS);
  if (k.length < 2000) { console.log(`${inst}: chỉ ${k.length} nến, bỏ`); continue; }
  const coin = inst.split('-')[0];
  fs.writeFileSync(`out/${coin}.json`, JSON.stringify(k));
  const d0 = new Date(k[0][0]).toISOString().slice(0, 10), d1 = new Date(k.at(-1)[0]).toISOString().slice(0, 10);
  meta[coin] = { inst, bars: k.length, from: d0, to: d1 };
  console.log(`${coin}: ${k.length} nến H1  ${d0} → ${d1}`);
}
fs.writeFileSync('out/meta.json', JSON.stringify(meta, null, 1));
console.log(`\nXong ${Object.keys(meta).length} đồng.`);
