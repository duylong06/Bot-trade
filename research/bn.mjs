// Thử xem GitHub Actions có gọi được Binance không, và cổng nào đi được.
const URLS = [
  ['futures ping',      'https://fapi.binance.com/fapi/v1/ping'],
  ['futures klines',    'https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=2'],
  ['futures exchInfo',  'https://fapi.binance.com/fapi/v1/exchangeInfo'],
  ['spot ping',         'https://api.binance.com/api/v3/ping'],
  ['spot vision',       'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=2'],
  ['kho lịch sử',       'https://data.binance.vision/data/futures/um/daily/klines/BTCUSDT/1h/BTCUSDT-1h-2026-11-16.zip'],
  ['futures gcp',       'https://fapi.binance.com/fapi/v1/time'],
  ['api1',              'https://api1.binance.com/api/v3/ping'],
  ['api-gcp',           'https://api-gcp.binance.com/api/v3/ping'],
];
for (const [ten, u] of URLS) {
  const t0 = Date.now();
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' });
    const txt = (await r.text()).slice(0, 110).replace(/\s+/g, ' ');
    console.log(`[${r.status}] ${ten.padEnd(16)} ${Date.now()-t0}ms  ${txt}`);
  } catch (e) { console.log(`[LỖI] ${ten.padEnd(16)} ${e.message}`); }
}
