// bot/scan.mjs — quét top 67 đồng theo vốn hoá + vàng + dầu, phát hiện phá vỡ trendline trên nến H1,
// gửi thông báo về iPhone.
//
// Chạy trên GitHub Actions (.github/workflows/scan.yml). Dữ liệu giữa các lần chạy nằm ở thư mục
// OUT_DIR (mặc định "out"), được workflow lấy từ / đẩy lên nhánh "data" của repo.
//
// MODE:
//   scan       quét và gửi thông báo (mặc định)
//   dry-run    quét thử 48 giờ gần nhất, KHÔNG gửi — chỉ ghi báo cáo dryrun.json
//   test-push  chỉ gửi một thông báo thử tới mọi thiết bị
//
// STAGE (chỉ với MODE=scan) — một lượt chạy mỗi giờ gồm hai bước:
//   h1   nến H1 vừa đóng: báo RETEST / XÁC NHẬN ngay; cú PHÁ thì ghi lại, CHƯA báo.
//   m30  chờ cây M30 đầu tiên của giờ sau đóng (phút :30), xét luật M30 rồi mới báo PHÁ.
//   (bỏ trống = làm cả hai)
//
// Bí mật (GitHub Secrets):
//   PUSH_CONFIG  đoạn mã app tạo ra khi bấm "Bật thông báo" lần đầu (có khoá VAPID riêng của bot).
//   Sau đó, mỗi lần iPhone đăng ký lại, app tự gửi đăng ký mới qua kênh ntfy (core/config.js → NTFY);
//   bot nhận và dùng luôn khoá trong PUSH_CONFIG — không phải dán mã lại.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import webpush from 'web-push';
import { analyze, CFG, HOUR, lineAt } from '../core/breakout.js';
import { m30Verdict, m30CloseOf, M30 } from '../core/confirm.js';
import * as okx from '../core/okx.js';
import { PAGES_URL, TOP_N, TOP_VOL, PINNED, ALERTS, MIN_SPAN_ALERT, NTFY, EXCLUDE, CATEGORIES } from '../core/config.js';
import { hhmm, stamp, labelOf } from '../core/format.js';
import { buildMessage, plan } from './plan.mjs';
import { ranking } from './mcap.mjs';
import { scoreEvent, compactScore } from '../core/score.js';
import { liqMap } from '../core/liqmap.js';
import { marketContext, coinData, flowReport, flowAlerts } from './context.mjs';
import { openTrade, trackTrades } from './trades.mjs';

const MODE = process.env.MODE || 'scan';
const STAGE = MODE === 'scan' ? (process.env.STAGE || 'all') : MODE;
const TRIGGER = process.env.TRIGGER || 'local';
const OUT = process.env.OUT_DIR || 'out';
const WAIT_MAX = 9 * 60e3;          // chạy sớm tối đa 9 phút trước giờ đóng nến H1 thì ở lại chờ
const M30_WAIT_MAX = +(process.env.M30_WAIT_MAX ?? 36 * 60e3);   // bước m30: chờ cây M30 tối đa 36 phút
const M30_LATE = +(process.env.M30_LATE ?? 90 * 60e3);         // trễ quá 90 phút sau giờ đóng M30 (bot không chạy kịp) thì thôi không báo
const SETTLE = 1200;                // sau giờ đóng nến chờ thêm 1,2 giây cho OKX chốt nến
const SIGNAL_DAYS = 7;              // danh sách tín hiệu trong app giữ 7 ngày
const MARK_DAYS = Math.ceil(CFG.WINDOW / 24) + 1;   // dấu trên biểu đồ: phủ hết cửa sổ nến H1 (1000 nến ≈ 42 ngày)
const CONC = 6;

const t0 = Date.now();
const LOG = [];
const log = (...a) => { const s = `[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s] ` + a.join(' '); console.log(s); LOG.push(s); };
const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));
fs.mkdirSync(OUT, { recursive: true });
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')); } catch { return d; } };
const writeJSON = (f, v, pretty = true) => fs.writeFileSync(path.join(OUT, f), pretty ? JSON.stringify(v, null, 1) : JSON.stringify(v));
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
const H4 = 4 * HOUR;
const M30MS = 30 * 60e3;
const eventId = (instId, e) => `${instId}|${e.type}|${e.side}|${e.line.tBreak}` + (e.tf && e.tf !== '1H' ? '|' + e.tf : '');
const lastOf = a => a[a.length - 1];

const state = readJSON('state.json', {});
const prevStatus = readJSON('status.json', {});
state.sent ||= {}; state.devices ||= {}; state.pending ||= {}; state.follow ||= {}; state.subs ||= {}; state.dead ||= {};
state.trades ||= {}; state.flowSent ||= {};
for (const [id, at] of Object.entries(state.dead)) if (Date.now() - at > 30 * 24 * 3600e3) delete state.dead[id];
delete state.lastBreak;
const status = { version: 5, mode: MODE, stage: STAGE, trigger: TRIGGER, startedAt: t0,
  cfg: { window: CFG.WINDOW, top: TOP_N, topVol: TOP_VOL, pinned: PINNED, alerts: ALERTS, minPattern: CFG.MIN_PATTERN } };
const signals = readJSON('signals.json', []);
const changed = new Map();              // id → dòng tín hiệu thêm mới / đổi trong lượt này (để cập nhật dấu biểu đồ)

/* ---------------- máy nhận thông báo ---------------- */

function parseSecret(raw) {
  if (!raw || !raw.trim()) return [];
  let items = [];
  try { const j = JSON.parse(raw); items = Array.isArray(j) ? j : [j]; }
  catch { items = (raw.match(/\{[^\n]*\}/g) || []).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean); }
  return items.filter(x => x && x.sub && x.sub.endpoint && x.vapid && x.vapid.pub && x.vapid.priv)
    .map(x => ({ ...x, id: sha(x.sub.endpoint), src: 'secret' }));
}
const secret = parseSecret(process.env.PUSH_CONFIG);
const keys = new Map(secret.map(d => [d.vapid.pub, d.vapid]));       // khoá công khai → cặp khoá của bot
const botPub = secret.length ? secret[0].vapid.pub : null;
const PUSH_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)\//;
const pushHostOk = ep => PUSH_HOSTS.test(ep) || (!!process.env.PUSH_HOST_TEST && ep.startsWith(process.env.PUSH_HOST_TEST));

// App ký endpoint bằng khoá riêng trên máy (ECDSA P-256, chữ ký dạng r||s) → chứng minh đăng ký đến từ máy có khoá.
function verifySig(ep, pub, sig) {
  try {
    const raw = Buffer.from(pub, 'base64url');
    const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33, 65).toString('base64url') }, format: 'jwk' });
    return crypto.verify('sha256', Buffer.from(ep), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
  } catch { return false; }
}

// Đăng ký app tự gửi qua ntfy: chỉ nhận đăng ký dùng đúng khoá công khai của bot.
async function intakeRegistrations() {
  if (!keys.size || !NTFY) return;
  const since = state.ntfySince ? String(state.ntfySince + 1) : '24h';
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(`${NTFY}/json?poll=1&since=${since}`, { signal: ctl.signal }).finally(() => clearTimeout(tm));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    let n = 0;
    for (const line of (await r.text()).split('\n')) {
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.event !== 'message') continue;
      state.ntfySince = Math.max(state.ntfySince || 0, m.time || 0);
      let j; try { j = JSON.parse(m.message); } catch { continue; }
      const ep = j && j.sub && j.sub.endpoint;
      if (!ep || !pushHostOk(ep) || !j.sub.keys || !j.sub.keys.p256dh || !j.sub.keys.auth || !keys.has(j.pub)) continue;
      if (state.dead[sha(ep)]) continue;            // đăng ký đã bị Apple báo chết
      const signed = typeof j.sig === 'string' && verifySig(ep, j.pub, j.sig);
      state.subs[sha(ep)] = { sub: { endpoint: ep, keys: { p256dh: j.sub.keys.p256dh, auth: j.sub.keys.auth } }, pub: j.pub, name: String(j.name || 'iPhone').slice(0, 40), at: (m.time || 0) * 1000, signed };
      n++;
    }
    // giữ 8 đăng ký: có chữ ký trước, rồi mới nhất trước
    const ids = Object.keys(state.subs).sort((a, b) => (!!state.subs[b].signed - !!state.subs[a].signed) || state.subs[b].at - state.subs[a].at);
    for (const id of ids.slice(8)) delete state.subs[id];
    if (n) log(`Nhận ${n} đăng ký thông báo mới từ app`);
  } catch (e) { log('  ntfy:', e.message); }
}

function devices() {
  const out = new Map(secret.filter(d => !state.dead[d.id]).map(d => [d.id, d]));
  for (const [id, s] of Object.entries(state.subs)) {
    const v = keys.get(s.pub);
    if (v && !out.has(id) && !state.dead[id]) out.set(id, { id, name: s.name, sub: s.sub, vapid: v, src: 'app' });
  }
  return [...out.values()];
}

// Thông báo dạng "Declarative Web Push": iPhone (iOS 18.4+) tự hiện thông báo từ nội dung,
// không cần service worker — nên không bao giờ bị iOS coi là "push im lặng" rồi tự huỷ đăng ký.
function payloadOf(msg) {
  return JSON.stringify({
    web_push: 8030,
    notification: { title: msg.title, body: msg.body, navigate: new URL(msg.url || './', PAGES_URL).href, tag: msg.tag || undefined, lang: 'vi', silent: false },
  });
}

async function pushAll(msg, only = null) {
  const list = only || devices();
  const payload = payloadOf(msg);
  const res = await Promise.all(list.map(async d => {
    const rec = { at: Date.now(), name: d.name || '', src: d.src };
    try {
      const r = await webpush.sendNotification(d.sub, payload, {
        TTL: 3600, urgency: 'high',
        vapidDetails: { subject: PAGES_URL, publicKey: d.vapid.pub, privateKey: d.vapid.priv },
      });
      Object.assign(rec, { ok: true, status: r.statusCode });
    } catch (e) {
      Object.assign(rec, { ok: false, status: e.statusCode || 0, error: String(e.body || e.message).slice(0, 200) });
      if (e.statusCode === 404 || e.statusCode === 410) {                    // máy đã huỷ đăng ký / hết hạn
        rec.gone = true;
        state.dead[d.id] = Date.now();                   // đăng ký đã chết: thôi gửi, app sẽ tự đăng ký lại
        if (d.src === 'app') delete state.subs[d.id];
      }
    }
    state.devices[d.id] = rec;
    return rec;
  }));
  const okN = res.filter(r => r.ok).length;
  log(`  → gửi ${okN}/${list.length} máy`, res.filter(r => !r.ok).map(r => `lỗi ${r.status} ${r.error || ''}`).join(' '));
  return okN;
}

/* ---------------- tiện ích ---------------- */

async function pool(items, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (i < items.length) {
      const it = items[i++];
      try { await fn(it); } catch (e) { log('  lỗi', it.instId || it.key || '', e.message); }
    }
  }));
}

function mergeClosed(K, rows, upTo) {
  // thay các nến từ upTo trở về sau bằng các nến đã chốt trong rows
  const keep = K.t.findIndex(t => t >= upTo);
  const cut = keep < 0 ? K.t.length : keep;
  const add = rows.filter(r => r[8] === '1' && +r[0] === upTo).map(r => r.map(Number));
  const out = { t: K.t.slice(0, cut), o: K.o.slice(0, cut), h: K.h.slice(0, cut), l: K.l.slice(0, cut), c: K.c.slice(0, cut), v: K.v.slice(0, cut) };
  for (const r of add) { out.t.push(r[0]); out.o.push(r[1]); out.h.push(r[2]); out.l.push(r[3]); out.c.push(r[4]); out.v.push(r[5]); }
  const n = out.t.length, from = Math.max(0, n - (CFG.WINDOW + CFG.WARMUP));
  for (const k of Object.keys(out)) out[k] = out[k].slice(from);
  return out;
}

// Danh sách theo dõi: top N theo vốn hoá có trên OKX + vàng, dầu. Lỗi nguồn vốn hoá → dùng bảng lần trước,
// không có cả bảng cũ → tạm xếp theo khối lượng như trước.
async function connectOkx() {
  okx.setThrottle(60);
  const { host, tried } = await okx.pickHost();
  status.host = host; if (tried.length) status.hostTried = tried;
  log('OKX:', host);
  const insts = await okx.instruments();
  const ticks = await okx.tickSizes(insts);
  const tickers = await okx.swapTickers(okx.allowedSet(insts));
  const byInst = new Map(tickers.map(x => [x.instId, x]));
  const crypto1 = new Set(insts.filter(x => !x.instCategory || CATEGORIES.includes(String(x.instCategory))).map(x => x.instId));

  let universe, src;
  const rank = await ranking(state.mcap, log);
  if (rank) {
    if (rank.fresh) state.mcap = { at: rank.at, src: rank.src, list: rank.list.slice(0, 400) };
    universe = [];
    for (const [k, c] of rank.list.entries()) {
      const instId = c.symbol + '-USDT-SWAP', tk = byInst.get(instId);
      if (!tk || PINNED.includes(instId) || EXCLUDE.includes(c.symbol) || !crypto1.has(instId)) continue;
      universe.push({ ...tk, rank: k + 1, mcap: c.mcap, name: c.name });
      if (universe.length >= TOP_N) break;
    }
    src = `vốn hoá ${rank.src}${rank.fresh ? '' : ' (bảng cũ ' + stamp(rank.at) + ')'}`;
  } else {
    universe = tickers.filter(x => !PINNED.includes(x.instId)).slice(0, TOP_N);
    src = 'khối lượng 24h (chưa lấy được vốn hoá)';
  }
  // + top TOP_VOL theo khối lượng giao dịch 24h trên OKX (chưa có trong danh sách vốn hoá)
  const have = new Set(universe.map(u => u.instId));
  let addVol = 0;
  for (const [k, tk] of tickers.entries()) {
    if (k >= TOP_VOL) break;
    if (have.has(tk.instId) || PINNED.includes(tk.instId) || !crypto1.has(tk.instId)) continue;
    universe.push({ ...tk, volRank: k + 1 }); have.add(tk.instId); addVol++;
  }
  if (rank) src += ` + top ${TOP_VOL} khối lượng OKX (thêm ${addVol})`;
  const pins = PINNED.map(id => byInst.get(id)).filter(Boolean);
  universe.push(...pins.map(p => ({ ...p, pinned: true })));
  status.universe = { src, n: universe.length };
  writeJSON('top.json', { at: Date.now(), src, list: universe.map(u => ({ instId: u.instId, coin: u.coin, rank: u.rank || null, volRank: u.volRank || null, mcap: u.mcap || null, name: u.name || null, pinned: !!u.pinned, volUsd: Math.round(u.volUsd), last: u.last, chg: +u.chg.toFixed(5) })) });
  log(`Theo dõi ${universe.length} mã theo ${src}: ${universe.filter(u => !u.pinned).slice(0, 12).map(u => u.coin).join(' ')} …` +
    (pins.length ? ` + ${pins.map(u => labelOf(u.coin)).join(', ')}` : ''));
  for (const u of universe) UNI.set(u.instId, u);
  for (const x of insts) CTVAL[x.instId] = +x.ctVal || null;
  startMarket();                    // tải bối cảnh thị trường song song (BTC.D/USDT.D, tin FED, ví on-chain, whale alert)
  return { ticks, universe };
}

// Bước M30 chạy trong tiến trình riêng: lấy lại danh sách đồng của bước H1 (top.json) thay vì xếp hạng lại.
async function m30Universe() {
  const top = readJSON('top.json', null);
  if (!top || !top.list || !top.list.length || Date.now() - top.at > 3 * HOUR) return connectOkx();
  okx.setThrottle(60);
  if (!status.host) { const { host } = await okx.pickHost(); status.host = host; }
  const insts = await okx.instruments();
  const ticks = await okx.tickSizes(insts);
  const tickers = await okx.swapTickers(okx.allowedSet(insts));
  const byInst = new Map(tickers.map(x => [x.instId, x]));
  const universe = top.list.filter(x => byInst.has(x.instId)).map(x => ({ ...x, ...byInst.get(x.instId) }));
  for (const u of universe) UNI.set(u.instId, u);
  for (const x of insts) CTVAL[x.instId] = +x.ctVal || null;
  return { ticks, universe };
}

/* ---------------- lớp chấm điểm (prompt V8.0) ---------------- */

const UNI = new Map();          // instId → thông tin đồng (giá, bid/ask, khối lượng 24h…) của lượt này
const CTVAL = {};               // instId → giá trị một hợp đồng (đơn vị coin)
let MKT = null, MKT_P = null;

function startMarket() {
  if (!MKT_P) {
    const b = UNI.get('BTC-USDT-SWAP');
    MKT_P = marketContext(state, { log, btcTicker: b ? { last: b.last, chg: b.chg } : null })
      .then(m => (MKT = m))
      .catch(e => { log('  bối cảnh thị trường lỗi:', e.message); return (MKT = { errors: [e.message], scenario: { id: 0, text: 'không lấy được dữ liệu' } }); });
  }
  return MKT_P;
}

/**
 * Chấm điểm /100 cho các sự kiện sắp báo: tải nến đa khung + OI + taker + sổ lệnh cho từng đồng, rồi scoreEvent.
 * haveFn(instId) → { '1H': K, '4H': K, '30m': K } nến đã có sẵn trong lượt (khỏi tải lại).
 * Gắn e.sc (bản gọn, lưu vào signals.json + soạn thông báo) và e._score (bản đầy đủ, mở lệnh theo dõi).
 */
async function scoreAll(events, haveFn = () => ({}), asOfFn = () => Date.now()) {
  if (!events.length) return;
  const t1 = Date.now();
  const M = await startMarket();
  const ids = [...new Set(events.map(e => e.instId))];
  const Ds = {};
  await pool(ids.map(instId => ({ instId })), async ({ instId }) => {
    const u = UNI.get(instId) || { instId, coin: instId.split('-')[0] };
    const have = {};
    for (const [k, v] of Object.entries(haveFn(instId) || {})) if (v && v.c && v.c.length) have[k] = v;
    Ds[instId] = await coinData(u, { have, ctVal: CTVAL[instId] || null, log });
    Ds[instId].btc = M.btc || {};
  });
  for (const e of events) {
    try {
      const r = scoreEvent(e, Ds[e.instId] || { coin: e.coin, K: {} }, M, asOfFn(e));
      e._score = r; e.sc = compactScore(r);
    } catch (err) { e.sc = { err: String(err.message || err).slice(0, 80) }; log(`  chấm điểm ${e.coin} lỗi:`, err.stack || err.message); }
    if (e.sc && e.sc.s != null) log(`  điểm ${e.coin} ${e.type} ${e.dir} ${e.tf || '1H'}: ${e.sc.s}/100 hạng ${e.sc.g}${e.sc.in ? ' → KÈO VÀO' : ''}${(e.sc.f || []).length ? ' · cờ đỏ: ' + e.sc.f.join(' | ') : ''}${(e.sc.k || []).length ? ' · khoá: ' + e.sc.k.join(' | ') : ''}`);
  }
  status.scoreMs = (status.scoreMs || 0) + (Date.now() - t1);
}

// Kèo S+/S++ không cờ đỏ: mở theo dõi sau khi báo (Tầng Hậu Kiểm).
function openTrades(events) {
  for (const e of events) if (e._score && e.sc && e.sc.in && (e._pu || MODE === 'scan')) openTrade(state, e, e._score);
}

// Thông báo dòng tiền: báo cáo 07:00 · 15:00 · 23:00 và cảnh báo tức thì (stablecoin / BTC vào–ra sàn, quét thanh lý lớn).
async function marketPushes(closeAt) {
  const M = await startMarket();
  const list = devices();
  const msgs = [];
  const vnHour = new Date(closeAt + 7 * HOUR).getUTCHours();
  if ([7, 15, 23].includes(vnHour)) msgs.push({ title: `📊 Báo cáo dòng tiền ${String(vnHour).padStart(2, '0')}:00`, body: flowReport(M), url: './#tab=markets', tag: 'flow-report' });
  for (const a of flowAlerts(M)) {
    if (state.flowSent[a.key] && Date.now() - state.flowSent[a.key] < 2 * HOUR) continue;
    state.flowSent[a.key] = Date.now();
    msgs.push({ title: a.title, body: a.body, url: './#tab=markets', tag: 'flow|' + a.key });
  }
  // Bản đồ thanh lý BTC, ETH: vừa quét cụm thanh lý lớn ở nến H1 vừa đóng
  for (const instId of ['BTC-USDT-SWAP', 'ETH-USDT-SWAP']) {
    try {
      const K = (await okx.candles(instId, '1H', 200)).K;
      const a = await okx.api('/api/v5/rubik/stat/contracts/open-interest-history', { instId, period: '1H', limit: '100' });
      const oi = a.map(r => [+r[0], +r[3]]).sort((x, y) => x[0] - y[0]);
      const lm = liqMap(K, oi, 72);
      const coin = instId.split('-')[0];
      for (const [hit, side] of [[lm.sweptLong, 'LONG'], [lm.sweptShort, 'SHORT']]) {
        const key = `liq|${coin}|${side}|${lastOf(K.t)}`;
        if (!hit || state.flowSent[key]) continue;
        state.flowSent[key] = Date.now();
        msgs.push({ title: `💥 Vừa quét cụm thanh lý ${side} lớn · ${coin}`, body: `Nến H1 ${hhmm(lastOf(K.t))} quét cụm thanh lý ${side} ước tính ~${(lm.sweptUsd / 1e6).toFixed(0)}M$. Lệnh ép ${side === 'LONG' ? 'bán' : 'mua'} đã cạn — giá dễ chững lại và đảo chiều nếu có CHoCH + Dual Stoch cắt ngược lại.`, url: './#' + new URLSearchParams({ s: instId }).toString(), tag: key });
      }
    } catch (e) { log('  bản đồ thanh lý', instId, e.message); }
  }
  for (const [k, v] of Object.entries(state.flowSent)) if (Date.now() - v > 3 * 24 * HOUR) delete state.flowSent[k];
  for (const m of msgs) { log(`${m.title} — ${m.body.replace(/\n/g, ' / ')}`); if (list.length) await pushAll(m); }
  status.marketPushes = msgs.length;
}

function marketSummary() {
  const M = MKT;
  if (!M) return prevStatus.market || null;
  const f = M.flow || {};
  return {
    at: M.at, dom: M.dom, scenario: M.scenario, blackout: M.blackout, nextRed: M.nextRed, totalVsBtc: M.totalVsBtc,
    flow: { bias: f.bias, s28c: f.s28c, tron: f.tron, btcEx: f.btcEx, stable24hWallet: f.stable24hWallet, stable7dWallet: f.stable7dWallet, stableIn24: f.stableIn24, mint24: f.mint24, btcEx24: f.btcEx24, btcIn2h: f.btcIn2h, btcOut2h: f.btcOut2h },
    whale: Object.entries(M.whale || {}).map(([c, o]) => ({ c, in24: Math.round(o.in24), out24: Math.round(o.out24) })).filter(x => x.in24 + x.out24 >= 25e6).sort((a, b) => (b.in24 + b.out24) - (a.in24 + a.out24)).slice(0, 12),
    insight: Object.entries(M.insight || {}).map(([c, o]) => ({ c, t: o.t, text: o.text.slice(0, 160) })),
    report: flowReport(M), errors: M.errors || [],
  };
}

/* ---------------- lưu tín hiệu cho app ---------------- */

const puOf = s => s.pu ?? (s.pushed > 0 ? 1 : 0);
const P8 = x => (typeof x === 'number' && isFinite(x) ? +x.toPrecision(8) : x);
function slim(s) {
  const { f, p, ev, o, h, r24, r72, now, mfe, mae, ...x } = s;   // bỏ các trường của bản "ghi nhớ" cũ
  for (const k of ['close', 'linePrice', 'level']) x[k] = P8(x[k]);
  if (x.line) { x.line = { ...x.line }; for (const k of ['pa', 'pb', 'mPerH', 'level']) x.line[k] = P8(x.line[k]); }
  if (x.pu == null) x.pu = puOf(x);
  return x;
}

function rowOf(e, extra = {}) {
  return {
    id: e._key, instId: e.instId, coin: e.coin, type: e.type, dir: e.dir, side: e.side,
    t: e.t, close: e.close, atr: +e.atr.toPrecision(6), linePrice: e.linePrice, level: e.level, confirmed: e.confirmed,
    others: e.others, tickSz: e.tickSz, line: e.line, bar: e.bar, tf: e.tf || '1H', cls: e.cls || null, vol: typeof e.vol === 'number' ? +e.vol.toFixed(2) : null,
    sc: e.sc || null, sentAt: Date.now(), pushed: 0, pu: 0, why: null, ...extra,
  };
}
const findRow = id => signals.find(s => s.id === id);
function upsert(row) {
  const old = findRow(row.id);
  if (old) Object.assign(old, row); else signals.unshift(row);
  changed.set(row.id, findRow(row.id));
}

/**
 * signals.json: danh sách tín hiệu 7 ngày cho tab Tín hiệu.
 * marks.json:   dấu trên biểu đồ (cả cửa sổ nến H1) — tín hiệu nào bot đã đẩy về máy (mũi tên đậm)
 *               hay không (mờ). Gọn theo từng đồng: { instId: [[loại|cạnh|giờ phá, đã đẩy], …] }
 */
function saveSignals() {
  const keepFrom = Date.now() - SIGNAL_DAYS * 24 * HOUR;
  writeJSON('signals.json', signals.filter(s => s.t >= keepFrom).sort((a, b) => b.t - a.t).slice(0, 1500).map(slim), false);
  const old = readJSON('marks.json', { m: {} });
  const m = new Map();
  for (const [inst, arr] of Object.entries(old.m || {})) for (const [suf, pu] of arr) m.set(inst + '|' + suf, pu);
  for (const s of changed.values()) m.set(s.id, s.pu);
  const from = Date.now() - (MARK_DAYS + 5) * 24 * HOUR, out = {};
  for (const [id, pu] of m) {
    const parts = id.split('|'), tBreak = +parts[3];
    if (!(tBreak >= from)) continue;
    (out[parts[0]] ||= []).push([parts.slice(1).join('|'), pu]);
  }
  writeJSON('marks.json', { v: 2, from, m: out }, false);
}

function finish(extra = {}) {
  Object.assign(status, extra, { finishedAt: Date.now() });
  const live = new Set(devices().map(d => d.id));
  for (const id of Object.keys(state.devices)) if (!live.has(id)) delete state.devices[id];
  status.devices = Object.entries(state.devices).map(([id, r]) => ({ id, ...r }));
  const all = devices();
  status.push = { configured: all.length, ids: all.map(d => d.id), dead: Object.keys(state.dead), vapidPub: botPub, ntfy: NTFY, fromApp: all.filter(d => d.src === 'app').length };
  status.pending = Object.values(state.pending).map(p => ({ coin: p.coin, dir: p.dir, t: p.t, m30Close: p.m30Close }));
  status.following = Object.values(state.follow).map(f => ({ coin: f.coin, dir: f.dir, tf: f.tf, t: f.t, at: f.tNext + (f.tf === '4H' ? H4 : f.tf === '30m' ? M30MS : HOUR) }));
  status.market = marketSummary();
  status.trades = Object.values(state.trades || {}).map(T => ({ id: T.id, instId: T.instId, coin: T.coin, dir: T.dir, tf: T.tf, grade: T.grade, score: T.score, style: T.style, entry: T.entry, sl: T.sl, sl0: T.sl0, tp1: T.tp1, tp2: T.tp2, t0: T.t0, stage: T.stage, best: +(T.best || 0).toFixed(2), tickSz: T.tickSz }));
  status.tradeLog = (state.tradeLog || []).slice(0, 30);
  if (!status.m30lines && prevStatus.m30lines) status.m30lines = prevStatus.m30lines;
  // giữ lại thông tin lần quét H1 thật gần nhất để app hiển thị
  if (MODE === 'scan' && status.h1Done) status.lastScan = {
    at: status.finishedAt, target: status.target, closeAt: status.closeAt, trigger: TRIGGER, host: status.host,
    readyAfterCloseMs: status.readyAfterCloseMs, pushDoneAfterCloseMs: status.pushDoneAfterCloseMs,
    counts: status.counts, signals: status.signals, pushes: status.pushes, sent: status.sent, skipped: status.skipped, waiting: status.waiting, followN: status.followN,
    universe: status.universe,
  };
  else if (prevStatus.lastScan) status.lastScan = prevStatus.lastScan;
  if (!status.m30 && prevStatus.m30) status.m30 = prevStatus.m30;
  writeJSON(MODE === 'dry-run' ? 'dryrun-status.json' : 'status.json', status);
  const drop = ['journal.json', 'model.json', 'stats.json', 'top50.json'];
  if (MODE !== 'dry-run') drop.push('dryrun-candles.json', 'dryrun-instruments.json');
  for (const f of drop) fs.rmSync(path.join(OUT, f), { force: true });
  if (MODE !== 'dry-run') writeJSON('state.json', state);
  const logName = MODE === 'dry-run' ? 'dryrun.log' : STAGE === 'm30' ? 'm30.log' : 'last.log';
  fs.writeFileSync(path.join(OUT, logName), LOG.join('\n') + '\n');
}

async function sendAll(events) {
  const batches = plan(events);
  let sentN = 0;
  for (const b of batches) log(`${b.msg.title} — ${b.msg.body.replace(/\n/g, ' / ')}`);
  const list = devices();
  await pool(batches, async b => {
    const okN = list.length ? await pushAll(b.msg) : 0;
    if (okN) sentN++;
    for (const e of b.events) { e._pu = list.length ? 1 : 0; e._okN = okN; }
  });
  if (!list.length && events.length) log('Chưa có máy nào nhận thông báo — tín hiệu chỉ được lưu, không gửi.');
  return { sentN, batches: batches.length };
}

/* ---------------- bước 1: nến H1 ---------------- */

async function stageH1() {
  const now = Date.now();
  const curOpen = Math.floor(now / HOUR) * HOUR;   // giờ mở của nến đang chạy
  const lastClosed = curOpen - HOUR;
  let target, waitUntil = 0;
  if (MODE === 'dry-run') target = lastClosed;
  else if (!state.lastCandle || state.lastCandle < lastClosed) target = lastClosed;
  else if (curOpen + HOUR - now <= WAIT_MAX) { target = curOpen; waitUntil = curOpen + HOUR + SETTLE; }
  else {
    log(`Nến ${hhmm(lastClosed)} đã quét. Còn ${Math.round((curOpen + HOUR - now) / 60e3)} phút mới tới nến mới.`);
    status.result = 'nothing-to-do'; status.target = lastClosed;
    return;
  }
  status.target = target; status.closeAt = target + HOUR;
  log(`Nến cần xử lý: H1 ${stamp(target)} (đóng lúc ${hhmm(target + HOUR)})${waitUntil ? ' — sẽ chờ tới lúc đóng' : ''}`);

  const { ticks, universe } = await connectOkx();

  // Khung H4: chỉ xét khi cây H1 này đóng đúng lúc một cây H4 đóng (mỗi 4 giờ: 03, 07, 11, 15, 19, 23 giờ VN).
  const closeAt = target + HOUR;
  const h4Due = MODE === 'dry-run' || closeAt % H4 === 0;

  // ----- tải trước nến mỗi đồng: WINDOW + WARMUP nến H1 (và H4 nếu tới giờ) -----
  const data = {}, data4 = {}, data30 = {};
  await pool(universe, async u => {
    data[u.instId] = (await okx.candles(u.instId, '1H', CFG.WINDOW + CFG.WARMUP)).K;
    if (h4Due) data4[u.instId] = (await okx.candles(u.instId, '4H', CFG.WINDOW + CFG.WARMUP)).K;
    data30[u.instId] = (await okx.candles(u.instId, '30m', M30N)).K;          // trendline M30 (≤ 60 nến) + nến 2 xác nhận
  });
  status.prefetchMs = Date.now() - t0;
  log(`Đã tải ${Object.keys(data).length} đồng${h4Due ? ' (cả nến H4)' : ''}`);

  if (waitUntil) {
    const w = waitUntil - Date.now();
    log(`Chờ ${(w / 1000).toFixed(0)} giây tới lúc nến đóng…`);
    await sleep(w);
    status.waitedMs = Math.max(0, w);
  }
  // ----- chốt cây nến cần xử lý cho những đồng chưa có (vừa đóng, hoặc OKX chốt chậm) -----
  const need = universe.filter(u => data[u.instId] && data[u.instId].t[data[u.instId].t.length - 1] !== target);
  if (need.length) {
    let missing = 0;
    await pool(need, async u => {
      for (let k = 0; k < 15; k++) {
        const rows = await okx.latest(u.instId, '1H', 2);
        const row = rows.find(r => +r[0] === target);
        if (row && row[8] === '1') { data[u.instId] = mergeClosed(data[u.instId], rows, target); return; }
        await sleep(600);
      }
      missing++;
    });
    log(`Chốt nến vừa đóng: ${need.length - missing}/${need.length} đồng`);
  }
  // Cây H4 vừa đóng: ghép từ 4 cây H1 của nó (giống hệt nến H4 của OKX), khỏi phải hỏi lại OKX.
  if (h4Due && MODE !== 'dry-run') for (const u of universe) {
    const K4 = data4[u.instId], K = data[u.instId];
    if (!K4 || !K) continue;
    const o4 = closeAt - H4;
    if (K4.t[K4.t.length - 1] >= o4) continue;
    const idx = []; for (let i = K.t.length - 1; i >= 0 && K.t[i] >= o4; i--) idx.unshift(i);
    if (idx.length !== 4 || K.t[idx[0]] !== o4) continue;
    K4.t.push(o4); K4.o.push(K.o[idx[0]]); K4.c.push(K.c[idx[3]]);
    K4.h.push(Math.max(...idx.map(i => K.h[i]))); K4.l.push(Math.min(...idx.map(i => K.l[i]))); K4.v.push(idx.reduce((s, i) => s + K.v[i], 0));
  }
  const readyAt = Date.now();
  status.readyAfterCloseMs = readyAt - (target + HOUR);

  // ----- phân tích -----
  // Chỉ báo sự kiện của CÂY VỪA ĐÓNG (báo đúng lúc, không báo bù tín hiệu cũ). Chạy thử: 48 giờ.
  const since = MODE === 'dry-run' ? target - 48 * HOUR : target - 1;
  const found = [], perCoin = [];
  let nLines = 0, nLines4 = 0;
  for (const u of universe) {
    const K = data[u.instId];
    if (!K || K.c.length < 100) continue;
    if (K.t[K.t.length - 1] !== target) { log(`  ${u.coin}: nến cuối ${stamp(K.t[K.t.length - 1])} ≠ ${stamp(target)} — bỏ qua`); continue; }
    const r = analyze(K, '1H');
    nLines += r.all.length;
    const ev = r.events.filter(e => e.t > since && e.t <= target);
    let ev4 = [];
    const K4 = data4[u.instId];
    if (h4Due && K4 && K4.c.length >= 100) {
      const r4 = analyze(K4, '4H');
      nLines4 += r4.all.length;
      const t4 = closeAt - H4;
      ev4 = r4.events.filter(e => MODE === 'dry-run' ? e.t > target - 48 * HOUR : e.t === t4);
    }
    perCoin.push({ coin: u.coin, lines: r.all.length, shown: r.lines.length, events: ev.length + ev4.length });
    for (const e of [...ev, ...ev4]) found.push({ ...e, instId: u.instId, coin: u.coin, tickSz: ticks[u.instId] });
  }
  status.analyzeMs = Date.now() - readyAt;
  status.counts = { coins: perCoin.length, lines: nLines, lines4: nLines4, events: found.length, h4: h4Due };
  log(`Phân tích ${perCoin.length} đồng: ${nLines} đường H1${h4Due ? `, ${nLines4} đường H4` : ''}, ${found.length} sự kiện mới`);

  if (MODE === 'dry-run') {
    // trendline M30 trong 48 giờ
    let nLines30 = 0;
    for (const u of universe) {
      const K = data30[u.instId];
      if (!K || K.c.length < 100) continue;
      const r = analyze(K, '30m'); nLines30 += r.all.length;
      for (const e of r.events.filter(e => e.t > target - 48 * HOUR)) found.push({ ...e, instId: u.instId, coin: u.coin, tickSz: ticks[u.instId] });
    }
    status.counts.lines30 = nLines30;
    // chấm điểm 30 sự kiện mới nhất (dùng dữ liệu hiện tại — chỉ để thử, OI/sổ lệnh/dòng tiền là của lúc chạy)
    const latest = [...found].sort((a, b) => b.t - a.t).slice(0, 30);
    await scoreAll(latest, inst => ({ '1H': data[inst], '4H': data4[inst], '30m': data30[inst] }), e => e.t + ({ '30m': M30MS, '4H': H4 }[e.tf] || HOUR) + 1000);
    const byType = {}, bySize = {};
    const tier = s => s < 60 ? '45-59' : s < 97 ? '60-96' : '97-120';
    for (const e of found) {
      const k0 = e.type + (e.tf === '4H' ? ' H4' : e.tf === '30m' ? ' M30' : '');
      byType[k0] = (byType[k0] || 0) + 1;
      const k = tier(e.line.span);
      bySize[k] ||= { BREAK: 0, CONFIRM: 0, RETEST: 0 };
      bySize[k][e.type]++;
    }
    const weak = found.filter(e => e.cls === 'weak').length;
    const sample = found.sort((a, b) => b.t - a.t).slice(0, 40).map(e => ({ at: stamp(e.t), tf: e.tf, coin: e.coin, type: e.type, dir: e.dir, kind: e.line.kind, span: e.line.span, touches: e.line.touches, cls: e.cls, follow: e.follow, score: e.sc ? (e.sc.s != null ? `${e.sc.s} ${e.sc.g}${e.sc.in ? ' VÀO' : ''}` : e.sc.err) : null, sc: e.sc || null, msg: buildMessage(e) }));
    const sd = latest.filter(e => e.sc && e.sc.s != null).map(e => e.sc);
    const dist = { n: sd.length, avg: sd.length ? +(sd.reduce((t, x) => t + x.s, 0) / sd.length).toFixed(1) : null, grades: {}, enter: sd.filter(x => x.in).length, flags: {}, locks: {} };
    for (const x of sd) { dist.grades[x.g] = (dist.grades[x.g] || 0) + 1; for (const f of x.f) { const k = f.split(/[:—(]/)[0].trim(); dist.flags[k] = (dist.flags[k] || 0) + 1; } for (const f of x.k) { const k = f.split(/[:—(]/)[0].trim(); dist.locks[k] = (dist.locks[k] || 0) + 1; } }
    writeJSON('dryrun.json', { at: Date.now(), host: status.host, universe: status.universe, target: stamp(target), hours: 48, byType, bySize, weak, perDay: +(found.length / 2).toFixed(1), scores: dist, market: marketSummary(), perCoin, sample, timing: { prefetchMs: status.prefetchMs, analyzeMs: status.analyzeMs, scoreMs: status.scoreMs } });
    log(`Thử 48 giờ: ${JSON.stringify(byType)} (cây phá yếu phải chờ cây sau: ${weak}) → khoảng ${(found.length / 2).toFixed(0)} tín hiệu/ngày`);
    if (process.env.DUMP_CANDLES) {
      const dump = {}, dump4 = {};
      for (const u of universe) { if (data[u.instId]) dump[u.instId] = data[u.instId]; if (data4[u.instId]) dump4[u.instId] = data4[u.instId]; }
      writeJSON('dryrun-candles.json', { at: Date.now(), target, data: dump }, false);
      writeJSON('dryrun-candles-h4.json', { at: Date.now(), target, data: dump4 }, false);
      writeJSON('dryrun-candles-m30.json', { at: Date.now(), target, data: data30 }, false);
    }
    status.result = 'dry-run';
    return;
  }

  // ----- cú phá yếu đang chờ cây kế tiếp: cây đó vừa đóng thì xét -----
  const now2 = [], skipped = [];
  for (const f of Object.values(state.follow)) {
    if (f.tf === '30m') continue;                                  // M30: xét ở processM30
    const step = f.tf === '4H' ? H4 : HOUR;
    if (f.tf === '4H' && !h4Due) continue;
    const due = f.tf === '4H' ? closeAt - H4 : target;          // giờ mở của cây vừa đóng ở khung đó
    if (f.tNext > due) continue;                                 // chưa tới
    const row = findRow(f.key) || { id: f.key };
    const K = f.tf === '4H' ? data4[f.instId] : data[f.instId];
    const j = K ? K.t.indexOf(f.tNext) : -1;
    delete state.follow[f.key];
    if (f.tNext < due || j < 0) { Object.assign(row, { why: 'bot không chạy kịp lúc xét cây sau', m30: 'follow-late' }); if (row.line) upsert(row); continue; }
    const up = f.dir === 'LONG', y = lineAt(f.line, f.tNext), o = K.o[j], c = K.c[j];
    const held = (up ? c > y : c < y) && (up ? c > o : c < o);
    const nb = { o, h: K.h[j], l: K.l[j], c };
    if (!held) {
      Object.assign(row, { why: `cây ${f.tf} sau không đóng tiếp ${up ? 'trên' : 'dưới'} đường`, m30: 'follow-no', nextBar: nb });
      if (row.line) upsert(row);
      log(`  ${f.coin} ${f.dir} ${f.tf}: cây sau không phá tiếp → không báo`);
      continue;
    }
    const e = { ...row, type: 'BREAK', instId: f.instId, coin: f.coin, dir: f.dir, side: f.side, t: f.t, tf: f.tf, line: f.line, close: c, linePrice: y,
      tickSz: ticks[f.instId] ?? row.tickSz, nextBar: nb, m30: null, _key: f.key };
    Object.assign(row, { m30: 'follow-ok', nextBar: nb });
    now2.push(e);
    log(`  ${f.coin} ${f.dir} ${f.tf}: cây phá yếu, cây sau đóng tiếp ${up ? 'trên' : 'dưới'} đường → báo`);
  }

  // ----- phân loại: báo ngay / chờ M30 / chờ cây sau / không báo -----
  let waiting = 0, followN = 0;
  for (const e of found.sort((a, b) => a.t - b.t)) {
    const key = eventId(e.instId, e);
    if (state.sent[key]) continue;     // đã xử lý ở lượt trước
    state.sent[key] = Date.now();
    e._key = key;
    let why = null;
    if (!ALERTS.includes(e.type)) why = 'loại thông báo đang tắt';
    else if (e.line.span < MIN_SPAN_ALERT) why = `mô hình nhỏ hơn ${MIN_SPAN_ALERT} nến`;
    if (why) { e.why = why; skipped.push(e); log(`  không đẩy ${e.coin} ${e.type} ${e.dir}: ${why}`); continue; }
    if (e.type === 'BREAK' && e.cls === 'weak') {
      // Cây phá sai màu / râu dài hơn thân / đóng sát đường → chờ cây kế tiếp đóng tiếp ngoài đường mới báo (không xét M30).
      const step = e.tf === '4H' ? H4 : HOUR;
      state.follow[key] = { key, instId: e.instId, coin: e.coin, dir: e.dir, side: e.side, tf: e.tf, t: e.t, tNext: e.t + step, line: e.line };
      upsert(rowOf(e, { m30: 'follow', followAt: e.t + 2 * step }));
      followN++;
      log(`  chờ cây ${e.tf} sau: ${e.coin} ${e.dir} (cây phá yếu, ${e.line.kind} ${e.line.span} nến) — xét lúc ${hhmm(e.t + 2 * step)}`);
      continue;
    }
    if (e.type === 'BREAK' && e.tf !== '4H') {
      const m30Close = m30CloseOf(e.t);
      state.pending[key] = { key, instId: e.instId, coin: e.coin, dir: e.dir, t: e.t, h1: e.bar, m30Close };
      upsert(rowOf(e, { m30: 'wait', m30Close }));
      waiting++;
      log(`  chờ M30 ${e.coin} ${e.dir} (phá ${e.line.kind} ${e.line.span} nến) — xét lúc ${hhmm(m30Close)}`);
      continue;
    }
    now2.push(e);   // H4 phá đẹp, xác nhận, retest: báo ngay
  }

  await scoreAll(now2, inst => ({ '1H': data[inst], '4H': data4[inst], '30m': data30[inst] }));
  const { sentN, batches } = await sendAll(now2);
  state.lastCandle = target;
  status.h1Done = true;
  status.sent = sentN; status.signals = now2.length; status.skipped = skipped.length; status.pushes = batches; status.waiting = waiting; status.followN = followN;
  status.pushDoneAfterCloseMs = Date.now() - (target + HOUR);
  log(`Bước H1${h4Due ? ' + H4' : ''} xong: báo ngay ${now2.length}, chờ M30 ${waiting}, chờ cây sau ${followN}, không đẩy ${skipped.length}. ` +
    `Sau khi nến đóng ${(status.pushDoneAfterCloseMs / 1000).toFixed(1)} giây.`);

  for (const e of now2) {
    const r0 = findRow(e._key);
    if (r0 && r0.m30 === 'follow-ok') Object.assign(r0, { pushed: e._okN || 0, pu: e._pu ?? 0, sentAt: Date.now(), sc: e.sc || null }), changed.set(r0.id, r0);
    else upsert(rowOf(e, { pushed: e._okN || 0, pu: e._pu ?? 0 }));
  }
  for (const e of skipped) upsert(rowOf(e, { why: e.why }));
  openTrades(now2);
  status.result = 'ok';

  // ----- Tầng Hậu Kiểm: theo dõi kèo S+/S++ đã báo -----
  const tn = trackTrades(state, data, data4);
  for (const m of tn) { log(`${m.title} — ${m.body}`); if (devices().length) await pushAll(m); }
  status.tradePushes = tn.length;

  // ----- trendline M30: cây M30 vừa đóng cùng lúc với cây H1 -----
  try {
    await closeM30(universe, data30, closeAt - M30MS);
    await processM30(universe, ticks, data30, closeAt - M30MS, data);
  } catch (e) { log('  M30 lỗi:', e.message); }

  // ----- dòng tiền: báo cáo 07:00 · 15:00 · 23:00, cảnh báo tức thì -----
  try { await marketPushes(closeAt); } catch (e) { log('  dòng tiền lỗi:', e.message); }
}

/* ---------------- bước 2: nến M30 → báo PHÁ ---------------- */

async function fetchM30(instId, openTs) {
  for (let k = 0; k < 15; k++) {
    try {
      const rows = await okx.latest(instId, '30m', 4);
      const r = rows.find(x => +x[0] === openTs);
      if (r && r[8] === '1') return { o: +r[1], h: +r[2], l: +r[3], c: +r[4] };
      if (!r && rows.length && +rows[0][0] > openTs + 2 * M30) break;          // đã trôi quá xa → lấy từ lịch sử
    } catch {}
    await sleep(700);
  }
  try {
    const d = await okx.api('/api/v5/market/history-candles', { instId, bar: '30m', after: String(openTs + M30), limit: '3' });
    const r = d.find(x => +x[0] === openTs);
    if (r) return { o: +r[1], h: +r[2], l: +r[3], c: +r[4] };
  } catch {}
  return null;
}

// Cú phá H1 đang chờ nến M30 đầu tiên của giờ sau (luật M30 của chủ repo).
async function pendingVerdicts(due) {
  const ok = [], drop = [];
  await pool(due, async p => {
    const row = findRow(p.key);
    const late = Date.now() - p.m30Close > M30_LATE;
    const m = await fetchM30(p.instId, p.m30Close - M30);
    const v = m30Verdict(p.dir, p.h1, m);
    const r = row || { id: p.key };
    if (late) { r.why = 'bot không chạy kịp lúc xét M30'; r.m30 = 'late'; drop.push(r); }
    else if (!v.ok) { r.why = v.why; r.m30 = 'skip'; drop.push(r); }
    else { r.m30 = v.missing ? 'nodata' : v.touch ? 'wick' : 'ok'; r._v = v; ok.push(r); }
    r.m30Bar = m; r.m30At = Date.now();
    log(`  ${p.coin} ${p.dir}: M30 ${m ? `o${m.o} h${m.h} l${m.l} c${m.c}` : 'không có'} so với cây phá h${p.h1.h} l${p.h1.l} → ${r.why ? 'KHÔNG báo — ' + r.why : 'báo'}`);
  });

  // Vào lệnh ở nến M30 xác nhận (nến 2) → giá vào = giá đóng nến M30 đó. Chấm điểm trước khi báo.
  const events = ok.filter(r => r.line).map(r => ({ ...r, _key: r.id, m30: r._v, entry: r.m30Bar ? r.m30Bar.c : r.close }));
  await scoreAll(events);
  const { sentN } = await sendAll(events);
  for (const r of ok) {
    const ev = events.find(e => e.id === r.id); delete r._v;
    Object.assign(r, { pu: ev ? ev._pu ?? 0 : 0, pushed: ev ? ev._okN || 0 : 0, sentAt: Date.now(), sc: ev ? ev.sc || null : null });
    if (r.line) upsert(r);
  }
  openTrades(events);
  for (const r of drop) if (r.line) upsert(r);
  for (const p of due) delete state.pending[p.key];
  // dọn chờ quá lâu (bot ngừng chạy cả ngày)
  for (const [k, p] of Object.entries(state.pending)) if (Date.now() - p.m30Close > 24 * HOUR) delete state.pending[k];
  const closeAt = Math.max(...due.map(p => p.m30Close));
  status.m30 = { at: Date.now(), closeAt, checked: due.length, pushed: ok.length, skipped: drop.length, sent: sentN, doneAfterCloseMs: Date.now() - closeAt };
  log(`Bước M30 xong: ${due.length} cú phá — báo ${ok.length}, bỏ ${drop.length}. Sau khi nến M30 đóng ${((Date.now() - closeAt) / 1000).toFixed(1)} giây.`);
}

/* ---------------- trendline M30 (luật prompt: ≤ 60 nến, bắt buộc chờ nến 2) ---------------- */

const M30N = 500;     // nến M30 tải về: đường ≤ 60 nến + phần tính ATR / kiểm tra đáy/đỉnh thật phía trước

async function loadM30(universe) {
  const d = {};
  await pool(universe, async u => { d[u.instId] = (await okx.candles(u.instId, '30m', M30N)).K; });
  return d;
}

// Chốt cây M30 vừa đóng (mở lúc `target`) cho những đồng chưa có.
async function closeM30(universe, d, target) {
  const need = universe.filter(u => d[u.instId] && lastOf(d[u.instId].t) !== target);
  if (!need.length) return;
  let missing = 0;
  await pool(need, async u => {
    for (let k = 0; k < 12; k++) {
      const rows = await okx.latest(u.instId, '30m', 2);
      const row = rows.find(r => +r[0] === target);
      if (row && row[8] === '1') { d[u.instId] = mergeClosed(d[u.instId], rows, target); return; }
      await sleep(600);
    }
    missing++;
  });
  log(`Chốt nến M30 ${hhmm(target)}–${hhmm(target + M30MS)}: ${need.length - missing}/${need.length} đồng`);
}

/**
 * Sự kiện trendline M30 của cây vừa đóng (mở lúc `target`):
 *   PHÁ: không báo ở nến phá — chờ nến M30 thứ 2 đóng tiếp ngoài đường, đúng màu (prompt 5.2 kịch bản B).
 *   XÁC NHẬN / RETEST: báo ngay (kèm điểm).
 * Đồng thời xét các cú phá M30 đang chờ nến 2 (nến 2 = cây vừa đóng).
 */
async function processM30(universe, ticks, d30, target, d1h = {}) {
  if (state.lastM30 && state.lastM30 >= target) { log(`Nến M30 ${hhmm(target)} đã xét.`); return; }
  const found = [];
  let nLines = 0;
  for (const u of universe) {
    const K = d30[u.instId];
    if (!K || K.c.length < 100 || lastOf(K.t) !== target) continue;
    const r = analyze(K, '30m');
    nLines += r.all.length;
    for (const e of r.events.filter(x => x.t === target)) found.push({ ...e, instId: u.instId, coin: u.coin, tickSz: ticks[u.instId] });
  }
  const now2 = [];
  // nến 2 của các cú phá M30 đang chờ
  for (const f of Object.values(state.follow)) {
    if (f.tf !== '30m' || f.tNext > target) continue;
    const row = findRow(f.key) || { id: f.key };
    const K = d30[f.instId], j = K ? K.t.indexOf(f.tNext) : -1;
    delete state.follow[f.key];
    if (f.tNext < target || j < 0) { Object.assign(row, { why: 'bot không chạy kịp lúc xét nến M30 thứ 2', m30: 'follow-late' }); if (row.line) upsert(row); continue; }
    const up = f.dir === 'LONG', y = lineAt(f.line, f.tNext), o = K.o[j], c = K.c[j];
    const held = (up ? c > y : c < y) && (up ? c > o : c < o);
    const nb = { o, h: K.h[j], l: K.l[j], c };
    if (!held) {
      Object.assign(row, { why: `nến M30 thứ 2 không đóng tiếp ${up ? 'trên' : 'dưới'} đường`, m30: 'follow-no', nextBar: nb });
      if (row.line) upsert(row);
      log(`  ${f.coin} ${f.dir} M30: nến 2 không giữ được → không báo`);
      continue;
    }
    Object.assign(row, { m30: 'follow-ok', nextBar: nb });
    now2.push({ ...row, type: 'BREAK', instId: f.instId, coin: f.coin, dir: f.dir, side: f.side, t: f.t, tf: '30m', line: f.line, close: c, linePrice: y, cls: f.cls,
      tickSz: ticks[f.instId] ?? row.tickSz, nextBar: nb, m30: null, entry: c, _key: f.key });
    log(`  ${f.coin} ${f.dir} M30: nến 2 đóng tiếp ${up ? 'trên' : 'dưới'} đường → báo`);
  }
  let waiting = 0, skipped = 0;
  for (const e of found.sort((a, b) => a.t - b.t)) {
    const key = eventId(e.instId, e);
    if (state.sent[key]) continue;
    state.sent[key] = Date.now();
    e._key = key;
    if (!ALERTS.includes(e.type) || e.line.span < MIN_SPAN_ALERT) { upsert(rowOf(e, { why: 'loại thông báo đang tắt' })); skipped++; continue; }
    if (e.type === 'BREAK') {
      state.follow[key] = { key, instId: e.instId, coin: e.coin, dir: e.dir, side: e.side, tf: '30m', t: e.t, tNext: e.t + M30MS, line: e.line, cls: e.cls };
      upsert(rowOf(e, { m30: 'follow2', followAt: e.t + 2 * M30MS }));
      waiting++;
      log(`  chờ nến M30 thứ 2: ${e.coin} ${e.dir} (phá ${e.line.kind} ${e.line.span} nến) — xét lúc ${hhmm(e.t + 2 * M30MS)}`);
      continue;
    }
    now2.push(e);
  }
  await scoreAll(now2, inst => ({ '30m': d30[inst], '1H': d1h[inst] }));
  const { sentN } = await sendAll(now2);
  for (const e of now2) {
    const r0 = findRow(e._key);
    if (r0 && r0.m30 === 'follow-ok') Object.assign(r0, { pushed: e._okN || 0, pu: e._pu ?? 0, sentAt: Date.now(), sc: e.sc || null }), changed.set(r0.id, r0);
    else upsert(rowOf(e, { pushed: e._okN || 0, pu: e._pu ?? 0 }));
  }
  openTrades(now2);
  state.lastM30 = target;
  status.m30lines = { at: Date.now(), target, lines: nLines, events: found.length, pushed: now2.length, waiting, skipped, sent: sentN, doneAfterCloseMs: Date.now() - (target + M30MS) };
  log(`Trendline M30 ${hhmm(target)}–${hhmm(target + M30MS)}: ${nLines} đường, ${found.length} sự kiện — báo ${now2.length}, chờ nến 2 ${waiting}.`);
}

/* ---------------- bước 2: nến M30 ---------------- */

async function stageM30(wait) {
  const now = Date.now();
  const list = Object.values(state.pending);
  const due = list.filter(p => p.m30Close <= now + (wait ? M30_WAIT_MAX : 0));
  // cây M30 cần xét trendline: cây vừa đóng chưa xét, hoặc cây đang chạy nếu sắp đóng
  const openNow = Math.floor(now / M30MS) * M30MS;
  let t30 = null;
  if (!state.lastM30 || state.lastM30 < openNow - M30MS) t30 = openNow - M30MS;
  else if (wait && openNow + M30MS - now <= M30_WAIT_MAX) t30 = openNow;
  if (!due.length && t30 === null) { log(list.length ? `${list.length} cú phá đang chờ M30, chưa tới giờ.` : 'Không có cú phá nào đang chờ M30, nến M30 đã xét.'); return; }

  let U = null, d30 = null;
  if (t30 !== null) {
    try { U = await m30Universe(); d30 = await loadM30(U.universe); log(`Đã tải nến M30 ${U.universe.length} đồng`); }
    catch (e) { log('  không tải được nến M30:', e.message); U = null; }
  }
  const at = Math.max(due.length ? Math.max(...due.map(p => p.m30Close)) : 0, t30 !== null ? t30 + M30MS : 0) + SETTLE;
  if (at > Date.now()) {
    log(`Chờ ${((at - Date.now()) / 1000).toFixed(0)} giây tới khi nến M30 ${hhmm(at - SETTLE - M30)}–${hhmm(at - SETTLE)} đóng (${due.length} cú phá H1 chờ M30)…`);
    await sleep(at - Date.now());
  }
  if (!status.host) { okx.setThrottle(60); try { status.host = (await okx.pickHost()).host; } catch {} }
  if (due.length) await pendingVerdicts(due);
  if (U && d30) {
    try { await closeM30(U.universe, d30, t30); await processM30(U.universe, U.ticks, d30, t30); }
    catch (e) { log('  M30 lỗi:', e.message); }
  }
  if (!status.result) status.result = 'ok';
}

/* ---------------- chạy ---------------- */

async function main() {
  await intakeRegistrations();
  const list = devices();
  log(`Chế độ ${MODE}${MODE === 'scan' ? ' · bước ' + STAGE : ''} · kích hoạt bởi ${TRIGGER} · ${list.length} máy nhận thông báo` +
    (list.some(d => d.src === 'app') ? ` (${list.filter(d => d.src === 'app').length} tự đăng ký qua app)` : ''));

  if (MODE === 'test-push') {
    if (!list.length) { log('Chưa có máy nào để gửi.'); return finish({ result: 'no-devices' }); }
    const n = await pushAll({ title: 'Bot Trade đã kết nối ✓', body: 'Thông báo thử. Thấy dòng này là bot đã gửi được tới máy bạn.', url: './#tab=settings', tag: 'test' });
    return finish({ result: n ? 'test-sent' : 'test-failed' });
  }

  // Máy mới (dán mã hoặc app tự đăng ký) → gửi lời chào riêng cho máy đó để biết đã thông.
  state.hello ||= {};
  if (state.devHash && !Object.keys(state.hello).length) for (const d of list) state.hello[d.id] = Date.now();   // bản cũ đã chào rồi
  const fresh = list.filter(d => !state.hello[d.id]);
  if (MODE === 'scan' && fresh.length) {
    log(`Máy mới: ${fresh.map(d => d.name || d.id).join(', ')} — gửi lời chào`);
    await pushAll({ title: 'Bot Trade đã nhận máy này ✓', body: `Từ giờ bot sẽ báo phá vỡ trendline H1, H4 cho top ${TOP_N} đồng theo vốn hoá + top ${TOP_VOL} khối lượng OKX${PINNED.length ? ' + ' + PINNED.map(id => labelOf(id.split('-')[0])).join(', ') : ''}.`, url: './#tab=settings', tag: 'hello' }, fresh);
    for (const d of fresh) if (state.devices[d.id] && state.devices[d.id].ok) state.hello[d.id] = Date.now();
  }
  for (const id of Object.keys(state.hello)) if (!list.some(d => d.id === id) && !state.dead[id]) delete state.hello[id];

  if (STAGE === 'all' || STAGE === 'h1' || MODE === 'dry-run') await stageH1();
  if (MODE === 'scan') await stageM30(STAGE !== 'h1');

  // dọn bộ nhớ chống trùng cũ hơn 20 ngày
  const old = Date.now() - 20 * 24 * HOUR;
  for (const [k, v] of Object.entries(state.sent)) if (v < old) delete state.sent[k];

  if (MODE === 'scan') saveSignals();
  finish({ result: status.result || 'ok' });
}

main().catch(e => {
  log('LỖI:', e.stack || e.message || e);
  try { if (MODE === 'scan') saveSignals(); } catch {}
  finish({ result: 'error', error: String(e.message || e) });
  process.exitCode = 1;
});
