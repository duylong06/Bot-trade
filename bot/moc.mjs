// bot/moc.mjs — canh "mốc" (đường bạn kẻ trong app) và tự tìm đồng sắp phá trendline.
//
// Hai việc mỗi lượt chạy:
//   1. Rút lệnh app gửi qua ntfy (thêm mốc / xoá mốc) rồi ghi vào out/moc.json.
//      Nhánh data mới là nơi lưu thật; ntfy chỉ là đường đi, tin tự hết hạn sau 12 giờ.
//   2. Kiểm từng mốc đang canh trên nến M30 ĐÃ ĐÓNG. Đúng điều kiện thì đẩy thông báo
//      về iPhone rồi tắt mốc đó (báo một lần, không báo lặp).
//   3. Quét top đồng OKX bằng core/breakout.js, tìm đường còn sống mà giá đang áp sát,
//      ghi ra out/sap-pha.json cho tab "Bot vẽ".
//
// Biến môi trường:
//   PUSH_CONFIG  khoá thông báo — GitHub Secret
//   NTFY_TOPIC   hộp thư giữa app và bot (mặc định botrade-duylong06-moc-7k3x9q)
//   MODE         scan (mặc định) · dry-run (không gửi, không ghi)
//   SCAN_N       số đồng quét tìm sắp phá (mặc định 60)

import fs from 'node:fs';
import { analyze, fromRows, lineAt } from '../core/breakout.js';
import { parseSecret, devices, send } from './push.mjs';

const API = 'https://www.okx.com';
const DATA = 'https://raw.githubusercontent.com/duylong06/Bot-trade/data/';
const TOPIC = process.env.NTFY_TOPIC || 'botrade-duylong06-moc-7k3x9q';
const NTFY = 'https://ntfy.sh/' + TOPIC;
const MODE = process.env.MODE || 'scan';
const DRY = MODE === 'dry-run';
const SCAN_N = +(process.env.SCAN_N || 60);
const NEAR = 1.5;                      // coi là "sắp phá" khi giá cách đường dưới 1,5%

const log = (...a) => console.log(...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const vn = t => new Date(t + 7 * 3600e3).toISOString().slice(5, 16).replace('T', ' ');
const fmt = p => !Number.isFinite(p) ? '—'
  : p >= 1000 ? p.toFixed(0) : p >= 10 ? p.toFixed(2) : p >= 1 ? p.toFixed(3)
  : p >= 0.01 ? p.toFixed(5) : p.toPrecision(4);

/* ---------------- OKX ---------------- */
async function okx(path, q, tries = 3) {
  const u = API + path + '?' + new URLSearchParams(q);
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const j = await r.json();
      if (j.code === '0') return j.data;
    } catch (e) {}
    await sleep(700);
  }
  return null;
}

/** Nến đã đóng, cũ → mới. Cột 9 = '1' là nến đã chốt. */
async function closedCandles(inst, bar, limit = 300) {
  const d = await okx('/api/v5/market/candles', { instId: inst, bar, limit: String(limit) });
  if (!d || !d.length) return null;
  const rows = d.filter(r => r[8] === '1').map(r => r.map(Number)).sort((a, b) => a[0] - b[0]);
  return rows.length ? rows : null;
}

async function topList(n) {
  const [t, inst] = await Promise.all([
    okx('/api/v5/market/tickers', { instType: 'SWAP' }),
    okx('/api/v5/public/instruments', { instType: 'SWAP' }),
  ]);
  if (!t) return [];
  const meta = new Map((inst || []).map(x => [x.instId, x]));
  const NOT = new Set(['XAU', 'XAG', 'XPT', 'XPD', 'CL', 'BZ', 'NG', 'HG', 'ZC', 'ZS', 'ZW', 'NDX', 'DJI', 'VIX', 'US30', 'US500', 'NAS100']);
  return t.filter(x => x.instId.endsWith('-USDT-SWAP'))
    .filter(x => { const m = meta.get(x.instId); return !m || !m.state || m.state === 'live'; })
    .filter(x => { const m = meta.get(x.instId), b = x.instId.split('-')[0];
      if (NOT.has(b)) return false;
      return !(m && m.instCategory && String(m.instCategory) !== '1'); })
    .map(x => ({ id: x.instId, base: x.instId.split('-')[0], vol: (+x.volCcy24h || 0) * (+x.last || 0), last: +x.last }))
    .sort((a, b) => b.vol - a.vol).slice(0, n);
}

/* ---------------- trạng thái ---------------- */
async function loadMoc() {
  try {
    if (fs.existsSync('out/moc.json')) return JSON.parse(fs.readFileSync('out/moc.json', 'utf8'));
  } catch (e) {}
  try {
    const r = await fetch(DATA + 'moc.json', { cache: 'no-store' });
    if (r.ok) return await r.json();
  } catch (e) {}
  return { marks: [], seen: [], ntfySince: 0, ts: 0 };
}
async function loadKeoState() {
  try {
    if (fs.existsSync('out/state-keo.json')) return JSON.parse(fs.readFileSync('out/state-keo.json', 'utf8'));
  } catch (e) {}
  try {
    const r = await fetch(DATA + 'state-keo.json', { cache: 'no-store' });
    if (r.ok) return await r.json();
  } catch (e) {}
  return {};
}

/* ---------------- rút lệnh từ hộp thư ---------------- */
// ntfy trả tin không theo thứ tự, nên gom hết rồi sắp theo giờ trước khi áp dụng.
async function intake(S) {
  S.marks ||= []; S.seen ||= [];
  const since = S.ntfySince ? String(S.ntfySince + 1) : 'all';
  let txt = '';
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 10000);
    const r = await fetch(`${NTFY}/json?poll=1&since=${since}`, { signal: ctl.signal }).finally(() => clearTimeout(tm));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    txt = await r.text();
  } catch (e) { log('  hộp thư:', e.message); return 0; }

  const cmds = [];
  for (const line of txt.split('\n')) {
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.event !== 'message') continue;
    S.ntfySince = Math.max(S.ntfySince || 0, m.time || 0);
    let j; try { j = JSON.parse(m.message); } catch { continue; }
    if (!j || !j.act || !j.id) continue;
    cmds.push(j);
  }
  cmds.sort((a, b) => (a.at || 0) - (b.at || 0));

  const seen = new Set(S.seen);
  let n = 0;
  for (const c of cmds) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    if (c.act === 'add' && c.mark && c.mark.sym && Number.isFinite(c.mark.pa) && Number.isFinite(c.mark.pb)) {
      const m = c.mark;
      if (!/^[A-Z0-9]{1,15}-USDT-SWAP$/.test(m.sym)) continue;
      if (!S.marks.some(x => x.id === m.id)) {
        S.marks.push({
          id: String(m.id).slice(0, 40), sym: m.sym, base: m.sym.split('-')[0],
          tf: String(m.tf || '1H').slice(0, 8),
          ta: +m.ta, pa: +m.pa, tb: +m.tb, pb: +m.pb,
          dir: m.dir === 'up' ? 'up' : 'down',
          mode: m.mode === 'touch' ? 'touch' : 'close',
          state: 'on', at: +m.at || Date.now(),
        });
        n++;
      }
    } else if (c.act === 'del' && c.markId) {
      S.marks = S.marks.filter(x => x.id !== c.markId);
      n++;
    }
  }
  S.seen = [...seen].slice(-500);
  // chỉ giữ 40 mốc gần nhất, và bỏ mốc đã báo quá 7 ngày
  const cut = Date.now() - 7 * 864e5;
  S.marks = S.marks.filter(m => m.state !== 'done' || (m.firedAt || 0) > cut).slice(-40);
  if (n) log(`  nhận ${n} lệnh mới từ app`);
  return n;
}

/* ---------------- canh mốc ---------------- */
// Giá của đường tại thời điểm t: nối thẳng hai điểm neo rồi kéo dài.
const priceOn = (m, t) => m.pa + (m.pb - m.pa) * (t - m.ta) / ((m.tb - m.ta) || 1);

async function checkMarks(S) {
  const live = S.marks.filter(m => m.state === 'on');
  if (!live.length) { log('không có mốc nào đang canh'); return; }
  log(`canh ${live.length} mốc`);

  const bySym = new Map();
  for (const m of live) {
    if (!bySym.has(m.sym)) bySym.set(m.sym, []);
    bySym.get(m.sym).push(m);
  }

  for (const [sym, ms] of bySym) {
    const rows = await closedCandles(sym, '30m', 60);
    if (!rows) { log(`  ${sym}: không lấy được nến M30`); continue; }
    const last = rows.at(-1);
    const [t, , hi, lo, close] = last;
    const tClose = t + 18e5;                       // nến M30 đóng ở cuối khoảng

    for (const m of ms) {
      const lp = priceOn(m, tClose);
      if (!Number.isFinite(lp) || lp <= 0) continue;
      const hit = m.mode === 'close'
        ? (m.dir === 'down' ? close < lp : close > lp)
        : (m.dir === 'down' ? lo <= lp : hi >= lp);
      log(`  ${m.base} ${m.dir}/${m.mode}: nến ${vn(t)} đóng ${fmt(close)} · đường ${fmt(lp)} → ${hit ? 'BÁO' : 'chưa'}`);
      if (!hit) continue;

      const huong = m.dir === 'down' ? 'xuống dưới' : 'lên trên';
      const kieu = m.mode === 'close' ? `Nến M30 đóng lúc ${vn(tClose)} ở ${fmt(close)}` : `Giá chạm đường, ${fmt(close)}`;
      const body = [
        `${m.base} phá ${huong} đường bạn kẻ.`,
        '',
        `${kieu}, đường đang ở ${fmt(lp)}.`,
        `Lệch ${((close - lp) / lp * 100).toFixed(2)}%.`,
        '',
        `Đường neo ${fmt(m.pa)} (${vn(m.ta)}) → ${fmt(m.pb)} (${vn(m.tb)}), bạn kẻ trên khung ${m.tf}.`,
        `Mốc này đã tắt, sẽ không báo lại.`,
      ].join('\n');
      await send(PUSHERS, `${m.base} phá ${huong} trendline`, body, 'moc-' + m.id, DRY);
      if (!DRY) { m.state = 'done'; m.firedAt = tClose; m.firedPx = close; m.firedLine = lp; }
    }
  }
}

/* ---------------- tìm đồng sắp phá ---------------- */
async function scanNear(list) {
  const out = [];
  const TFS = [{ bar: '1H', label: '1H' }, { bar: '4H', label: '4H' }];
  let done = 0;
  for (const c of list) {
    for (const tf of TFS) {
      const rows = await closedCandles(c.id, tf.bar, 300);
      if (!rows || rows.length < 120) continue;
      let R;
      try { R = analyze(fromRows(rows), tf.bar); } catch (e) { continue; }
      const price = rows.at(-1)[4];
      for (const L of R.lines || []) {
        if (L.tBreak) continue;                       // đã phá rồi thì thôi
        if ((L.touches || 0) < 2) continue;
        if (L.range) continue;                        // biên đi ngang, không phải trendline
        const lp = lineAt(L, rows.at(-1)[0]);
        if (!Number.isFinite(lp) || lp <= 0) continue;
        const d = Math.abs(price - lp) / lp * 100;
        if (d > NEAR) continue;
        // kháng cự phải nằm TRÊN giá, hỗ trợ phải nằm DƯỚI giá
        if (L.side === 'R' && lp < price) continue;
        if (L.side === 'S' && lp > price) continue;
        out.push({
          sym: c.id, base: c.base, tf: tf.label, side: L.side,
          touches: L.touches, span: L.span, price, linePx: lp, distPct: d,
          line: { ta: L.ta, pa: L.pa, tb: L.tb, pb: L.pb },
        });
      }
    }
    if (++done % 15 === 0) log(`  quét ${done}/${list.length}`);
  }
  // mỗi đồng giữ một đường gần nhất
  const best = new Map();
  for (const x of out) {
    const k = x.sym + '|' + x.tf;
    if (!best.has(k) || x.distPct < best.get(k).distPct) best.set(k, x);
  }
  return [...best.values()].sort((a, b) => a.distPct - b.distPct).slice(0, 25);
}

/* ---------------- chạy ---------------- */
fs.mkdirSync('out', { recursive: true });
const S = await loadMoc();
const keoState = await loadKeoState();
const PUSHERS = devices(parseSecret(process.env.PUSH_CONFIG), keoState);
log(`moc.mjs — ${vn(Date.now())} · ${PUSHERS.length} máy nhận · hộp thư ${TOPIC}`);

// Mốc được canh TRƯỚC khi quét tìm đồng sắp phá: canh mốc là việc gấp, quét là việc tham khảo.
await intake(S);
await checkMarks(S);

// Quét có lỗi cũng không được làm mất kết quả canh mốc ở trên.
let near = null;
try {
  const list = await topList(SCAN_N);
  log(`tìm đồng sắp phá trong top ${list.length} đồng…`);
  near = await scanNear(list);
  log(`→ ${near.length} đồng áp sát đường`);
  for (const x of near.slice(0, 8)) log(`  ${x.base} ${x.tf} ${x.side === 'R' ? 'kháng cự' : 'hỗ trợ'} cách ${x.distPct.toFixed(2)}%`);
} catch (e) { log('quét sắp phá lỗi, bỏ qua lượt này:', e.message); }

S.ts = Date.now();
if (!DRY) {
  fs.writeFileSync('out/moc.json', JSON.stringify(S));
  if (near) fs.writeFileSync('out/sap-pha.json', JSON.stringify({ ts: Date.now(), items: near }));
  log('đã ghi out/moc.json' + (near ? ' và out/sap-pha.json' : ''));
} else log('dry-run: không ghi gì');
