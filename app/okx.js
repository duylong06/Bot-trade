// app/okx.js — lấy dữ liệu OKX. Chỉ đọc, không cần đăng nhập, không gửi gì về đâu.

const API = 'https://www.okx.com';

/* Giới hạn nhịp gọi: OKX chặn khi gọi quá dày. Mỗi lượt lấy một "thẻ",
   hết thẻ thì chờ. 18 lượt/giây, cho phép dồn 18 lượt một lúc. */
const RL = { tok: 18, cap: 18, rate: 18 / 1000, last: Date.now() };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function rlTake() {
  for (;;) {
    const now = Date.now();
    RL.tok = Math.min(RL.cap, RL.tok + (now - RL.last) * RL.rate);
    RL.last = now;
    if (RL.tok >= 1) { RL.tok -= 1; return; }
    await sleep(Math.max(8, Math.ceil((1 - RL.tok) / RL.rate)));
  }
}

export async function api(path, params = {}) {
  const q = new URLSearchParams(params).toString();
  const url = `${API}${path}${q ? '?' + q : ''}`;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    await rlTake();
    try {
      const r = await fetch(url);
      if (r.status === 429 || r.status === 503) {
        RL.tok = 0; await sleep(500 * (attempt + 1)); lastErr = new Error('HTTP ' + r.status); continue;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.code !== '0') throw new Error(j.msg || 'Lỗi OKX');
      return j.data || [];
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await sleep(220 * (attempt + 1));
    }
  }
  throw lastErr || new Error('Không gọi được API');
}

/* Nến. Nến cuối là nến ĐANG CHẠY (OKX đánh dấu cột 9 bằng '0'). */
const KC = new Map();

/* Luôn trả BẢN SAO. Biểu đồ có sửa mảng nến (cây cuối chạy theo giá) nên nếu đưa thẳng
   đồ trong bộ đệm ra thì nó bị sửa theo, lần sau lấy lại là dữ liệu đã hỏng. */
const chep = k => ({ t: k.t.slice(), o: k.o.slice(), h: k.h.slice(), l: k.l.slice(), c: k.c.slice(), v: k.v.slice(), live: k.live, bo: k.bo, cat: k.cat });

/* Lọc nến rác.
   Dữ liệu thật của sàn có lúc lẫn nến hỏng: ô trống, chữ, giá 0, giá âm, râu vọt gấp trăm
   lần. Chỉ một cây như thế là thang giá phải kéo từ 0 tới 60000, nến thật bẹp thành một
   vạch — nhìn đúng như mất biểu đồ. Phải chặn ngay ở đây, trước khi tới biểu đồ. */
function loc(rows) {
  const ok = [];
  let bo = 0, cat = 0;
  for (const r of rows) {
    const t = +r[0], o = +r[1], h = +r[2], l = +r[3], c = +r[4];
    const v = +r[5];
    if (![t, o, h, l, c].every(x => Number.isFinite(x)) || o <= 0 || h <= 0 || l <= 0 || c <= 0) { bo++; continue; }
    // Râu dài quá 3 lần thân gần như luôn là giá lỗi của sàn. Cắt râu, giữ nguyên thân,
    // để hình dạng nến vẫn đúng sự thật.
    const tren = Math.max(o, c), duoi = Math.min(o, c);
    let H = Math.max(h, tren), L = Math.min(l, duoi);
    if (H > tren * 3) { H = tren; cat++; }
    if (L < duoi / 3) { L = duoi; cat++; }
    ok.push([t, o, H, L, c, Number.isFinite(v) && v >= 0 ? v : 0, r[8]]);
  }
  return { ok, bo, cat };
}

export async function candles(sym, bar, limit = 300) {
  const key = sym + '|' + bar + '|' + limit, now = Date.now(), hit = KC.get(key);
  if (hit && now - hit.t < 15000) return chep(hit.d);
  const d = await api('/api/v5/market/candles', { instId: sym, bar, limit: String(limit) });
  if (!d.length) throw new Error('Không có dữ liệu nến');
  const { ok: rows, bo, cat } = loc(d.slice().reverse());
  if (rows.length < 20) throw new Error(`Dữ liệu nến hỏng (${d.length} cây, dùng được ${rows.length})`);
  const res = {
    t: rows.map(r => r[0]), o: rows.map(r => r[1]), h: rows.map(r => r[2]),
    l: rows.map(r => r[3]), c: rows.map(r => r[4]), v: rows.map(r => r[5]),
    live: rows.at(-1)[6] === '0',
    bo, cat,
  };
  if (KC.size > 400) KC.clear();
  KC.set(key, { t: now, d: res });
  return chep(res);
}
export const dropCandleCache = () => KC.clear();

/* Giá của cả sàn trong một lượt gọi — rẻ hơn hỏi từng đồng. */
export async function tickers() {
  const d = await api('/api/v5/market/tickers', { instType: 'SWAP' });
  const m = new Map();
  for (const x of d) if (x.instId.endsWith('-USDT-SWAP')) m.set(x.instId, { last: +x.last, open24h: +x.open24h, vol: (+x.volCcy24h || 0) * (+x.last || 0) });
  return m;
}

/* Chỉ tiền mã hoá: OKX xếp loại bằng instCategory ('1' crypto, '3' cổ phiếu,
   '4' hàng hoá). Có cặp không trả trường này nên chặn thêm bằng tên. */
const NOTCOIN = new Set(['XAU', 'XAG', 'XPT', 'XPD', 'CL', 'BZ', 'NG', 'HG', 'ZC', 'ZS', 'ZW',
  'NDX', 'DJI', 'VIX', 'US30', 'US500', 'NAS100', 'EURUSD', 'GBPUSD', 'USDJPY']);

let INSTR = null;
export async function instrumentMeta() {
  if (INSTR) return INSTR;
  try {
    const d = await api('/api/v5/public/instruments', { instType: 'SWAP' });
    INSTR = new Map(d.filter(x => x.instId.endsWith('-USDT-SWAP'))
      .map(x => [x.instId, { listTime: +x.listTime || 0, state: x.state, cat: String(x.instCategory || ''), tickSz: +x.tickSz || 0 }]));
  } catch (e) { INSTR = new Map(); }
  return INSTR;
}

export function isCoin(id, meta) {
  const base = id.split('-')[0];
  if (NOTCOIN.has(base)) return false;
  const m = meta && meta.get(id);
  if (m && m.cat && m.cat !== '1') return false;
  return true;
}

/* Top coin theo khối lượng USD 24 giờ. */
export async function topCoins(n = 70) {
  const [t, meta] = await Promise.all([tickers(), instrumentMeta()]);
  const out = [];
  for (const [id, x] of t) {
    const m = meta.get(id);
    if (m && m.state && m.state !== 'live') continue;
    if (!isCoin(id, meta)) continue;
    out.push({ id, base: id.split('-')[0], vol: x.vol, last: x.last, open24h: x.open24h, tickSz: m ? m.tickSz : 0 });
  }
  out.sort((a, b) => b.vol - a.vol);
  return out.slice(0, n);
}

/* Số chữ số sau dấu phẩy, suy từ bước giá của sàn hoặc từ độ lớn của giá. */
export function decimalsOf(tickSz, price) {
  if (tickSz > 0) {
    const s = tickSz.toExponential().split('e'), e = +s[1];
    return Math.max(0, Math.min(8, e < 0 ? -e : 0));
  }
  const p = Math.abs(price || 1);
  if (p >= 1000) return 1;
  if (p >= 10) return 3;
  if (p >= 1) return 4;
  if (p >= 0.01) return 5;
  if (p >= 0.0001) return 6;
  return 8;
}

export function fmtPrice(p, dec) {
  if (!Number.isFinite(p)) return '—';
  const d = dec != null ? dec : decimalsOf(0, p);
  return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export const fmtUsd = v =>
  v >= 1e9 ? (v / 1e9).toFixed(1) + ' tỉ' :
  v >= 1e6 ? (v / 1e6).toFixed(0) + ' tr' :
  v >= 1e3 ? (v / 1e3).toFixed(0) + ' k' : String(Math.round(v));
