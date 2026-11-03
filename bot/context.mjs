// bot/context.mjs — dữ liệu cho lớp chấm điểm (prompt V8.0, module 2): bối cảnh thị trường (BTC.D/USDT.D, tin Đỏ FED,
// dòng tiền ví sàn on-chain, whale alert, kênh on-chain) và dữ liệu từng đồng (nến đa khung, OI, taker volume, sổ lệnh).
// Mọi nguồn đều công khai, không cần khoá. Nguồn nào lỗi thì bỏ qua (điểm lớp đó tính trung tính), không làm hỏng lượt quét.

import * as okx from '../core/okx.js';
import { fromRows } from '../core/breakout.js';
import { domScenario } from '../core/score.js';
import { rhythm } from '../core/ta.js';

const HOUR = 3600e3;
const UA = { 'user-agent': 'bot-trade (github.com/duylong06/Bot-trade)', accept: 'application/json,text/html;q=0.9' };

async function get(url, { ms = 15000, text = false } = {}) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: UA, signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return text ? await r.text() : await r.json();
  } finally { clearTimeout(tm); }
}

const STABLE = new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'PYUSD', 'USDE', 'TUSD', 'USD1', 'RLUSD']);
const EXCH = /binance|okx|okex|coinbase|bybit|bitfinex|kraken|bitget|mexc|htx|huobi|kucoin|gate\.?io|gemini|bitstamp|crypto\.com|upbit|bithumb|deribit|robinhood|bitmex|poloniex|bitvavo|bingx|whitebit|lbank|bitflyer/i;
const decode = s => s.replace(/&#036;/g, '$').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');

// Đọc kênh Telegram công khai (t.me/s/<kênh>): [{ id, t, text }]
async function telegram(channel) {
  const html = await get(`https://t.me/s/${channel}`, { text: true, ms: 15000 });
  const out = [];
  for (const part of html.split('data-post="').slice(1)) {
    const id = part.slice(0, part.indexOf('"'));
    const m = part.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/);
    const tm = part.match(/datetime="([^"]+)"/);
    if (!m || !tm) continue;
    const text = decode(m[1].replace(/<br\s*\/?>/g, ' | ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    out.push({ id, t: Date.parse(tm[1]), text });
  }
  return out;
}

// Whale Alert: "2,241 $BTC (173,194,992 USD) transferred from unknown wallet to Coinbase Institutional"
export function parseWhale(text) {
  const m = text.match(/([\d,.]+)\s+[#$]?([A-Za-z0-9]+)\s+\(([\d,.]+)\s+USD\)\s+(?:transferred from (.+?) to (.+?)|(minted) at (.+?)|(burned) at (.+?))(?:\s+Details|\s*\||\s*$)/i);
  if (!m) return null;
  const coin = m[2].toUpperCase(), usd = +m[3].replace(/,/g, '');
  if (m[6]) return { coin, usd, kind: 'mint', from: m[7] };
  if (m[8]) return { coin, usd, kind: 'burn', from: m[9] };
  const from = m[4].trim(), to = m[5].trim();
  const fx = EXCH.test(from), tx = EXCH.test(to);
  const kind = !fx && tx ? 'in' : fx && !tx ? 'out' : fx && tx ? 'x2x' : 'other';
  return { coin, usd, kind, from, to };
}

const DUMP = /(xả|dump|bán tháo|\bdep\b|deposit|nạp[^|]{0,40}sàn|lên sàn|vào sàn|lên binance|lên okx|lên bybit|đem[^|]{0,30}lên)/i;
const coinsIn = text => [...new Set([...text.matchAll(/\$([A-Z][A-Z0-9]{1,9})\b/g)].map(m => m[1]))];

/* ---------------- on-chain: ví sàn ---------------- */

const ETH_USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7', ETH_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const W28C = '0x28C6c06298d514Db089934071355E5743bf21d60';
const TRON_TDQ = 'TDqSquXBgUCLYvYC4XZgrprLK589dkhSCf';
const TRON_USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', TRON_USDC = 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8';
export const BTC_EXCHANGE = { '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo': 'Binance', '3M219KR5vEneNb47ewrPfWyb5jQ2DjxRP6': 'Binance', 'bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97': 'Bitfinex' };
const BTC_WHALE = ['15DomY3arDPw5jD658Mbf3AY3wT3YCDmW2'];

async function ethToken(token, addr) {
  try {
    const j = await get(`https://eth.blockscout.com/api?module=account&action=tokenbalance&contractaddress=${token}&address=${addr}`, { ms: 12000 });
    if (j && j.result != null && /^\d+$/.test(String(j.result))) return +j.result / 1e6;
  } catch {}
  return null;
}
async function tronStables(addr) {
  const j = await get(`https://api.trongrid.io/v1/accounts/${addr}`, { ms: 12000 });
  const list = (j.data && j.data[0] && j.data[0].trc20) || [];
  let usdt = 0, usdc = 0;
  for (const o of list) { if (o[TRON_USDT] != null) usdt = +o[TRON_USDT] / 1e6; if (o[TRON_USDC] != null) usdc = +o[TRON_USDC] / 1e6; }
  return usdt + usdc;
}
async function btcBalance(addr) {
  const j = await get(`https://mempool.space/api/address/${addr}`, { ms: 12000 });
  const c = j.chain_stats, m = j.mempool_stats;
  return (c.funded_txo_sum - c.spent_txo_sum + (m ? m.funded_txo_sum - m.spent_txo_sum : 0)) / 1e8;
}

// giá trị của chuỗi lưu trữ cách đây h giờ (mẫu gần nhất trong ±2 giờ)
function ago(hist, key, h, now) {
  const want = now - h * HOUR;
  let best = null;
  for (const x of hist) if (x[key] != null && Math.abs(x.t - want) <= 2 * HOUR && (!best || Math.abs(x.t - want) < Math.abs(best.t - want))) best = x;
  return best ? best[key] : null;
}

/**
 * Bối cảnh thị trường cho một lượt quét. state.mkt giữ lịch sử (BTC.D/USDT.D, số dư ví, tin whale) giữa các lượt.
 * btcTicker: { last, chg } của BTC-USDT-SWAP.
 */
export async function marketContext(state, { log = () => {}, now = Date.now(), btcTicker = null } = {}) {
  const mk = state.mkt ||= {};
  mk.dom ||= []; mk.chain ||= []; mk.whale ||= []; mk.insight ||= [];
  const errs = [];
  const job = async (name, fn) => { try { await fn(); } catch (e) { errs.push(`${name}: ${e.message}`); } };
  const M = { at: now, errors: errs };

  let K1D = null, K4H = null;
  await Promise.all([
    job('CoinGecko', async () => {
      const g = (await get('https://api.coingecko.com/api/v3/global')).data;
      const p = g.market_cap_percentage || {};
      mk.dom.push({ t: now, btc: +(+p.btc).toFixed(3), usdt: +(+p.usdt).toFixed(3), total: Math.round(g.total_market_cap.usd) });
    }),
    job('lịch tin', async () => {
      // nguồn giới hạn số lần gọi → giữ lịch trong state, 6 giờ mới tải lại
      const c = mk.cal;
      if (!c || now - c.at > 6 * HOUR) {
        try {
          const cal = await get('https://nfs.faireconomy.media/ff_calendar_thisweek.json');
          mk.cal = { at: now, red: cal.filter(x => x.country === 'USD' && x.impact === 'High').map(x => ({ title: x.title, t: Date.parse(x.date) })).filter(x => isFinite(x.t)) };
        } catch (e) { if (!c) throw e; }
      }
      M.red = mk.cal ? mk.cal.red : [];
    }),
    job('whale_alert', async () => {
      const seen = new Set(mk.whale.map(x => x.id));
      for (const m of await telegram('whale_alert_io')) {
        if (seen.has(m.id)) continue;
        const w = parseWhale(m.text);
        if (w) mk.whale.push({ id: m.id, t: m.t, ...w });
      }
    }),
    job('kênh on-chain', async () => {
      const seen = new Set(mk.insight.map(x => x.id));
      for (const m of await telegram('huntercapital9x6')) {
        if (seen.has(m.id)) continue;
        mk.insight.push({ id: m.id, t: m.t, coins: coinsIn(m.text), dump: DUMP.test(m.text), text: m.text.slice(0, 240) });
      }
    }),
    job('ví on-chain', async () => {
      const [u28, c28, tron, ...btc] = await Promise.all([
        ethToken(ETH_USDT, W28C), ethToken(ETH_USDC, W28C), tronStables(TRON_TDQ).catch(() => null),
        ...Object.keys(BTC_EXCHANGE).map(a => btcBalance(a).catch(() => null)),
      ]);
      const whale = await Promise.all(BTC_WHALE.map(a => btcBalance(a).catch(() => null)));
      const okB = btc.every(x => x != null);
      mk.chain.push({ t: now, s28c: u28 != null && c28 != null ? Math.round(u28 + c28) : null, tron: tron != null ? Math.round(tron) : null,
        btcEx: okB ? +btc.reduce((s, x) => s + x, 0).toFixed(2) : null, btcWhale: whale[0] != null ? +whale[0].toFixed(2) : null });
    }),
    job('BTC 1D/4H', async () => {
      K1D = (await okx.candles('BTC-USDT-SWAP', '1Dutc', 300)).K;
      K4H = (await okx.candles('BTC-USDT-SWAP', '4H', 300)).K;
    }),
  ]);
  // dọn lịch sử: 8 ngày
  const keep = now - 8 * 24 * HOUR;
  mk.dom = mk.dom.filter(x => x.t >= keep); mk.chain = mk.chain.filter(x => x.t >= keep);
  mk.whale = mk.whale.filter(x => x.t >= now - 48 * HOUR); mk.insight = mk.insight.filter(x => x.t >= now - 48 * HOUR);

  // BTC
  const btcPx = btcTicker ? btcTicker.last : K1D ? K1D.c[K1D.c.length - 1] : null;
  const btcChg = btcTicker ? btcTicker.chg : 0;
  M.btc = { K1D, K4H, chg24: btcChg, px: btcPx, trend1D: K1D ? rhythm(K1D) : 0, down1D: K1D ? K1D.c[K1D.c.length - 1] < K1D.o[K1D.c.length - 1] : false };

  // BTC.D / USDT.D: biến động 24h (điểm %)
  const d = mk.dom.length ? mk.dom[mk.dom.length - 1] : null;
  const b24 = ago(mk.dom, 'btc', 24, now), u24 = ago(mk.dom, 'usdt', 24, now);
  M.dom = d ? { btc: d.btc, usdt: d.usdt, dBtc: b24 != null ? +(d.btc - b24).toFixed(3) : null, dUsdt: u24 != null ? +(d.usdt - u24).toFixed(3) : null, total: d.total } : null;
  M.scenario = domScenario(M.dom, btcChg);

  // TOTAL vs BTC (7 ngày): cùng tạo đỉnh/đáy mới hay phân kỳ
  if (mk.dom.length >= 24 * 6 && K4H) {
    const tot = mk.dom.filter(x => x.total), lastT = tot[tot.length - 1].total;
    const hiT = Math.max(...tot.slice(0, -6).map(x => x.total)), loT = Math.min(...tot.slice(0, -6).map(x => x.total));
    const n4 = K4H.c.length, w = K4H.c.slice(n4 - 42, n4 - 1);
    const hiB = Math.max(...w), loB = Math.min(...w), lastB = K4H.c[n4 - 1];
    const tNew = lastT > hiT ? 1 : lastT < loT ? -1 : 0, bNew = lastB > hiB ? 1 : lastB < loB ? -1 : 0;
    M.totalVsBtc = tNew === bNew ? (tNew ? `đồng thuận: cùng tạo ${tNew > 0 ? 'đỉnh' : 'đáy'} mới 7 ngày` : 'đồng thuận (chưa tạo đỉnh/đáy mới)') : `PHÂN KỲ: BTC ${bNew > 0 ? 'đỉnh mới' : bNew < 0 ? 'đáy mới' : 'chưa phá'} – TOTAL ${tNew > 0 ? 'đỉnh mới' : tNew < 0 ? 'đáy mới' : 'chưa phá'} (7 ngày)`;
  } else M.totalVsBtc = 'chưa đủ 7 ngày dữ liệu TOTAL';

  // Tin Đỏ: ±45 phút quanh giờ công bố → đóng băng lệnh mới
  const hhmm = t => new Date(t + 7 * HOUR).toISOString().slice(11, 16);
  const red = M.red || [];
  const hit = red.find(x => Math.abs(now - x.t) <= 45 * 60e3);
  M.blackout = hit ? { active: true, title: hit.title, at: hit.t, hhmm: hhmm(hit.t) } : { active: false };
  M.nextRed = red.filter(x => x.t > now && x.t - now <= 24 * HOUR).map(x => ({ title: x.title, at: x.t, hhmm: hhmm(x.t) }));

  // Whale alert: tổng theo đồng (USD) 12 giờ / 24 giờ; stablecoin vào sàn + mint; BTC vào/ra sàn 2 giờ
  const whale = {};
  let stableIn2h = 0, stableIn24 = 0, mint24 = 0, btcIn2h = 0, btcOut2h = 0;
  for (const w of mk.whale) {
    const age = now - w.t;
    const o = whale[w.coin] ||= { in12: 0, out12: 0, in24: 0, out24: 0 };
    if (w.kind === 'in') { if (age <= 12 * HOUR) o.in12 += w.usd; if (age <= 24 * HOUR) o.in24 += w.usd; }
    if (w.kind === 'out') { if (age <= 12 * HOUR) o.out12 += w.usd; if (age <= 24 * HOUR) o.out24 += w.usd; }
    if (STABLE.has(w.coin)) {
      if (w.kind === 'in' && age <= 2 * HOUR) stableIn2h += w.usd;
      if (w.kind === 'in' && age <= 24 * HOUR) stableIn24 += w.usd;
      if (w.kind === 'mint' && age <= 24 * HOUR) mint24 += w.usd;
      if (w.kind === 'mint' && age <= 2 * HOUR) stableIn2h += w.usd;
    }
    if (w.coin === 'BTC' && age <= 2 * HOUR) { if (w.kind === 'in') btcIn2h += w.usd; if (w.kind === 'out') btcOut2h += w.usd; }
  }
  M.whale = whale;
  // Kênh on-chain: bài báo cá voi/đội dự án xả coin trong 12 giờ qua → chặn LONG coin đó
  M.insight = {};
  // (BTC, ETH, stablecoin không chặn theo kênh này — kênh viết về altcoin; BTC/ETH xét bằng ví sàn + whale alert)
  for (const x of mk.insight) if (x.dump && now - x.t <= 12 * HOUR) for (const c of x.coins) {
    if (c === 'BTC' || c === 'ETH' || STABLE.has(c)) continue;
    if (!M.insight[c] || M.insight[c].t < x.t) M.insight[c] = { t: x.t, text: x.text };
  }

  // Ví sàn: biến động 2 giờ / 24 giờ / 7 ngày
  const ch = mk.chain.length ? mk.chain[mk.chain.length - 1] : {};
  const dd = (key, h) => { const a = ago(mk.chain, key, h, now); return ch[key] != null && a != null ? ch[key] - a : null; };
  const st2 = [dd('s28c', 2), dd('tron', 2)].filter(x => x != null), st24 = [dd('s28c', 24), dd('tron', 24)].filter(x => x != null);
  const st7 = [dd('s28c', 168), dd('tron', 168)].filter(x => x != null);
  const stable2hWallet = st2.length ? st2.reduce((x, y) => x + y, 0) : null;
  const btcEx2h = dd('btcEx', 2), btcEx24 = dd('btcEx', 24);
  const px = btcPx || 0;
  const flow = {
    s28c: ch.s28c ?? null, tron: ch.tron ?? null, btcEx: ch.btcEx ?? null,
    stable2hWallet, stable24hWallet: st24.length ? st24.reduce((x, y) => x + y, 0) : null, stable7dWallet: st7.length ? st7.reduce((x, y) => x + y, 0) : null,
    stableIn2h, stableIn24, mint24, btcIn2h, btcOut2h,
    btcEx2h: btcEx2h != null ? btcEx2h * px : (btcIn2h - btcOut2h) || 0, btcEx24: btcEx24 != null ? btcEx24 * px : null,
  };
  let bias = 0;
  const stIn = Math.max(stable2hWallet || 0, stableIn2h);
  if (stIn >= 200e6) bias += 2; else if ((stable2hWallet || 0) <= -200e6) bias -= 2;
  const btcNet = Math.max(btcEx2h != null ? btcEx2h * px : -Infinity, btcIn2h - btcOut2h);
  if (btcNet >= 150e6) bias -= 2; else if (Math.min(btcEx2h != null ? btcEx2h * px : Infinity, btcIn2h - btcOut2h) <= -150e6) bias += 2;
  flow.bias = bias;
  M.flow = flow;
  if (errs.length) log('  bối cảnh thị trường — lỗi nguồn: ' + errs.join(' · '));
  return M;
}

/* ---------------- dữ liệu từng đồng ---------------- */

const TFMAP = { '1M': '1Mutc', '1W': '1Wutc', '1D': '1Dutc', '4H': '4H', '1H': '1H', '30m': '30m', '15m': '15m' };

/**
 * Nến đa khung + OI 1H (≈ 200 giờ) + taker volume 1H + sổ lệnh 400 mức.
 * have: { '1H': K, '4H': K, '30m': K } đã tải sẵn trong lượt quét (khỏi tải lại).
 */
export async function coinData(u, { have = {}, ctVal = null, log = () => {} } = {}) {
  const D = { coin: u.coin, instId: u.instId, K: { ...have }, ctVal, ticker: { last: u.last, bid: u.bid, ask: u.ask, volUsd: u.volUsd, chg: u.chg } };
  const errs = [];
  const job = async (name, fn) => { try { await fn(); } catch (e) { errs.push(`${name} ${e.message}`); } };
  await Promise.all([
    ...Object.entries(TFMAP).filter(([k]) => !D.K[k]).map(([k, bar]) => job(k, async () => {
      if (k === '1D') {
        // nến ngày: lấy cả khối lượng quy USDT (cột 7) để so với trung bình 7 ngày
        const rows = await okx.api('/api/v5/market/candles', { instId: u.instId, bar, limit: '300' });
        const closed = rows.filter(r => r[8] === '1');
        D.K[k] = fromRows(closed);
        D.vol1D = closed.map(r => [+r[0], +r[7]]).sort((a, b) => a[0] - b[0]).map(r => r[1]);
      } else D.K[k] = (await okx.candles(u.instId, bar, 300)).K;
    })),
    job('OI', async () => {
      const a = await okx.api('/api/v5/rubik/stat/contracts/open-interest-history', { instId: u.instId, period: '1H', limit: '100' });
      const end = a.length ? a[a.length - 1][0] : null;
      const b = end ? await okx.api('/api/v5/rubik/stat/contracts/open-interest-history', { instId: u.instId, period: '1H', limit: '100', end }) : [];
      const m = new Map(); for (const r of [...a, ...b]) m.set(+r[0], +r[3]);
      D.oi = [...m.entries()].sort((x, y) => x[0] - y[0]);
    }),
    job('taker', async () => {
      const a = await okx.api('/api/v5/rubik/stat/taker-volume-contract', { instId: u.instId, period: '1H', unit: '2', limit: '48' });
      D.taker = a.map(r => [+r[0], +r[2], +r[1]]).sort((x, y) => x[0] - y[0]);     // [ts, mua chủ động, bán chủ động]
    }),
    job('sổ lệnh', async () => {
      const b = (await okx.api('/api/v5/market/books', { instId: u.instId, sz: '400' }))[0];
      D.book = { asks: b.asks.map(r => [+r[0], +r[1]]), bids: b.bids.map(r => [+r[0], +r[1]]) };
    }),
  ]);
  if (errs.length) log(`  ${u.coin}: thiếu ${errs.join(' · ')}`);
  return D;
}

/* ---------------- báo cáo dòng tiền (07:00 · 15:00 · 23:00) ---------------- */

const usd = x => x == null ? '—' : (x >= 0 ? '+' : '−') + (Math.abs(x) >= 1e9 ? (Math.abs(x) / 1e9).toFixed(2) + 'B$' : (Math.abs(x) / 1e6).toFixed(0) + 'M$');

export function flowReport(M) {
  const f = M.flow || {}, d = M.dom;
  const lines = [];
  if (d) lines.push(`BTC.D ${d.btc}% (${d.dBtc == null ? '—' : (d.dBtc >= 0 ? '+' : '') + d.dBtc}) · USDT.D ${d.usdt}% (${d.dUsdt == null ? '—' : (d.dUsdt >= 0 ? '+' : '') + d.dUsdt}) · 24h`);
  lines.push(`Kịch bản: ${M.scenario ? M.scenario.text : '—'}`);
  lines.push(`Stablecoin ví 28c + TDqSq: 24h ${usd(f.stable24hWallet)} · 7 ngày ${usd(f.stable7dWallet)} · whale alert vào sàn 24h ${usd(f.stableIn24)}, mint ${usd(f.mint24)}`);
  lines.push(`BTC ví sàn (Binance, Bitfinex): 24h ${usd(f.btcEx24)}${f.btcEx24 != null ? (f.btcEx24 > 0 ? ' (nạp lên sàn — áp lực bán)' : ' (rút khỏi sàn — tích trữ)') : ''}`);
  const big = Object.entries(M.whale || {}).filter(([c]) => !STABLE.has(c)).map(([c, o]) => [c, o.in24 - o.out24]).filter(([, v]) => Math.abs(v) >= 25e6).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4);
  if (big.length) lines.push('Cá voi ròng 24h: ' + big.map(([c, v]) => `${c} ${usd(v)} ${v > 0 ? 'vào sàn' : 'ra sàn'}`).join(', '));
  if (M.nextRed && M.nextRed.length) lines.push('Tin Đỏ 24h tới: ' + M.nextRed.slice(0, 3).map(x => `${x.hhmm} ${x.title}`).join(' · '));
  lines.push(`TOTAL vs BTC: ${M.totalVsBtc}`);
  return lines.join('\n');
}

// Cảnh báo dòng tiền tức thì: stablecoin vào sàn ≥ 200M$ / 2 giờ, BTC vào hoặc ra sàn ≥ 150M$ / 2 giờ.
export function flowAlerts(M) {
  const f = M.flow || {}, out = [];
  const st = Math.max(f.stable2hWallet || 0, f.stableIn2h || 0);
  if (st >= 200e6) out.push({ key: 'stable-in', title: '💵 Stablecoin đổ vào sàn', body: `${usd(st)} USDT/USDC vào ví sàn trong 2 giờ (ví 28c / TDqSq / whale alert) — tiền mặt sẵn sàng mua, nghiêng TĂNG (+2 điểm).` });
  const btcIn = Math.max(f.btcEx2h || 0, (f.btcIn2h || 0) - (f.btcOut2h || 0));
  if (btcIn >= 150e6) out.push({ key: 'btc-in', title: '🐋 Cá mập nạp BTC lên sàn', body: `${usd(btcIn)} BTC vào sàn trong 2 giờ — chuẩn bị xả, áp lực GIẢM (−2 điểm, chặn LONG BTC).` });
  const btcOut = Math.min(f.btcEx2h || 0, (f.btcIn2h || 0) - (f.btcOut2h || 0));
  if (btcOut <= -150e6) out.push({ key: 'btc-out', title: '🐋 Cá mập rút BTC khỏi sàn', body: `${usd(btcOut)} BTC rút khỏi sàn trong 2 giờ — tích trữ, nghiêng TĂNG (+2 điểm).` });
  return out;
}
