// Số cặp vĩnh cửu của Binance và OKX, lấy qua CoinGecko (Binance chặn IP của Actions).
const get = async u => { for (let i=0;i<3;i++){ try{ const r=await fetch(u,{headers:{'User-Agent':'Mozilla/5.0'}});
  if(r.ok) return await r.json(); console.log('HTTP',r.status,u); }catch(e){ console.log(e.message); }
  await new Promise(s=>setTimeout(s,2500)); } return null; };
for (const san of ['binance_futures','okex_swap','bybit','gate_futures']) {
  const d = await get(`https://api.coingecko.com/api/v3/derivatives/exchanges/${san}`);
  if (!d) { console.log(`${san}: không lấy được`); continue; }
  console.log(`${(d.name||san).padEnd(26)} vĩnh cửu ${String(d.number_of_perpetual_pairs).padStart(4)} · có hạn ${String(d.number_of_futures_pairs).padStart(3)}`);
  await new Promise(s=>setTimeout(s,3000));
}
