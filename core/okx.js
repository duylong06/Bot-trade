// core/okx.js — gọi API công khai của OKX. Chạy được cả trong Node 18+ và trình duyệt.
import { fromRows } from './breakout.js';
import { EXCLUDE } from './config.js';

export const HOSTS = ['https://www.okx.com', 'https://aws.okx.com', 'https://my.okx.com'];
let host = HOSTS[0];
let gap = 0, nextAt = 0;   // giãn cách tối thiểu giữa hai lần gọi (ms) — bot đặt để không vượt giới hạn OKX

export const getHost = () => host;
export const setHost = h => { host = h; };
export const setThrottle = ms => { gap = ms; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function slot() {
  if (!gap) return;
  const now = Date.now(), w = Math.max(0, nextAt - now);
  nextAt = Math.max(now, nextAt) + gap;
  if (w) await sleep(w);
}

export async function api(path, params = {}, { retries = 3 } = {}) {
  const qs = new URLSearchParams(params).toString();
  let err;
  for (let a = 0; a <= retries; a++) {
    await slot();
    try {
      const r = await fetch(host + path + (qs ? '?' + qs : ''), { headers: { accept: 'application/json' } });
      if (r.status === 429) { await sleep(400 * (a + 1)); err = new Error('OKX 429'); continue; }
      const j = await r.json().catch(() => ({ code: 'HTTP' + r.status, msg: r.statusText }));
      if (j.code !== '0') throw new Error(`OKX ${j.code}: ${j.msg || ''}`.trim());
      return j.data;
    } catch (e) {
      err = e;
      if (a < retries) await sleep(300 * (a + 1));
    }
  }
  throw err;
}

// Thử lần lượt các tên miền OKX, giữ cái đầu tiên gọi được.
export async function pickHost() {
  const tried = [];
  for (const h of HOSTS) {
    host = h;
    try { await api('/api/v5/public/time', {}, { retries: 1 }); return { host: h, tried }; }
    catch (e) { tried.push(`${h}: ${e.message}`); }
  }
  host = HOSTS[0];
  const e = new Error('Không gọi được OKX: ' + tried.join(' | '));
  e.tried = tried;
  throw e;
}

/**
 * Nến của một hợp đồng. Trả về { K, forming }:
 *   K       nến ĐÃ ĐÓNG, cũ → mới, tối đa `count` cây
 *   forming nến đang chạy (mảng thô của OKX) hoặc null
 */
export async function candles(instId, bar = '1H', count = 520) {
  const seen = new Map();
  let after, forming = null;
  for (let page = 0; page < 6 && seen.size < count + 1; page++) {
    const params = { instId, bar, limit: '300' };
    if (after) params.after = after;
    const d = await api('/api/v5/market/candles', params);
    if (!d || !d.length) break;
    for (const r of d) {
      if (r[8] === '0') { if (!forming || +r[0] > +forming[0]) forming = r; continue; }
      seen.set(r[0], r);
    }
    after = d[d.length - 1][0];
    if (d.length < 300) break;
  }
  const rows = [...seen.values()].sort((a, b) => a[0] - b[0]).slice(-count);
  return { K: fromRows(rows), forming };
}

// Vài cây nến mới nhất (thô, mới → cũ), dùng để chốt nến vừa đóng.
export const latest = (instId, bar = '1H', n = 3) =>
  api('/api/v5/market/candles', { instId, bar, limit: String(n) });

// Toàn bộ hợp đồng USDT-SWAP, xếp theo khối lượng 24h (quy ra USDT) giảm dần.
export async function swapTickers() {
  const d = await api('/api/v5/market/tickers', { instType: 'SWAP' });
  return d
    .filter(x => x.instId.endsWith('-USDT-SWAP') && !EXCLUDE.includes(x.instId.split('-')[0]))
    .map(x => {
      const last = +x.last, open = +x.open24h;
      return {
        instId: x.instId, coin: x.instId.split('-')[0],
        last, open24h: open, high24h: +x.high24h, low24h: +x.low24h,
        chg: open ? (last - open) / open : 0,
        volUsd: (+x.volCcy24h || 0) * last,
      };
    })
    .sort((a, b) => b.volUsd - a.volUsd);
}

// Bước giá của từng hợp đồng (để hiển thị đúng số lẻ).
export async function tickSizes() {
  const d = await api('/api/v5/public/instruments', { instType: 'SWAP' });
  const m = {};
  for (const x of d) m[x.instId] = x.tickSz;
  return m;
}
