// Mở biểu đồ TỪ TAB "BOT VẼ" — đúng lối người dùng báo lỗi.
// Danh sách kèo đọc THẬT từ nhánh moc-data, chỉ giả lập OKX.
const { chromium } = require('playwright');
const fs = require('fs');
const SP = JSON.parse(fs.readFileSync('/tmp/sp.json','utf8'));
const PX = {}; const TICK = {};
for (const x of SP.items) { PX[x.base] = x.price; TICK[x.base] = String(Math.pow(10, Math.floor(Math.log10(x.price)) - 4)); }
// vài đồng top cho danh sách chính
for (const [b,p] of [['BTC',59000],['ETH',1650],['SOL',68]]) { if(!PX[b]){PX[b]=p;TICK[b]='0.01';} }
const BASES = Object.keys(PX);

function mk(base, bar) {
  const step = bar==='15m'?9e5:bar==='30m'?18e5:bar==='4H'?144e5:bar==='1Dutc'?864e5:36e5;
  const now = Math.floor(Date.now()/step)*step;
  let r = base.length*7919+step, p = PX[base];
  const rnd = () => { r=(r*1103515245+12345)&0x7fffffff; return r/0x7fffffff; };
  const rows = [];
  for (let i=299;i>=0;i--){
    const t=now-i*step, o=p, c=Math.max(p*0.5, p*(1+Math.sin(i/19)*0.004+(rnd()-0.5)*0.012));
    rows.push([String(t),String(o),String(Math.max(o,c)*(1+rnd()*0.003)),String(Math.min(o,c)*(1-rnd()*0.003)),String(c),'1000','0','0',i===0?'0':'1']);
    p=c;
  }
  return rows.reverse();
}

const son = page => page.evaluate(()=>{
  // 
  const cs=[...document.querySelectorAll('#chart canvas')];
  const c=cs[0];
  if(!c) return {canvas:false};
  const g=c.getContext('2d');
  const d=g.getImageData(0,0,c.width,Math.min(500,c.height)).data;
  let n=0; for(let i=0;i<d.length;i+=4) if(d[i]+d[i+1]+d[i+2]>120) n++;
  const v=window.__cv, ts=v.chart.timeScale(), r=ts.getVisibleLogicalRange();
  return {soCanvas:cs.length, cvW:c.width, cvH:c.height, elW:document.querySelector("#chart").clientWidth, elH:document.querySelector("#chart").clientHeight, diemSang:n, pos:+ts.scrollPosition().toFixed(1),
    from:r?+r.from.toFixed(1):null, to:r?+r.to.toFixed(1):null,
    nen:v.bars?v.bars.c.length:0, sym:v.sym, tf:v.tf, dec:v.dec,
    duongBot:v.botLines.length, coNen:v.coNen()};
});

(async()=>{
  const loi=[];
  const b=await chromium.launch();
  const page=await b.newPage({viewport:{width:393,height:852},deviceScaleFactor:3,
    isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'});
  page.on('pageerror',e=>{loi.push('PAGEERROR: '+e.message);console.log('  [LỖI JS]',e.message);});
  page.on('console',m=>{if(m.type()==='error'){loi.push(m.text());console.log('  [console]',m.text().slice(0,200));}});
  await page.route('**www.okx.com/**',async r=>{
    const u=new URL(r.request().url()); let data=[];
    if(u.pathname.endsWith('/market/tickers'))
      data=BASES.map((x,i)=>({instId:`${x}-USDT-SWAP`,last:String(PX[x]),open24h:String(PX[x]*0.98),volCcy24h:String(1e7/(i+1))}));
    else if(u.pathname.endsWith('/public/instruments'))
      data=BASES.map(x=>({instId:`${x}-USDT-SWAP`,listTime:'1600000000000',state:'live',instCategory:'1',tickSz:TICK[x]}));
    else if(u.pathname.endsWith('/market/candles')){
      await new Promise(z=>setTimeout(z,200));
      const base=(u.searchParams.get('instId')||'BTC-USDT-SWAP').split('-')[0];
      data = PX[base] ? mk(base,u.searchParams.get('bar')||'1H') : [];
    }
    r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({code:'0',data})});
  });
  await page.route('**ntfy.sh/**',r=>r.fulfill({status:200,body:'{}'}));
  // raw.githubusercontent.com để NGUYÊN — đọc dữ liệu thật

  await page.goto('http://127.0.0.1:8799/index.html',{waitUntil:'networkidle'});
  await page.waitForTimeout(1500);

  console.log('— Lối 1: vào thẳng tab Bot vẽ rồi bấm, chưa hề mở danh sách —');
  await page.locator('nav button[data-t="bot"]').tap();
  await page.waitForTimeout(3000);
  const n = await page.locator('#botList .mk').count();
  console.log('  số thẻ:', n);
  if(!n){ console.log('  không có thẻ nào, dừng'); await b.close(); return; }

  for (let i=0;i<Math.min(n,6);i++){
    const ten = (await page.locator('#botList .mk .sy').nth(i).textContent()).trim();
    const tf  = (await page.locator('#botList .mk .tf').nth(i).textContent()).trim();
    await page.locator('#botList [data-open]').nth(i).tap();
    await page.waitForTimeout(2200);
    const s = await son(page);
    const ok = s.canvas!==false && s.diemSang>2000 && s.coNen;
    console.log(`  ${ok?'OK   ':'HỎNG '} ${ten} ${tf}: ${JSON.stringify(s)}`);
    if(!ok) await page.screenshot({path:`botve_hong_${ten}.png`});
    await page.locator('#cvBack').tap();
    await page.waitForTimeout(600);
  }

  console.log('\n— Lối 2: mở danh sách trước, rồi sang Bot vẽ bấm —');
  await page.locator('nav button[data-t="top"]').tap();
  await page.waitForTimeout(2500);
  await page.locator('nav button[data-t="bot"]').tap();
  await page.waitForTimeout(2000);
  for (let i=0;i<Math.min(n,3);i++){
    const ten=(await page.locator('#botList .mk .sy').nth(i).textContent()).trim();
    await page.locator('#botList [data-open]').nth(i).tap();
    await page.waitForTimeout(2200);
    const s=await son(page);
    const ok=s.canvas!==false && s.diemSang>2000 && s.coNen;
    console.log(`  ${ok?'OK   ':'HỎNG '} ${ten}: ${JSON.stringify(s)}`);
    await page.locator('#cvBack').tap();
    await page.waitForTimeout(600);
  }
  console.log('\nlỗi JS:', loi.length?loi.slice(0,5).join(' | '):'không có');
  await b.close();
})();
