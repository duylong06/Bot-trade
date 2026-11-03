import fs from 'node:fs';
const UA = { 'user-agent': 'bot-trade (github.com/duylong06/Bot-trade)', accept: 'application/json,text/html' };
const T = [
 ['okx_oi_hist', 'https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=BTC-USDT-SWAP&period=1H&limit=100'],
 ['okx_taker', 'https://www.okx.com/api/v5/rubik/stat/taker-volume-contract?instId=BTC-USDT-SWAP&period=1H&limit=50'],
 ['okx_oi_now', 'https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP'],
 ['okx_funding', 'https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP'],
 ['okx_books', 'https://www.okx.com/api/v5/market/books?instId=BTC-USDT-SWAP&sz=400'],
 ['okx_liq', 'https://www.okx.com/api/v5/public/liquidation-orders?instType=SWAP&uly=BTC-USDT&state=filled&limit=100'],
 ['okx_tickers', 'https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT-SWAP'],
 ['okx_1M', 'https://www.okx.com/api/v5/market/candles?instId=BTC-USDT-SWAP&bar=1M&limit=300'],
 ['okx_1W', 'https://www.okx.com/api/v5/market/candles?instId=BTC-USDT-SWAP&bar=1W&limit=300'],
 ['okx_1Dutc', 'https://www.okx.com/api/v5/market/candles?instId=BTC-USDT-SWAP&bar=1Dutc&limit=3'],
 ['cg_global', 'https://api.coingecko.com/api/v3/global'],
 ['ff_cal', 'https://nfs.faireconomy.media/ff_calendar_thisweek.json'],
 ['bs_28c_tt', 'https://eth.blockscout.com/api/v2/addresses/0x28C6c06298d514Db089934071355E5743bf21d60/token-transfers?type=ERC-20&token=0xdAC17F958D2ee523a2206206994597C13D831ec7'],
 ['bs_28c_bal', 'https://eth.blockscout.com/api/v2/addresses/0x28C6c06298d514Db089934071355E5743bf21d60/token-balances'],
 ['bs_usdt_tt', 'https://eth.blockscout.com/api/v2/tokens/0xdAC17F958D2ee523a2206206994597C13D831ec7/transfers'],
 ['bs_meta', 'https://metadata.services.blockscout.com/api/v1/metadata?addresses=0x28C6c06298d514Db089934071355E5743bf21d60&chainId=1'],
 ['tron_acc', 'https://api.trongrid.io/v1/accounts/TDqSquXBgUCLYvYC4XZgrprLK589dkhSCf'],
 ['tron_trc20', 'https://api.trongrid.io/v1/accounts/TDqSquXBgUCLYvYC4XZgrprLK589dkhSCf/transactions/trc20?contract_address=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t&limit=50&min_timestamp=' + (Date.now() - 6 * 3600e3)],
 ['tronscan_tag', 'https://apilist.tronscanapi.com/api/accountv2?address=TDqSquXBgUCLYvYC4XZgrprLK589dkhSCf'],
 ['mempool_34xp', 'https://mempool.space/api/address/34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo'],
 ['mempool_34xp_txs', 'https://mempool.space/api/address/34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo/txs'],
 ['tg_whale', 'https://t.me/s/whale_alert_io'],
 ['tg_hunter', 'https://t.me/s/huntercapital9x6'],
];
const out = {};
await Promise.all(T.map(async ([k, u]) => {
  const t0 = Date.now();
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch(u, { headers: UA, signal: ctl.signal }); clearTimeout(tm);
    const txt = await r.text();
    out[k] = { status: r.status, ms: Date.now() - t0, len: txt.length, head: txt.slice(0, k.startsWith('tg_') ? 60000 : 6000) };
  } catch (e) { out[k] = { error: String(e.message), ms: Date.now() - t0 }; }
}));
fs.mkdirSync('probe-out', { recursive: true });
fs.writeFileSync('probe-out/probe.json', JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out)) console.log(k, v.status || v.error, v.len, v.ms + 'ms');
