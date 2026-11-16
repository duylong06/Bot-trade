// Nến 15m hôm nay của vài đồng, để so hành vi trong ngày.
import fs from 'node:fs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const okx=async(p,q)=>{const u=new URL('https://www.okx.com'+p);
 for(const[k,v]of Object.entries(q))u.searchParams.set(k,v);
 for(let i=0;i<3;i++){try{const r=await fetch(u);const j=await r.json();if(j.code==='0')return j.data;}catch(e){}await sleep(800);}return null;};
const COINS=(process.env.LIST||'BTC,ETH,SOL,PUMP,WLD,DOGE,SUI,XRP,PEPE,ENA').split(',');
const out={};
for(const c of COINS){
  let all=[],after;
  while(all.length<300){ const q={instId:`${c}-USDT-SWAP`,bar:'15m',limit:'100'}; if(after)q.after=after;
    const d=await okx('/api/v5/market/history-candles',q); if(!d||!d.length)break;
    all=all.concat(d); after=d[d.length-1][0]; await sleep(160); }
  out[c]=all.filter(r=>r[8]==='1').map(r=>[+r[0],+r[1],+r[2],+r[3],+r[4],+r[5]]).sort((a,b)=>a[0]-b[0]);
  console.log(`${c}: ${out[c].length} nến 15m, cuối ${new Date(out[c].at(-1)[0]).toISOString().slice(5,16)}`);
}
fs.mkdirSync('out',{recursive:true});
fs.writeFileSync('out/m15.json',JSON.stringify(out));
