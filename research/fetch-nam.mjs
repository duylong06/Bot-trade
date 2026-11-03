// Lấy nến lịch sử nhiều năm từ OKX để đo độ dài trendline (chạy trên GitHub Actions). Không liên quan tới bot.
import fs from 'node:fs';
import zlib from 'node:zlib';
const ALL = ['BTC','ETH','BNB','XRP','SOL','TRX','DOGE','ADA','LINK','LTC','AVAX','DOT','BCH','UNI','ATOM','NEAR','AAVE','APT','ARB','SUI','OP','INJ','FIL','ETC'];
const GROUP = +(process.env.GROUP || 0), GROUPS = +(process.env.GROUPS || 4);
const COINS = ALL.filter((_, i) => i % GROUPS === GROUP);
const DAYS = +(process.env.DAYS || 1200);
const HOSTS = ['https://www.okx.com', 'https://aws.okx.com'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let host = HOSTS[0];
async function get(path, q) {
  for (let a = 0; a < 8; a++) {
    try {
      const r = await fetch(host + path + '?' + new URLSearchParams(q));
      if (r.status === 429) { await sleep(1000 * (a + 1)); continue; }
      const j = await r.json();
      if (j.code === '0') return j.data;
      if (j.code === '51001') return null;
      throw new Error(j.code + ' ' + j.msg);
    } catch (e) { if (a === 7) throw e; host = HOSTS[(a + 1) % HOSTS.length]; await sleep(500 * (a + 1)); }
  }
}
async function history(instId, bar, from) {
  const rows = new Map(); let after = '';
  for (let p = 0; p < 3000; p++) {
    const q = { instId, bar, limit: '100' }; if (after) q.after = after;
    const d = await get('/api/v5/market/history-candles', q);
    if (!d || !d.length) break;
    for (const r of d) if (r[8] === '1') rows.set(r[0], r.slice(0, 6).map(Number));
    after = d[d.length - 1][0];
    if (+after < from) break;
    await sleep(110);
  }
  return [...rows.values()].filter(r => r[0] >= from).sort((a, b) => a[0] - b[0]);
}
fs.mkdirSync('research-out', { recursive: true });
const from = Date.now() - DAYS * 864e5, meta = {};
for (const c of COINS) {
  for (const bar of ['4H', '1H', '30m']) {
    const t0 = Date.now();
    const rows = await history(c + '-USDT-SWAP', bar, from);
    meta[c + '|' + bar] = { n: rows.length, first: rows[0] && rows[0][0], last: rows.length && rows[rows.length - 1][0] };
    console.log(c, bar, rows.length, 'nến', ((Date.now() - t0) / 1000).toFixed(1) + 's');
    if (rows.length) fs.writeFileSync(`research-out/${c}-${bar}.json.gz`, zlib.gzipSync(JSON.stringify(rows)));
  }
}
fs.writeFileSync('research-out/meta.json', JSON.stringify({ at: Date.now(), host, meta }, null, 1));
