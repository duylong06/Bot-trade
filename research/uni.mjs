// Nhánh tạm: lấy dữ liệu UNI từ OKX để phân tích một cú phá trendline H1. Không ảnh hưởng nhánh chính.
import fs from 'node:fs';
const API = 'https://www.okx.com', INST = 'UNI-USDT-SWAP', CCY = 'UNI';
fs.mkdirSync('out', { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(path, q) {
  const u = API + path + '?' + new URLSearchParams(q);
  for (let k = 0; k < 4; k++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const j = await r.json();
      if (j.code === '0') return j.data;
      console.log('lỗi', path, j.code, j.msg);
    } catch (e) { console.log('lỗi mạng', path, String(e)); }
    await sleep(1200);
  }
  return null;
}
async function candles(bar, pages) {            // history-candles phân trang, mới → cũ
  let all = [], after;
  for (let p = 0; p < pages; p++) {
    const q = { instId: INST, bar, limit: '100' }; if (after) q.after = after;
    const d = await get('/api/v5/market/history-candles', q);
    if (!d || !d.length) break;
    all = all.concat(d); after = d[d.length - 1][0]; await sleep(250);
  }
  return all;
}
const out = {};
out.c15m = await candles('15m', 8);
out.c1H = await candles('1H', 6);
out.c4H = await candles('4H', 4);
out.c1D = await candles('1D', 2);
// nến đang chạy (candles trả cả nến chưa đóng) để biết giá hiện tại
out.live1H = await get('/api/v5/market/candles', { instId: INST, bar: '1H', limit: '3' });
out.ticker = await get('/api/v5/market/ticker', { instId: INST });
out.oi1H = await get('/api/v5/rubik/stat/contracts/open-interest-history', { instId: INST, period: '1H', limit: '100' }); await sleep(500);
out.oi1Hb = out.oi1H && out.oi1H.length ? await get('/api/v5/rubik/stat/contracts/open-interest-history', { instId: INST, period: '1H', limit: '100', end: out.oi1H[out.oi1H.length - 1][0] }) : null; await sleep(500);
out.taker1H = await get('/api/v5/rubik/stat/taker-volume', { ccy: CCY, instType: 'CONTRACTS', period: '1H', limit: '180' }); await sleep(500);
out.fund = await get('/api/v5/public/funding-rate-history', { instId: INST, limit: '60' });
out.fundNow = await get('/api/v5/public/funding-rate', { instId: INST });
out.books = await get('/api/v5/market/books', { instId: INST, sz: '400' });
out.lsr = await get('/api/v5/rubik/stat/contracts/long-short-account-ratio', { ccy: CCY, period: '1H' });
out.fetchedAt = new Date().toISOString();
for (const [k, v] of Object.entries(out)) console.log(k, Array.isArray(v) ? v.length : typeof v);
fs.writeFileSync('out/uni.json', JSON.stringify(out));
