// bot/mcap.mjs — xếp hạng vốn hoá thị trường (market cap) để chọn đồng theo dõi.
// Nguồn: CoinGecko (không cần khoá), dự phòng CoinPaprika. Hỏng cả hai thì dùng bảng lần trước.

// Không theo dõi: đồng ổn định giá, token bọc/stake/cầu nối, token vàng (vàng đã có XAU riêng).
const SKIP = new Set(`USDT USDC USDE DAI FDUSD PYUSD USD1 USDS TUSD USDD RLUSD USDTB USDF BUSD GUSD USDP EURC USDG USDX
  SUSDE SUSDS BFUSD USD0 USDY USYC BUIDL OUSG USTB USDO USDA FRAX LUSD CRVUSD GHO USR DEUSD SRUSD
  PAXG XAUT KAU CGO
  WBTC WETH STETH WSTETH WEETH CBBTC RETH METH EZETH RSETH JITOSOL MSOL BNSOL LBTC SOLVBTC CLBTC BTCB WBNB
  WTRX WSOL TBTC FBTC CBETH OSETH SWETH ETHX SFRXETH FRXETH UNIBTC PUMPBTC ENZOBTC BBTC WHYPE KHYPE STHYPE
  JLP BSC-USD BUSDT WEETHS SAVAX STKAAVE LSETH`.split(/\s+/).filter(Boolean));
const isStable = c => /USD|EUR/.test(c.symbol) && c.price > 0.9 && c.price < 1.1;
const isWrapped = c => /^(wrapped|staked|bridged|restaked|liquid staked)\b/i.test(c.name) || /\b(staked|wrapped)\b/i.test(c.name);

async function getJSON(url, ms = 15000) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'bot-trade (github.com/duylong06/Bot-trade)' }, signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(tm); }
}

async function coingecko() {
  const out = [];
  for (const page of [1, 2]) {
    const d = await getJSON(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}`);
    for (const c of d) if (c.market_cap) out.push({ symbol: String(c.symbol).toUpperCase(), name: c.name, mcap: c.market_cap, price: c.current_price });
    if (out.length >= 300) break;
  }
  return out;
}

async function coinpaprika() {
  const d = await getJSON('https://api.coinpaprika.com/v1/tickers?quotes=USD', 30000);
  return d.filter(c => c.rank > 0 && c.quotes && c.quotes.USD && c.quotes.USD.market_cap)
    .sort((a, b) => a.rank - b.rank).slice(0, 500)
    .map(c => ({ symbol: String(c.symbol).toUpperCase(), name: c.name, mcap: c.quotes.USD.market_cap, price: c.quotes.USD.price }));
}

/**
 * Bảng xếp hạng vốn hoá (đã bỏ stablecoin, token bọc…), mới nhất trước tiên.
 * cache: { at, src, list } lần trước. Trả về { at, src, list, fresh }.
 */
export async function ranking(cache, log = () => {}) {
  for (const [src, fn] of [['CoinGecko', coingecko], ['CoinPaprika', coinpaprika]]) {
    try {
      const raw = await fn();
      const seen = new Set(), list = [];
      for (const c of raw.sort((a, b) => b.mcap - a.mcap)) {
        if (seen.has(c.symbol) || SKIP.has(c.symbol) || isStable(c) || isWrapped(c)) continue;
        seen.add(c.symbol); list.push({ symbol: c.symbol, name: c.name, mcap: Math.round(c.mcap) });
      }
      if (list.length >= 80) return { at: Date.now(), src, list, fresh: true };
      log(`  ${src}: chỉ có ${list.length} đồng — thử nguồn khác`);
    } catch (e) { log(`  ${src} lỗi: ${e.message}`); }
  }
  if (cache && cache.list && cache.list.length) return { ...cache, fresh: false };
  return null;
}
