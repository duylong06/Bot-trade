// Kiểm lưới an toàn: ép khung nhìn trôi ra chỗ trống rồi xem app có tự kéo về không.
// Và kiểm lúc OKX trả lỗi thì có báo rõ, bấm Thử lại có chạy lại không.
const { chromium } = require('playwright');
const COINS=['BTC','ETH','SOL'];
function mk(bar){const step=bar==='4H'?144e5:36e5,now=Math.floor(Date.now()/step)*step,rows=[];let r=991,p=100;
const rnd=()=>{r=(r*1103515245+12345)&0x7fffffff;return r/0x7fffffff;};
for(let i=299;i>=0;i--){const o=p,c=Math.max(1,p*(1+(rnd()-.5)*.02));
rows.push([String(now-i*step),String(o),String(Math.max(o,c)*1.002),String(Math.min(o,c)*.998),String(c),'1000','0','0',i===0?'0':'1']);p=c;}
return rows.reverse();}
(async()=>{
let hong=0; const say=(ok,m)=>{console.log((ok?'  OK   ':'  SAI  ')+m); if(!ok)hong++;};
const b=await chromium.launch();
const page=await b.newPage({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true});
page.on('pageerror',e=>console.log('  [LỖI JS]',e.message));
let choLoi=false;
await page.route('**www.okx.com/**',r=>{const u=new URL(r.request().url());let data=[];
 if(u.pathname.endsWith('/market/candles')&&choLoi){ r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({code:'50011',msg:'Too Many Requests'})}); return; }
 if(u.pathname.endsWith('/market/tickers'))data=COINS.map((x,i)=>({instId:`${x}-USDT-SWAP`,last:'100',open24h:'98',volCcy24h:String(1e7/(i+1))}));
 else if(u.pathname.endsWith('/public/instruments'))data=COINS.map(x=>({instId:`${x}-USDT-SWAP`,state:'live',instCategory:'1',tickSz:'0.01'}));
 else if(u.pathname.endsWith('/market/candles'))data=mk(u.searchParams.get('bar')||'1H');
 r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({code:'0',data})});});
await page.route('**raw.githubusercontent.com/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"marks":[],"ts":0,"items":[]}'}));
await page.route('**ntfy.sh/**',r=>r.fulfill({status:200,body:'{}'}));
await page.goto('http://127.0.0.1:8799/index.html',{waitUntil:'networkidle'});
await page.waitForTimeout(1500);
await page.locator('.tp-r').nth(0).tap();
await page.waitForTimeout(2000);

console.log('1. Khung nhìn trôi hẳn ra chỗ trống');
await page.evaluate(()=>window.__cv.chart.timeScale().setVisibleLogicalRange({from:600,to:660}));
await page.waitForTimeout(250);
const truoc=await page.evaluate(()=>({coNen:window.__cv.coNen()}));
say(!truoc.coNen,'đã ép ra chỗ không có nến');
await page.waitForTimeout(1400);
const sau=await page.evaluate(()=>({coNen:window.__cv.coNen(),pos:+window.__cv.chart.timeScale().scrollPosition().toFixed(1)}));
say(sau.coNen,`app tự kéo về, vị trí ${sau.pos}`);
say((await page.locator('#cvHint').textContent()).includes('kéo về'),'có báo cho người dùng biết');

console.log('2. Nút Về nến');
await page.evaluate(()=>window.__cv.chart.timeScale().setVisibleLogicalRange({from:-900,to:-840}));
await page.waitForTimeout(100);
await page.locator('[data-act="fit"]').tap();
await page.waitForTimeout(300);
say(await page.evaluate(()=>window.__cv.coNen()),'bấm Về nến là thấy nến ngay');

console.log('3. OKX trả lỗi thì báo rõ, không để trống');
choLoi=true;
await page.locator('#cvBack').tap(); await page.waitForTimeout(400);
await page.locator('.tp-r').nth(1).tap();
await page.waitForTimeout(3500);
say(await page.locator('#cvErr:visible').count()===1,'hiện bảng báo lỗi che màn hình');
const txt=await page.locator('#cvErrTxt').textContent();
say(/ETH/.test(txt)&&/1H/.test(txt),'nói rõ đồng nào khung nào: '+txt.replace(/\n+/g,' ').slice(0,70));
say(await page.locator('#cvRetry:visible').count()===1,'có nút Thử lại');

console.log('4. Bấm Thử lại khi mạng đã ổn');
choLoi=false;
await page.locator('#cvRetry').tap();
await page.waitForTimeout(2500);
say(await page.locator('#cvErr:visible').count()===0,'bảng lỗi biến mất');
const s=await page.evaluate(()=>{const c=document.querySelector('#chart canvas'),g=c.getContext('2d');
 const d=g.getImageData(0,0,c.width,Math.min(400,c.height)).data;let n=0;
 for(let i=0;i<d.length;i+=4) if(d[i]+d[i+1]+d[i+2]>120)n++;
 return {n,sym:window.__cv.sym,coNen:window.__cv.coNen()};});
say(s.n>2000&&s.coNen&&s.sym==='ETH-USDT-SWAP',`biểu đồ hiện lại: ${JSON.stringify(s)}`);

console.log(hong?`\n==> ${hong} chỗ sai`:'\n==> Tất cả đạt');
await b.close(); process.exit(hong?1:0);})();
