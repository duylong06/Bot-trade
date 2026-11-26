// Tấm phân tích đa khung: bảng Stoch M15/H1/H4 và kháng cự hỗ trợ H1, H4.
const { chromium } = require('playwright');
const B=['BTC','ETH','SOL'];
function mk(bar){const step=bar==='15m'?9e5:bar==='4H'?144e5:36e5;
const now=Math.floor(Date.now()/step)*step,rows=[];let r=step%9973,p=100;
const rnd=()=>{r=(r*1103515245+12345)&0x7fffffff;return r/0x7fffffff;};
for(let i=299;i>=0;i--){const o=p,c=Math.max(1,p*(1+Math.sin(i/13)*.006+(rnd()-.5)*.01));
rows.push([String(now-i*step),String(o),String(Math.max(o,c)*1.003),String(Math.min(o,c)*.997),String(c),'1000','0','0',i===0?'0':'1']);p=c;}
return rows.reverse();}
(async()=>{
let hong=0; const say=(ok,m)=>{console.log((ok?'  OK   ':'  SAI  ')+m); if(!ok)hong++;};
const b=await chromium.launch();
const page=await b.newPage({viewport:{width:393,height:852},deviceScaleFactor:2,isMobile:true,hasTouch:true});
page.on('pageerror',e=>{console.log('  [LỖI JS]',e.message);hong++;});
await page.route('**www.okx.com/**',r=>{const u=new URL(r.request().url());let data=[];
 if(u.pathname.endsWith('/market/tickers'))data=B.map((x,i)=>({instId:`${x}-USDT-SWAP`,last:'100',open24h:'98',volCcy24h:String(1e7/(i+1))}));
 else if(u.pathname.endsWith('/public/instruments'))data=B.map(x=>({instId:`${x}-USDT-SWAP`,state:'live',instCategory:'1',tickSz:'0.01'}));
 else if(u.pathname.endsWith('/market/candles'))data=mk(u.searchParams.get('bar')||'1H');
 r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({code:'0',data})});});
await page.route('**raw.githubusercontent.com/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"marks":[],"ts":0,"items":[]}'}));
await page.route('**ntfy.sh/**',r=>r.fulfill({status:200,body:'{}'}));
await page.goto('http://127.0.0.1:8799/index.html',{waitUntil:'networkidle'});
await page.waitForTimeout(1500);
await page.locator('.tp-r').nth(0).tap(); await page.waitForTimeout(2000);

say(await page.locator('[data-act="phan"]').count()===1,'có nút Phân tích trên thanh công cụ');
await page.locator('[data-act="phan"]').tap();
await page.waitForTimeout(2500);
say(await page.locator('#phan.on').count()===1,'tấm phân tích mở ra');
say((await page.locator('#phTtl').textContent()).includes('BTC'),'đúng tên đồng');

const hang=await page.locator('#phBody .tp-tb tbody tr').count();
say(hang===3,`bảng Stoch có ${hang} khung`);
const khung=await page.locator('#phBody .tp-tb tbody tr td:first-child').allTextContents();
say(khung.join(',')==='M15,H1,H4',`đủ M15 H1 H4: ${khung.join(' · ')}`);
const so=await page.locator('#phBody .tp-tb tbody tr').nth(1).allInnerTexts();
say(/\d/.test(so[0]),'có số liệu: '+so[0].replace(/\s+/g,' ').slice(0,60));

const h3=await page.locator('#phBody h3').allTextContents();
say(h3.length===2 && h3[0].includes('H1') && h3[1].includes('H4'),`hai mục mức giá: ${h3.join(' · ')}`);
const lv=await page.locator('#phBody .tp-lv').count();
say(lv>=3,`${lv} dòng mức giá`);
console.log('   nội dung:', (await page.locator('#phBody').innerText()).replace(/\n+/g,' | ').slice(0,300));
console.log('   số mức tính được:', await page.evaluate(()=>{
  const v=window.__cv; return 'bars='+v.bars.c.length+' levels='+JSON.stringify(v.levels.slice(0,3));
}));
const giaNay=await page.locator('#phBody .tp-lv:has-text("Giá hiện tại")').count();
say(giaNay===2,'mỗi khung có một dòng Giá hiện tại');

await page.screenshot({path:'phan.png'});
await page.locator('#phDong').tap(); await page.waitForTimeout(400);
say(await page.locator('#phan.on').count()===0,'bấm Đóng là tắt');
await page.locator('#cvBack').tap(); await page.waitForTimeout(400);
say(await page.locator('#phan.on').count()===0,'quay lại danh sách cũng tắt');
console.log(hong?`\n==> ${hong} chỗ sai`:'\n==> Tất cả đạt');
await b.close(); process.exit(hong?1:0);})();
