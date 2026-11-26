// Giả cảnh app màn hình chính trên iPhone: lề an toàn bóp khung biểu đồ còn rất thấp,
// và lúc vừa mở thì khung còn bằng 0. Trước đây autoSize đo lệch nhịp nên vẽ ra rỗng.
const { chromium } = require('playwright');
const B=['BTC','ETH','SOL'];
function mk(bar){const step=bar==='15m'?9e5:bar==='4H'?144e5:36e5;
const now=Math.floor(Date.now()/step)*step,rows=[];let r=step%9973,p=100;
const rnd=()=>{r=(r*1103515245+12345)&0x7fffffff;return r/0x7fffffff;};
for(let i=299;i>=0;i--){const o=p,c=Math.max(1,p*(1+Math.sin(i/13)*.006+(rnd()-.5)*.01));
rows.push([String(now-i*step),String(o),String(Math.max(o,c)*1.003),String(Math.min(o,c)*.997),String(c),'1000','0','0',i===0?'0':'1']);p=c;}
return rows.reverse();}
const sang = page => page.evaluate(()=>{
  const c=document.querySelector('#chart canvas');
  if(!c||c.width<10) return {n:-1,w:c?c.width:0};
  const g=c.getContext('2d'),d=g.getImageData(0,0,c.width,Math.min(400,c.height)).data;
  let n=0; for(let i=0;i<d.length;i+=4) if(d[i]+d[i+1]+d[i+2]>120)n++;
  const v=window.__cv;
  return {n, cvW:c.width, cvH:c.height, el:document.querySelector('#chart').clientHeight,
    khung:v.khung, loi:!document.querySelector('#cvErr').hidden};
});
(async()=>{
let hong=0; const say=(ok,m)=>{console.log((ok?'  OK   ':'  SAI  ')+m); if(!ok)hong++;};
const b=await chromium.launch();
const page=await b.newPage({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true});
page.on('pageerror',e=>{console.log('  [LỖI JS]',e.message);hong++;});
await page.route('**www.okx.com/**',r=>{const u=new URL(r.request().url());let data=[];
 if(u.pathname.endsWith('/market/tickers'))data=B.map((x,i)=>({instId:`${x}-USDT-SWAP`,last:'100',open24h:'98',volCcy24h:String(1e7/(i+1))}));
 else if(u.pathname.endsWith('/public/instruments'))data=B.map(x=>({instId:`${x}-USDT-SWAP`,state:'live',instCategory:'1',tickSz:'0.01'}));
 else if(u.pathname.endsWith('/market/candles'))data=mk(u.searchParams.get('bar')||'1H');
 r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({code:'0',data})});});
await page.route('**raw.githubusercontent.com/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"marks":[],"ts":0,"items":[]}'}));
await page.route('**ntfy.sh/**',r=>r.fulfill({status:200,body:'{}'}));
await page.goto('http://127.0.0.1:8799/index.html',{waitUntil:'networkidle'});
await page.waitForTimeout(1200);

console.log('1. Lề an toàn lớn như iPhone ở chế độ app màn hình chính');
await page.addStyleTag({content:`
  .cv-top{padding-top:59px !important}
  .cv-foot{padding-bottom:34px !important}
`});
await page.locator('.tp-r').nth(0).tap(); await page.waitForTimeout(2500);
let s=await sang(page);
console.log('   ',JSON.stringify(s));
say(s.n>2000,`vẽ được ${s.n} điểm sáng dù khung chỉ cao ${s.el}px`);

console.log('2. Ép khung biểu đồ về 0 ngay lúc mở — autoSize cũ sẽ chết ở đây');
await page.locator('#cvBack').tap(); await page.waitForTimeout(300);
await page.addStyleTag({content:'#chart{max-height:0 !important}'});
await page.locator('.tp-r').nth(1).tap(); await page.waitForTimeout(2800);
s=await sang(page);
console.log('   ',JSON.stringify(s));
say(s.n>2000 || s.loi, s.loi?'khung bằng 0 thì hiện bảng chẩn đoán':`vẫn vẽ được ${s.n} điểm sáng (ép chiều cao ${s.khung&&s.khung.h})`);
if(s.loi) console.log('   bảng ghi:', (await page.locator('#cvErrTxt').textContent()).replace(/\n/g,' | '));
await page.screenshot({path:'bop.png'});

console.log('3. Xoay ngang rồi xoay lại');
await page.addStyleTag({content:'#chart{max-height:none !important}'});
await page.setViewportSize({width:852,height:393}); await page.waitForTimeout(900);
const ngang=await sang(page);
await page.setViewportSize({width:393,height:852}); await page.waitForTimeout(900);
const doc=await sang(page);
say(ngang.n>1500,`nằm ngang vẽ được ${ngang.n}`);
say(doc.n>2000,`xoay lại vẫn vẽ được ${doc.n}`);
console.log(hong?`\n==> ${hong} chỗ sai`:'\n==> Tất cả đạt');
await b.close(); process.exit(hong?1:0);})();
