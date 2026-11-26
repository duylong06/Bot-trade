// Dựng lại đúng ảnh chụp của người dùng: thang giá bị khoá ở 5,5–8,0 trong khi NEAR
// chỉ chạy 2,5–3,6, nên nến nằm ngoài màn hình theo CHIỀU DỌC.
const { chromium } = require('playwright');
const PX={ETH:1650, SOL:71.2};
const B=Object.keys(PX);
function mk(base){const step=36e5,now=Math.floor(Date.now()/step)*step,rows=[];
let r=base.length*7919,p=PX[base];
const rnd=()=>{r=(r*1103515245+12345)&0x7fffffff;return r/0x7fffffff;};
for(let i=299;i>=0;i--){const o=p,c=Math.max(p*.5,p*(1+(rnd()-.5)*.012));
rows.push([String(now-i*step),String(o),String(Math.max(o,c)*1.003),String(Math.min(o,c)*.997),String(c),'1000','0','0',i===0?'0':'1']);p=c;}
return rows.reverse();}
const soi = page => page.evaluate(()=>{
  const c=document.querySelector('#chart canvas'),g=c.getContext('2d');
  const d=g.getImageData(0,0,c.width,Math.min(400,c.height)).data;
  let n=0; for(let i=0;i<d.length;i+=4) if(d[i]+d[i+1]+d[i+2]>120)n++;
  const v=window.__cv,b=v.bars;
  let lo=Infinity,hi=-Infinity;
  for(let i=0;i<b.c.length;i++){if(b.l[i]<lo)lo=b.l[i];if(b.h[i]>hi)hi=b.h[i];}
  return {sang:n, sym:v.sym, giaTu:+lo.toFixed(3), giaDen:+hi.toFixed(3),
    coNen:v.coNen(), tuCo:v.chart.priceScale('right').options().autoScale,
    loi:!document.querySelector('#cvErr').hidden};
});
(async()=>{
let hong=0; const say=(ok,m)=>{console.log((ok?'  OK   ':'  SAI  ')+m); if(!ok)hong++;};
const b=await chromium.launch();
const page=await b.newPage({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true});
page.on('pageerror',e=>{console.log('  [LỖI JS]',e.message);hong++;});
await page.route('**www.okx.com/**',r=>{const u=new URL(r.request().url());let data=[];
 if(u.pathname.endsWith('/market/tickers'))data=B.map((x,i)=>({instId:`${x}-USDT-SWAP`,last:String(PX[x]),open24h:String(PX[x]*.98),volCcy24h:String(1e7/(i+1))}));
 else if(u.pathname.endsWith('/public/instruments'))data=B.map(x=>({instId:`${x}-USDT-SWAP`,state:'live',instCategory:'1',tickSz:'0.001'}));
 else if(u.pathname.endsWith('/market/candles'))data=mk((u.searchParams.get('instId')||'ETH-X').split('-')[0]);
 r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({code:'0',data})});});
await page.route('**raw.githubusercontent.com/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"marks":[],"ts":0,"items":[]}'}));
await page.route('**ntfy.sh/**',r=>r.fulfill({status:200,body:'{}'}));
await page.goto('http://127.0.0.1:8799/index.html',{waitUntil:'networkidle'});
await page.waitForTimeout(1300);

console.log('1. Mở đồng giá ~7, rồi VUỐT DỌC trên biểu đồ (thao tác thường ngày trên đt)');
await page.locator('.tp-r').nth(0).tap(); await page.waitForTimeout(2000);
const box=await page.locator('#chart').boundingBox();
// vuốt dọc như ngón tay thật: vừa ngang vừa dọc
await page.touchscreen.tap(box.x+200, box.y+200);
await page.mouse.move(box.x+200, box.y+150); await page.mouse.down();
await page.mouse.move(box.x+210, box.y+420,{steps:12}); await page.mouse.up();
await page.waitForTimeout(600);
const sauVuot=await soi(page);
say(sauVuot.tuCo===true, `vuốt dọc xong thang giá vẫn TỰ co giãn (autoScale=${sauVuot.tuCo})`);

console.log('2. Kéo thẳng vào TRỤC GIÁ bên phải — cách chắc chắn tắt tự co giãn');
const w=await page.evaluate(()=>document.querySelector('#chart').clientWidth);
await page.mouse.move(box.x+w-20, box.y+200); await page.mouse.down();
await page.mouse.move(box.x+w-20, box.y+420,{steps:12}); await page.mouse.up();
await page.waitForTimeout(600);
const sauTruc=await soi(page);
console.log('   ',JSON.stringify(sauTruc));

console.log('3. Sang đồng NEAR giá ~3 — đây là lúc ảnh chụp bị trống');
await page.locator('#cvBack').tap(); await page.waitForTimeout(400);
await page.locator('.tp-r').nth(1).tap(); await page.waitForTimeout(2600);
const s=await soi(page);
console.log('   ',JSON.stringify(s));
say(s.sang>2000, `nến NEAR (${s.giaTu}–${s.giaDen}) hiện ra: ${s.sang} điểm sáng`);
say(s.tuCo===true, 'thang giá đã được bật lại tự co giãn');
say(s.coNen===true, 'phép kiểm nhận ra là có nến');
say(!s.loi, 'không phải hiện bảng chẩn đoán');
await page.screenshot({path:'thangGia.png'});

console.log('4. Kiểu hỏng thật: thang giá bị GHIM mà tuỳ chọn vẫn báo tự co giãn');
const truoc4=await page.evaluate(()=>{
  const v=window.__cv, ps=v.candle.priceScale();
  ps.setVisibleRange({from:1500,to:2200});       // ghim ở khoảng giá ETH
  ps.applyOptions({autoScale:true});             // tuỳ chọn báo true, nhưng khoảng vẫn ghim
  return {tuCo:ps.options().autoScale, khoang:ps.getVisibleRange(), coNen:v.coNen()};
});
console.log('   ',JSON.stringify(truoc4));
say(truoc4.tuCo===true && truoc4.coNen===false,
  'đúng cảnh trong ảnh: tuỳ chọn true nhưng không thấy nến');
// (không kiểm cách cũ ở đây: bộ canh chừng 1,5 giây hay chen vào trước, làm phép kiểm chập chờn)
// lệnh MỚI: đảo false rồi true
await page.evaluate(()=>window.__cv.batTuCo());
await page.waitForTimeout(400);          // thư viện tính lại ở khung hình sau
const moi=await page.evaluate(()=>({coNen:window.__cv.coNen(), khoang:window.__cv.candle.priceScale().getVisibleRange()}));
say(moi.coNen===true,`đảo false rồi true (cách mới) thì chữa được: khoảng về ${JSON.stringify(moi.khoang)}`);

console.log('5. Và bộ canh chừng tự làm việc đó');
await page.evaluate(()=>{
  const ps=window.__cv.candle.priceScale();
  ps.setVisibleRange({from:1500,to:2200});
  ps.applyOptions({autoScale:true});
});
await page.waitForTimeout(3500);
const chua=await soi(page);
say(chua.sang>2000 && chua.coNen, `app tự chữa không cần đụng vào: ${chua.sang} điểm sáng`);
await page.screenshot({path:'thangGia.png'});
console.log(hong?`\n==> ${hong} chỗ sai`:'\n==> Tất cả đạt');
await b.close(); process.exit(hong?1:0);})();
