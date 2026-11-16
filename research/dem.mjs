// Xem OKX phân loại 528 hợp đồng USDT vĩnh cửu thế nào, và bộ lọc "chỉ coin" của app
// đang giữ lại / bỏ đi những gì.
import fs from 'node:fs';
const r = await fetch('https://www.okx.com/api/v5/public/instruments?instType=SWAP');
const j = await r.json();
const live = j.data.filter(x => x.state === 'live' && x.settleCcy === 'USDT');
const nhom = new Map();
for (const x of live) {
  const c = String(x.instCategory ?? '');
  if (!nhom.has(c)) nhom.set(c, []);
  nhom.get(c).push(x.instId.split('-')[0]);
}
console.log(`Tổng vĩnh cửu USDT đang chạy: ${live.length}\n`);
for (const [c, arr] of [...nhom].sort((a,b)=>b[1].length-a[1].length)) {
  console.log(`instCategory "${c}": ${arr.length} hợp đồng`);
  console.log(`   ví dụ: ${arr.slice(0, 25).join(' ')}`);
  console.log(`   cuối : ${arr.slice(-15).join(' ')}\n`);
}
// bộ lọc hiện tại của app
const NOT = new Set(['XAU','XAG','XPT','XPD','CL','BZ','NG','HG','ZC','ZS','ZW','SPX','NDX','DJI','VIX','US30','US500','NAS100','EURUSD','GBPUSD','USDJPY']);
const giu = live.filter(x => { const b = x.instId.split('-')[0];
  if (NOT.has(b)) return false;
  const c = String(x.instCategory ?? ''); if (c && c !== '1') return false; return true; });
console.log(`Bộ lọc "chỉ coin" của app giữ lại: ${giu.length} / ${live.length}`);
const bo = live.filter(x => !giu.includes(x)).map(x => x.instId.split('-')[0]);
console.log(`Bị loại ${bo.length}: ${bo.slice(0,60).join(' ')}`);
fs.mkdirSync('out',{recursive:true});
fs.writeFileSync('out/dem.json', JSON.stringify({tong:live.length, giu:giu.length, nhom:[...nhom].map(([c,a])=>[c,a.length]), bo}, null, 1));
