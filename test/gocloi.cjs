// GIẢ THUYẾT: nhịp giá 4 giây ghi giá của đồng MỚI vào mảng nến của đồng CŨ,
// mà mảng đó là đồ dùng chung trong bộ nhớ đệm 15 giây. Quay lại đồng cũ trong 15 giây
// là nến bị bẹp dí vì thang giá phải kéo từ 0,000004 tới 59000.
const { chromium } = require('playwright');
const PX={BTC:59000,PEPE:0.0000042,ETH:1650};
const TICK={BTC:'0.1',PEPE:'0.0000001',ETH:'0.01'};
const BASES=Object.keys(PX);
function mk(base){const step=36e5,now=Math.floor(Date.now()/step)*step,rows=[];
let r=base.length*7919,p=PX[base];
const rnd=()=>{r=(r*1103515245+12345)&0x7fffffff;return r/0x7fffffff;};
for(let i=299;i>=0;i--){const o=p,c=Math.max(p*.5,p*(1+(rnd()-.5)*.01));
rows.push([String(now-i*step),String(o),String(Math.max(o,c)*1.002),String(Math.min(o,c)*.998),String(c),'1000','0','0',i===0?'0':'1']);p=c;}
return rows.reverse();}

const chup = page => page.evaluate(()=>{
  const v=window.__cv,b=v.bars;
  let lo=Infinity,hi=-Infinity;
  for(let i=0;i<b.c.length;i++){ if(b.l[i]<lo)lo=b.l[i]; if(b.h[i]>hi)hi=b.h[i]; }
  const c=document.querySelector('#chart canvas'),g=c.getContext('2d');
  const d=g.getImageData(0,0,c.width,Math.min(400,c.height)).data;
  let n=0; for(let i=0;i<d.length;i+=4) if(d[i]+d[i+1]+d[i+2]>120)n++;
  return {sym:v.sym, nenCuoi:b.c.at(-1), thapNhat:lo, caoNhat:hi,
    tiLe:+(hi/Math.max(lo,1e-12)).toFixed(1), diemSang:n};
});

(async()=>{
let hong=0; const say=(ok,m)=>{console.log((ok?'  OK   ':'  LỖI  ')+m); if(!ok)hong++;};
const b=await chromium.launch();
const page=await b.newPage({viewport:{width:393,height:852},deviceScaleFactor:2,isMobile:true,hasTouch:true});
page.on('pageerror',e=>console.log('  [LỖI JS]',e.message));
await page.route('**www.okx.com/**',async r=>{const u=new URL(r.request().url());let data=[];
 if(u.pathname.endsWith('/market/tickers'))data=BASES.map((x,i)=>({instId:`${x}-USDT-SWAP`,last:String(PX[x]),open24h:String(PX[x]*.98),volCcy24h:String(1e7/(i+1))}));
 else if(u.pathname.endsWith('/public/instruments'))data=BASES.map(x=>({instId:`${x}-USDT-SWAP`,state:'live',instCategory:'1',tickSz:TICK[x]}));
 else if(u.pathname.endsWith('/market/candles')){await new Promise(z=>setTimeout(z,700));  // mạng chậm
   data=mk((u.searchParams.get('instId')||'BTC-USDT-SWAP').split('-')[0]);}
 r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({code:'0',data})});});
await page.route('**raw.githubusercontent.com/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"marks":[],"ts":0,"items":[]}'}));
await page.route('**ntfy.sh/**',r=>r.fulfill({status:200,body:'{}'}));
await page.goto('http://127.0.0.1:8799/index.html',{waitUntil:'networkidle'});
await page.waitForTimeout(1500);

console.log('1. Mở BTC');
await page.locator('.tp-r').nth(0).tap(); await page.waitForTimeout(2000);
const a=await chup(page);
say(a.tiLe<5, `BTC bình thường: thấp ${a.thapNhat.toFixed(0)} cao ${a.caoNhat.toFixed(0)}, tỉ lệ ${a.tiLe}, sáng ${a.diemSang}`);

console.log('2. Quay lại, bấm PEPE, và nhịp giá 4 giây rơi ĐÚNG lúc đang tải');
await page.locator('#cvBack').tap(); await page.waitForTimeout(300);
await page.locator('.tp-r').nth(1).tap();     // PEPE, tải mất 700ms
await page.waitForTimeout(200);               // đang tải dở
await page.evaluate(()=>window.__TOP.nhip()); // nhịp giá chen vào
await page.waitForTimeout(250);
const giua=await page.evaluate(()=>{const v=window.__cv;return {sym:v.sym,nenCuoi:v.bars.c.at(-1)};});
console.log('   lúc đang tải: biểu đồ còn là', giua.sym, '· nến cuối =', giua.nenCuoi);
say(giua.nenCuoi>1000 || giua.sym!=='BTC-USDT-SWAP',
  giua.nenCuoi<1 && giua.sym==='BTC-USDT-SWAP' ? `*** GIÁ PEPE (${giua.nenCuoi}) ĐÃ BỊ GHI VÀO NẾN BTC ***` : 'nến BTC không bị ghi đè');
await page.waitForTimeout(2000);

console.log('3. Quay lại BTC trong vòng 15 giây (bộ đệm còn hiệu lực)');
await page.locator('#cvBack').tap(); await page.waitForTimeout(300);
await page.locator('.tp-r').nth(0).tap(); await page.waitForTimeout(2200);
const c=await chup(page);
console.log('   ', JSON.stringify(c));
say(c.tiLe<100, `thang giá BTC còn lành (tỉ lệ cao/thấp = ${c.tiLe})`);
say(c.diemSang>a.diemSang*0.6, `biểu đồ vẫn vẽ đủ: ${c.diemSang} điểm sáng (ban đầu ${a.diemSang})`);
await page.screenshot({path:'gocloi.png'});

console.log(hong?`\n==> ${hong} chỗ hỏng — đã dựng lại được lỗi`:'\n==> Không dựng lại được');
await b.close();})();
