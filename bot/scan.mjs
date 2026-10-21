// bot/scan.mjs — quét top 50 đồng, phát hiện phá vỡ trendline trên nến H1, gửi thông báo về iPhone.
//
// Chạy trên GitHub Actions (.github/workflows/scan.yml). Dữ liệu giữa các lần chạy nằm ở thư mục
// OUT_DIR (mặc định "out"), được workflow lấy từ / đẩy lên nhánh "data" của repo.
//
// MODE:
//   scan       quét và gửi thông báo (mặc định)
//   dry-run    quét thử 48 giờ gần nhất, KHÔNG gửi, KHÔNG ghi nhớ — chỉ ghi báo cáo dryrun.json
//   test-push  chỉ gửi một thông báo thử tới mọi thiết bị
//
// Bí mật (GitHub Secrets):
//   PUSH_CONFIG  đoạn mã app tạo ra khi bấm "Bật thông báo" (một hoặc nhiều đoạn, mỗi đoạn một dòng)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import webpush from 'web-push';
import { analyze, CFG, HOUR } from '../core/breakout.js';
import * as okx from '../core/okx.js';
import { PAGES_URL, TOP_N, ALERTS, MIN_SPAN_ALERT } from '../core/config.js';
import { hhmm, stamp } from '../core/format.js';
import { buildMessage, plan } from './plan.mjs';

const MODE = process.env.MODE || 'scan';
const TRIGGER = process.env.TRIGGER || 'local';
const OUT = process.env.OUT_DIR || 'out';
const WAIT_MAX = 9 * 60e3;     // chạy sớm tối đa 9 phút trước giờ đóng nến thì ở lại chờ
const SETTLE = 1200;           // sau giờ đóng nến chờ thêm 1,2 giây cho OKX chốt nến
const COOLDOWN = 3;            // không báo PHÁ cùng chiều cùng đồng 2 lần trong 3 nến (trừ đường lớn hơn hẳn)
const KEEP_SIGNALS = 500;
const CONC = 6;

const t0 = Date.now();
const LOG = [];
const log = (...a) => { const s = `[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s] ` + a.join(' '); console.log(s); LOG.push(s); };
const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));
fs.mkdirSync(OUT, { recursive: true });
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')); } catch { return d; } };
const writeJSON = (f, v) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(v, null, 1));
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);

const state = readJSON('state.json', {});
const prevStatus = readJSON('status.json', {});
state.sent ||= {}; state.lastBreak ||= {}; state.devices ||= {};
const status = { version: 2, mode: MODE, trigger: TRIGGER, startedAt: t0, cfg: { window: CFG.WINDOW, top: TOP_N, alerts: ALERTS } };

/* ---------------- thông báo ---------------- */

function parseDevices(raw) {
  if (!raw || !raw.trim()) return [];
  let items = [];
  try { const j = JSON.parse(raw); items = Array.isArray(j) ? j : [j]; }
  catch { items = (raw.match(/\{[^\n]*\}/g) || []).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean); }
  return items.filter(x => x && x.sub && x.sub.endpoint && x.vapid && x.vapid.pub && x.vapid.priv)
    .map(x => ({ ...x, id: sha(x.sub.endpoint) }));
}
const devices = parseDevices(process.env.PUSH_CONFIG);
const SUBJECT = PAGES_URL;   // Apple yêu cầu một địa chỉ https: hoặc mailto:

async function pushAll(msg) {
  const payload = JSON.stringify({ ...msg, ts: Date.now() });
  const res = await Promise.all(devices.map(async d => {
    const rec = { at: Date.now(), name: d.name || '' };
    try {
      const r = await webpush.sendNotification(d.sub, payload, {
        TTL: 3600, urgency: 'high',
        vapidDetails: { subject: SUBJECT, publicKey: d.vapid.pub, privateKey: d.vapid.priv },
      });
      Object.assign(rec, { ok: true, status: r.statusCode });
    } catch (e) {
      Object.assign(rec, { ok: false, status: e.statusCode || 0, error: String(e.body || e.message).slice(0, 200) });
      if (e.statusCode === 404 || e.statusCode === 410) rec.gone = true;   // máy đã huỷ đăng ký / hết hạn
    }
    state.devices[d.id] = rec;
    return rec;
  }));
  const okN = res.filter(r => r.ok).length;
  log(`  → gửi ${okN}/${devices.length} máy`, res.filter(r => !r.ok).map(r => `lỗi ${r.status} ${r.error || ''}`).join(' '));
  return okN;
}

/* ---------------- tiện ích ---------------- */

async function pool(items, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (i < items.length) {
      const it = items[i++];
      try { await fn(it); } catch (e) { log('  lỗi', it.instId || it, e.message); }
    }
  }));
}

function mergeClosed(K, rows, upTo) {
  // thay các nến từ upTo trở về sau bằng các nến đã chốt trong rows
  const keep = K.t.findIndex(t => t >= upTo);
  const cut = keep < 0 ? K.t.length : keep;
  const add = rows.filter(r => r[8] === '1' && +r[0] >= upTo && +r[0] <= upTo).map(r => r.map(Number)).sort((a, b) => a[0] - b[0]);
  const out = { t: K.t.slice(0, cut), o: K.o.slice(0, cut), h: K.h.slice(0, cut), l: K.l.slice(0, cut), c: K.c.slice(0, cut), v: K.v.slice(0, cut) };
  for (const r of add) { out.t.push(r[0]); out.o.push(r[1]); out.h.push(r[2]); out.l.push(r[3]); out.c.push(r[4]); out.v.push(r[5]); }
  const n = out.t.length, from = Math.max(0, n - (CFG.WINDOW + CFG.WARMUP));
  for (const k of Object.keys(out)) out[k] = out[k].slice(from);
  return out;
}

function finish(extra = {}) {
  Object.assign(status, extra, { finishedAt: Date.now() });
  const live = new Set(devices.map(d => d.id));
  for (const id of Object.keys(state.devices)) if (!live.has(id)) delete state.devices[id];
  status.devices = Object.entries(state.devices).map(([id, r]) => ({ id, ...r }));
  status.push = { configured: devices.length, ids: devices.map(d => d.id) };
  // giữ lại thông tin lần quét thật gần nhất để app hiển thị
  if (MODE === 'scan' && status.result === 'ok') status.lastScan = {
    at: status.finishedAt, target: status.target, closeAt: status.closeAt, trigger: TRIGGER, host: status.host,
    readyAfterCloseMs: status.readyAfterCloseMs, pushDoneAfterCloseMs: status.pushDoneAfterCloseMs,
    counts: status.counts, signals: status.signals, pushes: status.pushes, sent: status.sent,
  };
  else if (prevStatus.lastScan) status.lastScan = prevStatus.lastScan;
  writeJSON(MODE === 'dry-run' ? 'dryrun-status.json' : 'status.json', status);
  // nến thô của lần chạy thử chỉ dùng để chỉnh ngưỡng tại máy — không mang theo mỗi giờ
  if (MODE !== 'dry-run') for (const f of ['dryrun-candles.json', 'dryrun-instruments.json']) fs.rmSync(path.join(OUT, f), { force: true });
  if (MODE !== 'dry-run') writeJSON('state.json', state);
  fs.writeFileSync(path.join(OUT, MODE === 'dry-run' ? 'dryrun.log' : 'last.log'), LOG.join('\n') + '\n');
}

/* ---------------- chạy ---------------- */

async function main() {
  log(`Chế độ ${MODE} · kích hoạt bởi ${TRIGGER} · ${devices.length} máy nhận thông báo`);

  if (MODE === 'test-push') {
    if (!devices.length) { log('Chưa có PUSH_CONFIG — chưa có máy nào để gửi.'); return finish({ result: 'no-devices' }); }
    const n = await pushAll({ title: 'Bot Trade đã kết nối ✓', body: 'Thông báo thử. Thấy dòng này là bot đã gửi được tới máy bạn.', url: './#tab=settings', tag: 'test' });
    return finish({ result: n ? 'test-sent' : 'test-failed' });
  }

  // Máy mới được thêm → gửi lời chào để biết đã thông.
  const devHash = sha(devices.map(d => d.id).sort().join(','));
  if (MODE === 'scan' && devices.length && devHash !== state.devHash) {
    log('Phát hiện thay đổi danh sách máy — gửi lời chào');
    const n = await pushAll({ title: 'Bot Trade đã nhận máy này ✓', body: `Từ giờ bot sẽ báo phá vỡ trendline H1 cho top ${TOP_N} đồng.`, url: './#tab=settings', tag: 'hello' });
    if (n) state.devHash = devHash;
  }

  // ----- chọn cây nến cần xử lý -----
  const now = Date.now();
  const curOpen = Math.floor(now / HOUR) * HOUR;   // giờ mở của nến đang chạy
  const lastClosed = curOpen - HOUR;
  let target, waitUntil = 0;
  if (MODE === 'dry-run') target = lastClosed;
  else if (!state.lastCandle || state.lastCandle < lastClosed) target = lastClosed;
  else if (curOpen + HOUR - now <= WAIT_MAX) { target = curOpen; waitUntil = curOpen + HOUR + SETTLE; }
  else {
    log(`Nến ${hhmm(lastClosed)} đã quét. Còn ${Math.round((curOpen + HOUR - now) / 60e3)} phút mới tới nến mới — thoát.`);
    return finish({ result: 'nothing-to-do', target: lastClosed });
  }
  status.target = target; status.closeAt = target + HOUR;
  log(`Nến cần xử lý: H1 ${stamp(target)} (đóng lúc ${hhmm(target + HOUR)})${waitUntil ? ' — sẽ chờ tới lúc đóng' : ''}`);

  // ----- OKX -----
  okx.setThrottle(60);
  const { host, tried } = await okx.pickHost();
  status.host = host; if (tried.length) status.hostTried = tried;
  log('OKX:', host);
  const insts = await okx.instruments();
  const ticks = await okx.tickSizes(insts);
  const tickers = await okx.swapTickers(okx.allowedSet(insts));
  const universe = tickers.slice(0, TOP_N);
  writeJSON('top50.json', { at: Date.now(), list: universe.map(u => ({ instId: u.instId, coin: u.coin, volUsd: Math.round(u.volUsd), last: u.last, chg: +u.chg.toFixed(5) })) });
  log(`Top ${universe.length}: ${universe.slice(0, 12).map(u => u.coin).join(' ')} …`);

  // ----- tải trước 520 nến H1 mỗi đồng -----
  const data = {};
  await pool(universe, async u => { data[u.instId] = (await okx.candles(u.instId, '1H', CFG.WINDOW + CFG.WARMUP)).K; });
  status.prefetchMs = Date.now() - t0;
  log(`Đã tải ${Object.keys(data).length} đồng`);

  // ----- chờ đúng giờ đóng nến -----
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
  const readyAt = Date.now();
  status.readyAfterCloseMs = readyAt - (target + HOUR);

  // ----- phân tích -----
  const since = MODE === 'dry-run' ? target - 48 * HOUR : Math.max(state.lastCandle || target - HOUR, target - 3 * HOUR);
  const found = [], perCoin = [];
  let nLines = 0;
  for (const u of universe) {
    const K = data[u.instId];
    if (!K || K.c.length < 100) continue;
    if (K.t[K.t.length - 1] !== target) { log(`  ${u.coin}: nến cuối ${stamp(K.t[K.t.length - 1])} ≠ ${stamp(target)} — bỏ qua`); continue; }
    const r = analyze(K);
    nLines += r.all.length;
    const ev = r.events.filter(e => e.t > since && e.t <= target);
    perCoin.push({ coin: u.coin, lines: r.all.length, shown: r.lines.length, events: ev.length });
    for (const e of ev) found.push({ ...e, instId: u.instId, coin: u.coin, tickSz: ticks[u.instId] });
  }
  status.analyzeMs = Date.now() - readyAt;
  status.counts = { coins: perCoin.length, lines: nLines, events: found.length };
  log(`Phân tích ${perCoin.length} đồng: ${nLines} đường hợp lệ, ${found.length} sự kiện mới`);

  if (MODE === 'dry-run') {
    const byType = {}, bySize = {};
    const tier = s => s < 40 ? 'nhỏ <40' : s < 100 ? 'vừa 40-99' : s < 250 ? 'lớn 100-249' : 'rất lớn 250+';
    for (const e of found) {
      byType[e.type] = (byType[e.type] || 0) + 1;
      const k = tier(e.line.span);
      bySize[k] ||= { BREAK: 0, CONFIRM: 0, RETEST: 0 };
      bySize[k][e.type]++;
    }
    const perDayAtLeast = Object.fromEntries([0, 20, 40, 60, 100, 150].map(m => [m, +(found.filter(e => e.line.span >= m && ALERTS.includes(e.type)).length / 2).toFixed(1)]));
    const sample = found.sort((a, b) => b.t - a.t).slice(0, 40).map(e => ({ at: stamp(e.t), coin: e.coin, type: e.type, dir: e.dir, kind: e.line.kind, span: e.line.span, touches: e.line.touches, confirmed: e.confirmed, steep: e.line.steep, msg: buildMessage(e) }));
    writeJSON('dryrun.json', { at: Date.now(), host, target: stamp(target), hours: 48, byType, bySize, perDay: +(found.length / 2).toFixed(1), perDayAtLeast, perCoin, sample, timing: { prefetchMs: status.prefetchMs, analyzeMs: status.analyzeMs } });
    log(`Thử 48 giờ: ${JSON.stringify(byType)} → khoảng ${(found.length / 2).toFixed(0)} thông báo/ngày`);
    if (process.env.DUMP_CANDLES) {
      const dump = {};
      for (const u of universe) if (data[u.instId]) dump[u.instId] = data[u.instId];
      writeJSON('dryrun-candles.json', { at: Date.now(), target, data: dump });
    }
    return finish({ result: 'dry-run' });
  }

  // ----- lọc trùng, giãn cách, gửi -----
  const signals = readJSON('signals.json', []);
  const fresh = [];
  for (const e of found.sort((a, b) => a.t - b.t)) {
    if (!ALERTS.includes(e.type)) continue;
    if (e.line.span < MIN_SPAN_ALERT) continue;
    const key = `${e.instId}|${e.type}|${e.side}|${e.line.tBreak}`;
    if (state.sent[key]) continue;
    if (e.type === 'BREAK') {
      const lb = state.lastBreak[e.instId + '|' + e.side];
      if (lb && e.t - lb.t <= COOLDOWN * HOUR && e.line.span < 2 * lb.span) { log(`  bỏ ${e.coin} ${e.type} (vừa báo phá cùng chiều)`); state.sent[key] = Date.now(); continue; }
      state.lastBreak[e.instId + '|' + e.side] = { t: e.t, span: e.line.span };
    }
    fresh.push({ e, key });
  }
  for (const f of fresh) { state.sent[f.key] = Date.now(); f.e._key = f.key; }
  const batches = plan(fresh.map(f => f.e));
  let sentN = 0;
  for (const b of batches) {
    log(`${b.msg.title} — ${b.msg.body.replace(/\n/g, ' / ')}`);
    const okN = devices.length ? await pushAll(b.msg) : 0;
    if (okN) sentN++;
    for (const e of b.events) {
      const m = buildMessage(e);
      signals.unshift({
        id: e._key, instId: e.instId, coin: e.coin, type: e.type, dir: e.dir, side: e.side,
        t: e.t, close: e.close, linePrice: e.linePrice, level: e.level, confirmed: e.confirmed,
        others: e.others, tickSz: e.tickSz, line: e.line, title: m.title, body: m.body,
        sentAt: Date.now(), pushed: okN, via: b.summary ? 'summary' : 'single',
      });
    }
  }
  if (!devices.length && fresh.length) log('Chưa có máy nào (PUSH_CONFIG trống) — tín hiệu chỉ được lưu, không gửi.');

  // dọn bộ nhớ chống trùng cũ hơn 20 ngày
  const old = Date.now() - 20 * 24 * HOUR;
  for (const [k, v] of Object.entries(state.sent)) if (v < old) delete state.sent[k];
  for (const [k, v] of Object.entries(state.lastBreak)) if (v.t < old) delete state.lastBreak[k];

  state.lastCandle = target;
  writeJSON('signals.json', signals.slice(0, KEEP_SIGNALS));
  status.sent = sentN; status.signals = fresh.length; status.pushes = batches.length;
  status.pushDoneAfterCloseMs = Date.now() - (target + HOUR);
  log(`Xong: ${fresh.length} tín hiệu, ${batches.length} thông báo, gửi được ${sentN}. Báo sau khi nến đóng ${(status.pushDoneAfterCloseMs / 1000).toFixed(1)} giây.`);
  finish({ result: 'ok' });
}

main().catch(e => {
  log('LỖI:', e.stack || e.message || e);
  finish({ result: 'error', error: String(e.message || e) });
  process.exitCode = 1;
});
