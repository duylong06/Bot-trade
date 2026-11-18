// Lấy nến H1 futures Binance từ kho data.binance.vision (không bị chặn vị trí).
// Dùng file THEO THÁNG cho nhanh, thêm file theo ngày cho tháng hiện tại.
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const COINS = (process.env.COINS || 'BTC,ETH,SOL,ZEC,XRP,HYPE,DOGE,PEPE,NEAR,UNI,WLD,SUI,PUMP,TRUMP,BNB,ADA,LIT,SOPH,ENA').split(',');
const TU = process.env.TU || '2025-07';          // tháng bắt đầu
const BAR = process.env.BAR || '1h';
const BASE = 'https://data.binance.vision/data/futures/um';

const thangs = () => {
  const out = []; let [y, m] = TU.split('-').map(Number);
  const now = new Date();
  while (y < now.getUTCFullYear() || (y === now.getUTCFullYear() && m <= now.getUTCMonth() + 1)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
};
const ngaysCuaThangNay = () => {
  const out = [], now = new Date();
  for (let d = 1; d <= now.getUTCDate(); d++)
    out.push(`${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
  return out;
};

async function zipCsv(url) {
  const r = await fetch(url);
  if (!r.ok) return null;
  fs.writeFileSync('/tmp/k.zip', Buffer.from(await r.arrayBuffer()));
  try { return execSync('unzip -p /tmp/k.zip', { maxBuffer: 1 << 28 }).toString(); }
  catch { return null; }
}

fs.mkdirSync('out', { recursive: true });
const meta = {};
const thangList = thangs(), thangNay = thangList.at(-1);

for (const c of COINS) {
  const sym = `${c}USDT`;
  const m = new Map();
  // các tháng đã đóng
  for (const th of thangList.slice(0, -1)) {
    const csv = await zipCsv(`${BASE}/monthly/klines/${sym}/${BAR}/${sym}-${BAR}-${th}.zip`);
    if (!csv) continue;
    for (const line of csv.split('\n')) {
      const p = line.split(','); const t = +p[0];
      if (!isFinite(t) || !p[4]) continue;
      m.set(t < 1e12 ? t * 1000 : t, [+p[1], +p[2], +p[3], +p[4], +p[5]]);
    }
  }
  // tháng hiện tại: file theo ngày
  for (const d of ngaysCuaThangNay()) {
    const csv = await zipCsv(`${BASE}/daily/klines/${sym}/${BAR}/${sym}-${BAR}-${d}.zip`);
    if (!csv) continue;
    for (const line of csv.split('\n')) {
      const p = line.split(','); const t = +p[0];
      if (!isFinite(t) || !p[4]) continue;
      m.set(t < 1e12 ? t * 1000 : t, [+p[1], +p[2], +p[3], +p[4], +p[5]]);
    }
  }
  const rows = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => [t, ...v]);
  if (rows.length < 2000) { console.log(`${c}: chỉ ${rows.length} nến, bỏ`); continue; }
  fs.writeFileSync(`out/${c}.json`, JSON.stringify(rows));
  const d0 = new Date(rows[0][0]).toISOString().slice(0, 10), d1 = new Date(rows.at(-1)[0]).toISOString().slice(0, 10);
  meta[c] = { sym, bars: rows.length, from: d0, to: d1 };
  console.log(`${c}: ${rows.length} nến ${BAR}  ${d0} → ${d1}`);
}
fs.writeFileSync('out/meta.json', JSON.stringify(meta, null, 1));
console.log(`\nXong ${Object.keys(meta).length} đồng (Binance futures USDⓈ-M).`);
