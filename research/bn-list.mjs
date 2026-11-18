const US=[
 ['A','https://data.binance.vision/?delimiter=/&prefix=data/futures/um/daily/klines/'],
 ['B','https://data.binance.vision/?delimiter=%2F&prefix=data%2Ffutures%2Fum%2Fdaily%2Fklines%2F'],
 ['C','https://s3-ap-northeast-1.amazonaws.com/data.binance.vision?delimiter=/&prefix=data/futures/um/daily/klines/'],
 ['D','https://data.binance.vision/data/futures/um/daily/klines/'],
 ['E','https://fapi.binance.com/fapi/v1/exchangeInfo'],
];
for(const [n,u] of US){
  try{ const r=await fetch(u,{headers:{'User-Agent':'Mozilla/5.0'}});
    const t=await r.text();
    console.log(`=== ${n} [${r.status}] ${r.headers.get('content-type')} ${t.length} byte`);
    console.log(t.slice(0,400).replace(/\n/g,' '));
    const pref=[...t.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)].length;
    const keys=[...t.matchAll(/<Key>([^<]+)<\/Key>/g)].length;
    console.log(`    <Prefix> ${pref} · <Key> ${keys}`);
  }catch(e){console.log(`=== ${n} LỖI ${e.message}`);}
}
