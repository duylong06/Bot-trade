// Lệch giá giữa Binance futures và OKX futures là bao nhiêu?
// Binance: lấy từ kho lịch sử data.binance.vision (không bị chặn). OKX: API thường.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const SYMS=(process.env.SYMS||'BTC,ETH,SOL,WLD,PUMP,FIL').split(',');
const NGAY=(process.env.NGAY||'2026-11-15,2026-11-16,2026-11-17').split(',');
const out={};
for(const s of SYMS){
  // --- Binance: tải zip 1h của từng ngày
  const bn=new Map();
  for(const d of NGAY){
    const u=`https://data.binance.vision/data/futures/um/daily/klines/${s}USDT/1h/${s}USDT-1h-${d}.zip`;
    try{
      const r=await fetch(u); if(!r.ok){console.log(`${s} ${d}: HTTP ${r.status}`);continue;}
      fs.writeFileSync('/tmp/k.zip',Buffer.from(await r.arrayBuffer()));
      const csv=execSync('unzip -p /tmp/k.zip').toString();
      for(const line of csv.trim().split('\n')){
        const c=line.split(','); const t=+c[0]; if(!isFinite(t))continue;
        bn.set(t<1e12?t*1000:t, +c[4]);
      }
    }catch(e){console.log(`${s} ${d}: ${e.message}`);}
  }
  // --- OKX
  const ok=new Map();
  let after;
  for(let i=0;i<4;i++){
    const u=new URL('https://www.okx.com/api/v5/market/history-candles');
    u.searchParams.set('instId',`${s}-USDT-SWAP`); u.searchParams.set('bar','1H'); u.searchParams.set('limit','100');
    if(after)u.searchParams.set('after',after);
    const r=await fetch(u); const j=await r.json();
    if(j.code!=='0'||!j.data.length)break;
    for(const c of j.data) if(c[8]==='1') ok.set(+c[0],+c[4]);
    after=j.data[j.data.length-1][0]; await sleep(200);
  }
  const chung=[...bn.keys()].filter(t=>ok.has(t)).sort((a,b)=>a-b);
  if(!chung.length){console.log(`${s}: không có giờ chung (binance ${bn.size}, okx ${ok.size})`);continue;}
  const d=chung.map(t=>Math.abs(bn.get(t)-ok.get(t))/ok.get(t)*100);
  d.sort((a,b)=>a-b);
  const q=p=>d[Math.floor(p*(d.length-1))];
  out[s]={n:chung.length, tb:d.reduce((a,b)=>a+b,0)/d.length, tv:q(.5), p90:q(.9), max:q(1)};
  console.log(`${s.padEnd(6)} ${chung.length} giờ chung · lệch trung vị ${q(.5).toFixed(4)}% · 90% ${q(.9).toFixed(4)}% · tệ nhất ${q(1).toFixed(4)}%`);
}
fs.mkdirSync('out',{recursive:true}); fs.writeFileSync('out/lech.json',JSON.stringify(out,null,1));
