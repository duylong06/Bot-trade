// Đếm số coin futures vĩnh cửu USDT trên OKX và Binance, và xem bên nào có gì bên kia không có.
import fs from 'node:fs';
const get = async (u, nhan) => {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) { console.log(`${nhan}: HTTP ${r.status}`); await new Promise(s=>setTimeout(s,1200)); continue; }
      return await r.json();
    } catch (e) { console.log(`${nhan}: ${e.message}`); await new Promise(s=>setTimeout(s,1200)); }
  }
  return null;
};

const out = {};

// ---- OKX
const ok = await get('https://www.okx.com/api/v5/public/instruments?instType=SWAP', 'OKX');
if (ok?.data) {
  const live = ok.data.filter(x => x.state === 'live');
  const usdt = live.filter(x => x.settleCcy === 'USDT');
  out.okx = {
    tong_swap: live.length,
    usdt: usdt.length,
    usdc: live.filter(x => x.settleCcy === 'USDC').length,
    coin_m: live.filter(x => x.settleCcy !== 'USDT' && x.settleCcy !== 'USDC').length,
    chi_coin: usdt.filter(x => String(x.instCategory||'')==='1').length,
    base: usdt.map(x => x.ctValCcy || x.instId.split('-')[0]),
  };
}

// ---- Binance
const bn = await get('https://fapi.binance.com/fapi/v1/exchangeInfo', 'Binance USDT-M');
if (bn?.symbols) {
  const live = bn.symbols.filter(s => s.status === 'TRADING' && s.contractType === 'PERPETUAL');
  const usdt = live.filter(s => s.quoteAsset === 'USDT');
  out.binance = {
    tong_perp: live.length,
    usdt: usdt.length,
    usdc: live.filter(s => s.quoteAsset === 'USDC').length,
    base: usdt.map(s => s.baseAsset),
  };
}
const bnd = await get('https://dapi.binance.com/dapi/v1/exchangeInfo', 'Binance COIN-M');
if (bnd?.symbols) out.binance_coinm = bnd.symbols.filter(s => s.contractStatus === 'TRADING' && s.contractType === 'PERPETUAL').length;

fs.mkdirSync('out', { recursive: true });
fs.writeFileSync('out/dem.json', JSON.stringify(out, null, 1));

const norm = s => s.replace(/^1000+/, '').replace(/^k/i,'').toUpperCase();
if (out.okx && out.binance) {
  const O = new Set(out.okx.base.map(norm)), B = new Set(out.binance.base.map(norm));
  const chiB = [...B].filter(x => !O.has(x)).sort();
  const chiO = [...O].filter(x => !B.has(x)).sort();
  console.log(`\nOKX  vĩnh cửu USDT: ${out.okx.usdt}  (tổng swap ${out.okx.tong_swap}, USDC ${out.okx.usdc}, ký quỹ coin ${out.okx.coin_m})`);
  console.log(`Binance vĩnh cửu USDT: ${out.binance.usdt}  (tổng perp ${out.binance.tong_perp}, USDC ${out.binance.usdc}, COIN-M ${out.binance_coinm ?? '?'})`);
  console.log(`\nBinance có mà OKX KHÔNG có: ${chiB.length} đồng`);
  console.log(chiB.join(' '));
  console.log(`\nOKX có mà Binance không có: ${chiO.length} đồng`);
  console.log(chiO.join(' '));
  fs.writeFileSync('out/chenh.json', JSON.stringify({ chiBinance: chiB, chiOkx: chiO }, null, 1));
}
