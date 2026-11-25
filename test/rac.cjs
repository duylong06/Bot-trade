// Nến rác thật hay gặp: giá 0, giá âm, nến vọt gấp trăm lần, ô trống, chuỗi ngắn.
// Dữ liệu giả "đẹp" của mấy bài trước không bao giờ có mấy thứ này.
const { chromium } = require('playwright');
const BASES=['AAA','BBB','CCC','DDD','EEE','FFF'];
const PX=100;
function nen(kieu){
  const step=36e5,now=Math.floor(Date.now()/step)*step,rows=[];
  let r=7919,p=PX;
  const rnd=()=>{r=(r*1103515245+12345)&0x7fffffff;return r/0x7fffffff;};
  const n = kieu==='ngan' ? 40 : 300;
  for(let i=n-1;i>=0;i--){
    const t=now-i*step; let o=p,c=Math.max(1,p*(1+(rnd()-.5)*.02)),h=Math.max(o,c)*1.002,l=Math.min(o,c)*.998;
    if(kieu==='khong'&&i===150){rows.push([String(t),'0','0','0','0','0','0','0','1']);continue;}  // nến toàn số 0
    if(kieu==='vot'&&i===150){h=c*300;}                           // râu vọt gấp 300 lần
    if(kieu==='am'&&i===150){rows.push([String(t),String(o),String(h),'-5',String(c),'1000','0','0','1']);p=c;continue;}  // giá âm
    if(kieu==='trong'&&i===150){return rows.reverse();}           // cụt giữa chừng
    if(kieu==='chu'&&i===150){rows.push([String(t),'abc','','null','NaN','1000','0','0','1']);p=c;continue;}
    rows.push([String(t),String(o),String(h),String(l),String(c),'1000','0','0',i===0?'0':'1']);p=c;
  }
  return rows.reverse();
}
const KIEU={AAA:'lanh',BBB:'khong',CCC:'vot',DDD:'am',EEE:'chu',FFF:'ngan'};

(async()=>{
let hong=0;
const b=await chromium.launch();
const page=await b.newPage({viewport:{width:393,height:852},deviceScaleFactor:2,isMobile:true,hasTouch:true});
page.on('pageerror',e=>console.log('  [LỖI JS]',e.message));
await page.route('**www.okx.com/**',r=>{const u=new URL(r.request().url());let data=[];
 if(u.pathname.endsWith('/market/tickers'))data=BASES.map((x,i)=>({instId:`${x}-USDT-SWAP`,last:String(PX),open24h:'98',volCcy24h:String(1e7/(i+1))}));
 else if(u.pathname.endsWith('/public/instruments'))data=BASES.map(x=>({instId:`${x}-USDT-SWAP`,state:'live',instCategory:'1',tickSz:'0.01'}));
 else if(u.pathname.endsWith('/market/candles'))data=nen(KIEU[(u.searchParams.get('instId')||'AAA-X').split('-')[0]]);
 r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({code:'0',data})});});
await page.route('**raw.githubusercontent.com/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"marks":[],"ts":0,"items":[]}'}));
await page.route('**ntfy.sh/**',r=>r.fulfill({status:200,body:'{}'}));
await page.goto('http://127.0.0.1:8799/index.html',{waitUntil:'networkidle'});
await page.waitForTimeout(1500);

const TEN={lanh:'nến lành',khong:'có nến toàn số 0',vot:'có râu vọt 300 lần',am:'có giá âm',chu:'có ô chữ/NaN',ngan:'chỉ 40 nến'};
for(let i=0;i<BASES.length;i++){
  const kieu=KIEU[BASES[i]];
  await page.locator('.tp-r').nth(i).tap();
  await page.waitForTimeout(1800);
  const s=await page.evaluate(()=>{
    const v=window.__cv;
    if(!v.bars) return {noBars:true, loi:!document.querySelector('#cvErr').hidden};
    const b=v.bars; let lo=Infinity,hi=-Infinity,xau=0;
    for(let j=0;j<b.c.length;j++){
      for(const q of [b.o[j],b.h[j],b.l[j],b.c[j]]) if(!Number.isFinite(q)||q<=0) xau++;
      if(b.l[j]<lo)lo=b.l[j]; if(b.h[j]>hi)hi=b.h[j];
    }
    const c=document.querySelector('#chart canvas'),g=c.getContext('2d');
    const d=g.getImageData(0,0,c.width,Math.min(400,c.height)).data;
    let n=0; for(let k=0;k<d.length;k+=4) if(d[k]+d[k+1]+d[k+2]>120)n++;
    return {nen:b.c.length, oXau:xau, tiLe:+(hi/Math.max(lo,1e-12)).toFixed(1), diemSang:n,
      loi:!document.querySelector('#cvErr').hidden};
  });
  // đạt = hoặc vẽ ra tử tế, hoặc báo lỗi rõ ràng; KHÔNG được im lặng mà trống
  const ok = s.loi || (!s.noBars && s.oXau===0 && s.tiLe<50 && s.diemSang>2500);
  if(!ok) hong++;
  console.log(`  ${ok?'OK   ':'HỎNG '} ${BASES[i]} (${TEN[kieu]}): ${JSON.stringify(s)}`);
  await page.locator('#cvBack').tap(); await page.waitForTimeout(500);
}
console.log(hong?`\n==> ${hong} kiểu dữ liệu làm hỏng biểu đồ`:'\n==> Chịu được hết');
await b.close(); process.exit(hong?1:0);})();
