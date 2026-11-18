// Liệt kê toàn bộ mã futures USDⓈ-M của Binance qua kho data.binance.vision,
// lọc ra mã còn đang chạy (có file nến của hôm qua), rồi so với OKX.
import fs from 'node:fs';
const BASE='https://data.binance.vision';
const PREFIX='data/futures/um/daily/klines/';

// --- liệt kê thư mục (S3 XML, có phân trang)
let syms=[], token=null;
do{
  const u=new URL(BASE); u.searchParams.set('delimiter','/'); u.searchParams.set('prefix',PREFIX);
  u.searchParams.set('list-type','2'); if(token)u.searchParams.set('continuation-token',token);
  const r=await fetch(u); const x=await r.text();
  for(const m of x.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)){
    const p=m[1]; if(p===PREFIX)continue;
    const s=p.slice(PREFIX.length).replace(/\/$/,''); if(s)syms.push(s);
  }
  const t=x.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
  token=t?t[1]:null;
}while(token);
syms=[...new Set(syms)].sort();
console.log(`kho có tổng cộng ${syms.length} mã futures USDⓈ-M (kể cả đã huỷ niêm yết)`);

// --- mã còn chạy: có file nến hôm qua
const hqua=new Date(Date.now()-864e5).toISOString().slice(0,10);
const sống=[];
const lo=20;
for(let i=0;i<syms.length;i+=lo){
  await Promise.all(syms.slice(i,i+lo).map(async s=>{
    const u=`${BASE}/${PREFIX}${s}/1h/${s}-1h-${hqua}.zip`;
    try{ const r=await fetch(u,{method:'HEAD'}); if(r.ok) sống.push(s); }catch{}
  }));
}
sống.sort();
const usdt=sống.filter(s=>s.endsWith('USDT'));
const usdc=sống.filter(s=>s.endsWith('USDC'));
const khac=sống.filter(s=>!s.endsWith('USDT')&&!s.endsWith('USDC'));
console.log(`còn chạy ngày ${hqua}: ${sống.length} mã → USDT ${usdt.length} · USDC ${usdc.length} · khác ${khac.length}`);

// --- OKX
const r=await fetch('https://www.okx.com/api/v5/public/instruments?instType=SWAP');
const j=await r.json();
const okLive=j.data.filter(x=>x.state==='live'&&x.settleCcy==='USDT');
const okCoin=okLive.filter(x=>String(x.instCategory??'')==='1').map(x=>x.instId.split('-')[0]);
console.log(`OKX: ${okLive.length} vĩnh cửu USDT, trong đó ${okCoin.length} là coin`);

const norm=s=>s.replace(/USDT$/,'').replace(/^1000+/,'').toUpperCase();
const B=new Set(usdt.map(norm)), O=new Set(okCoin.map(s=>s.replace(/^1000+/,'').toUpperCase()));
const chiB=[...B].filter(x=>!O.has(x)).sort();
const chiO=[...O].filter(x=>!B.has(x)).sort();
console.log(`\nBinance có mà OKX KHÔNG có: ${chiB.length} đồng`);
console.log(chiB.join(' '));
console.log(`\nOKX có mà Binance không có: ${chiO.length} đồng`);
console.log(chiO.join(' '));
fs.mkdirSync('out',{recursive:true});
fs.writeFileSync('out/binance-futures.json',JSON.stringify({ngay:hqua, usdt, usdc, khac, chiBinance:chiB, chiOkx:chiO},null,1));
