const { chromium } = require('playwright');
const COINS=['BTC','ETH','SOL','WLD','PUMP','FIL'];
const PX={BTC:59000,ETH:1650,SOL:68,WLD:0.23,PUMP:0.0042,FIL:1.9};
const TICK={BTC:'0.1',ETH:'0.01',SOL:'0.001',WLD:'0.0001',PUMP:'0.0000001',FIL:'0.001'};
function mk(base,bar){const step=bar==='15m'?9e5:bar==='30m'?18e5:bar==='4H'?144e5:bar==='1Dutc'?864e5:36e5;
const now=Math.floor(Date.now()/step)*step,rows=[];let r=base.length*7919+step,p=PX[base];
const rnd=()=>{r=(r*1103515245+12345)&0x7fffffff;return r/0x7fffffff;};
for(let i=300;i>=1;i--){const o=p,c=Math.max(p*.5,p*(1+Math.sin(i/19)*.004+(rnd()-.5)*.012));
rows.push([String(now-i*step),String(o),String(Math.max(o,c)*(1+rnd()*.003)),String(Math.min(o,c)*(1-rnd()*.003)),String(c),'1000','0','0','1']);p=c;}
return rows.reverse();}

const son = page => page.evaluate(()=>{
  const c=document.querySelector('#chart canvas');
  if(!c) return {canvas:false};
  const g=c.getContext('2d');
  const d=g.getImageData(0,0,c.width,Math.min(500,c.height)).data;
  let n=0; for(let i=0;i<d.length;i+=4) if(d[i]+d[i+1]+d[i+2]>120) n++;
  const v=window.__cv, ts=v.chart.timeScale(), r=ts.getVisibleLogicalRange();
  return {canvas:true, diemSang:n, w:c.width, h:c.height,
    pos:+ts.scrollPosition().toFixed(1), from:r?+r.from.toFixed(1):null, to:r?+r.to.toFixed(1):null,
    nen:v.bars?v.bars.c.length:0, dec:v.dec, elW:document.querySelector('#chart').clientWidth,
    elH:document.querySelector('#chart').clientHeight};
});

(async()=>{const b=await chromium.launch();
const page=await b.newPage({viewport:{width:414,height:896}});
page.on('pageerror',e=>console.log('  [LỖI JS]',e.message));
page.on('console',m=>{if(m.type()==='error')console.log('  [console]',m.text().slice(0,160));});
await page.route('**www.okx.com/**',async r=>{const u=new URL(r.request().url());let data=[];
 if(u.pathname.endsWith('/market/tickers'))data=COINS.map(x=>({instId:`${x}-USDT-SWAP`,last:String(PX[x]),open24h:String(PX[x]*0.98),volCcy24h:String(1e7/(COINS.indexOf(x)+1))}));
 else if(u.pathname.endsWith('/public/instruments'))data=COINS.map(x=>({instId:`${x}-USDT-SWAP`,listTime:'1600000000000',state:'live',instCategory:'1',tickSz:TICK[x]}));
 else if(u.pathname.endsWith('/market/candles')){await new Promise(z=>setTimeout(z,250));   // giả độ trễ mạng
   data=mk((u.searchParams.get('instId')||'BTC-USDT-SWAP').split('-')[0],u.searchParams.get('bar')||'1H');}
 r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({code:'0',data})});});
await page.route('**raw.githubusercontent.com/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"marks":[],"ts":0,"items":[]}'}));
await page.route('**ntfy.sh/**',r=>r.fulfill({status:200,body:'{}'}));
await page.goto('http://127.0.0.1:8799/index.html',{waitUntil:'networkidle'});
await page.waitForTimeout(1500);

for (const [i,ten] of [[0,'BTC'],[1,'ETH'],[2,'SOL'],[3,'WLD'],[4,'PUMP'],[1,'ETH lần 2'],[0,'BTC lần 2']]) {
  await page.locator('.tp-r').nth(i).click();
  await page.waitForTimeout(600);          // bấm nhanh, chưa kịp tải xong
  await page.evaluate(()=>window.__TOP && window.__TOP.nhip && window.__TOP.nhip());
  await page.waitForTimeout(2600);         // chờ qua vài nhịp 4 giây
  const s = await son(page);
  const ok = s.canvas && s.diemSang > 2000;
  console.log(`${ok?'OK  ':'TRỐNG'} mở ${ten}: ${JSON.stringify(s)}`);
  await page.screenshot({path:`doi_${ten}.png`});
  await page.locator('#cvBack').click();
  await page.waitForTimeout(500);
}
await b.close();})();
