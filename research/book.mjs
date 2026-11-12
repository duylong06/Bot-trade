// Ghi sổ lệnh OKX theo thời gian, để dựng bản đồ nhiệt kiểu Bookmap.
// Cứ ~1,5 giây chụp một lần toàn bộ sổ lệnh 400 mức, đồng thời gom các lệnh đã khớp.
import fs from 'node:fs';
const API='https://www.okx.com';
const INST=(fs.readFileSync('research/coin.txt','utf8').trim().split(/\s+/)[0])||'DOT-USDT-SWAP';
const SECS=+(process.env.SECS||360), STEP=+(process.env.STEP||1500), BAND=0.02;   // giữ ±2% quanh giá giữa
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(path,q){
  const u=API+path+'?'+new URLSearchParams(q);
  try{const r=await fetch(u,{headers:{'User-Agent':'Mozilla/5.0'}});const j=await r.json();return j.code==='0'?j.data:null;}
  catch(e){return null;}
}
const snaps=[], trades=new Map();
const t0=Date.now();
console.log('ghi', INST, 'trong', SECS, 'giây');
let n=0;
while(Date.now()-t0 < SECS*1000){
  const [bk, tr] = await Promise.all([
    get('/api/v5/market/books',{instId:INST,sz:'400'}),
    get('/api/v5/market/trades',{instId:INST,limit:'100'}),
  ]);
  if(bk&&bk[0]){
    const b=bk[0], bid=+b.bids[0][0], ask=+b.asks[0][0], mid=(bid+ask)/2;
    const keep=a=>a.map(x=>[+x[0],+x[1]]).filter(([p])=>Math.abs(p/mid-1)<=BAND);
    snaps.push({t:+b.ts, mid, bids:keep(b.bids), asks:keep(b.asks)});
  }
  if(tr)for(const x of tr)trades.set(x.tradeId,{t:+x.ts,px:+x.px,sz:+x.sz,side:x.side});
  n++;
  if(n%40===0)console.log(n,'lần ·',((Date.now()-t0)/1000).toFixed(0)+'s ·',snaps.length,'ảnh ·',trades.size,'lệnh khớp');
  await sleep(STEP);
}
const extra={};
extra.c1m=await get('/api/v5/market/candles',{instId:INST,bar:'1m',limit:'300'});
extra.c1H=await get('/api/v5/market/candles',{instId:INST,bar:'1H',limit:'300'});
extra.c15m=await get('/api/v5/market/candles',{instId:INST,bar:'15m',limit:'300'});
extra.ticker=await get('/api/v5/market/ticker',{instId:INST});
extra.oi=await get('/api/v5/rubik/stat/contracts/open-interest-history',{instId:INST,period:'1H',limit:'100'});
extra.fund=await get('/api/v5/public/funding-rate',{instId:INST});
extra.inst=await get('/api/v5/public/instruments',{instType:'SWAP',instId:INST});
fs.mkdirSync('out',{recursive:true});
fs.writeFileSync('out/book.json',JSON.stringify({inst:INST,t0,snaps,trades:[...trades.values()],extra}));
console.log('xong:',snaps.length,'ảnh sổ lệnh ·',trades.size,'lệnh khớp ·',(fs.statSync('out/book.json').size/1e6).toFixed(1)+'MB');
