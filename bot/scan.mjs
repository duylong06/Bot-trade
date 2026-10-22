// bot/scan.mjs — quét top 50 đồng, phát hiện phá vỡ trendline trên nến H1, gửi thông báo về iPhone,
// ghi nhớ kết quả từng tín hiệu và tự học loại nào hay ăn.
//
// Chạy trên GitHub Actions (.github/workflows/scan.yml). Dữ liệu giữa các lần chạy nằm ở thư mục
// OUT_DIR (mặc định "out"), được workflow lấy từ / đẩy lên nhánh "data" của repo.
//
// MODE:
//   scan       quét và gửi thông báo (mặc định)
//   dry-run    quét thử 48 giờ gần nhất, KHÔNG gửi, KHÔNG ghi nhớ — chỉ ghi báo cáo dryrun.json
//   test-push  chỉ gửi một thông báo thử tới mọi thiết bị
//   bootstrap  chạy lại 20 ngày quá khứ từng giờ một để có dữ liệu học (không gửi gì)
//
// Thứ tự trong một lượt quét: phát hiện → chấm điểm → GỬI → rồi mới chấm kết quả cũ và học lại.
// Phần học chạy sau khi thông báo đã đi, nên không làm chậm thông báo.
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
import { featuresAt, predict, evOf, trainAll, buildStats, eventId, LEARN } from '../core/learn.js';
import { buildMessage, plan } from './plan.mjs';
import { Journal, makeRow, replay } from './journal.mjs';

const MODE = process.env.MODE || 'scan';
const TRIGGER = process.env.TRIGGER || 'local';
const OUT = process.env.OUT_DIR || 'out';
const WAIT_MAX = 9 * 60e3;     // chạy sớm tối đa 9 phút trước giờ đóng nến thì ở lại chờ
const SETTLE = 1200;           // sau giờ đóng nến chờ thêm 1,2 giây cho OKX chốt nến
const COOLDOWN = 3;            // không báo PHÁ cùng chiều cùng đồng 2 lần trong 3 nến (trừ đường lớn hơn hẳn)
const BOOT_HOURS = 480;        // chạy lại 20 ngày quá khứ
const SIGNAL_DAYS = 7;         // danh sách tín hiệu trong app giữ 7 ngày
const MARK_DAYS = 23;          // dấu trên biểu đồ: phủ hết 500 nến H1
const CONC = 6;

const t0 = Date.now();
const LOG = [];
const log = (...a) => { const s = `[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s] ` + a.join(' '); console.log(s); LOG.push(s); };
const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));
fs.mkdirSync(OUT, { recursive: true });
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')); } catch { return d; } };
const writeJSON = (f, v, pretty = true) => fs.writeFileSync(path.join(OUT, f), pretty ? JSON.stringify(v, null, 1) : JSON.stringify(v));
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
const r3 = x => (x == null || !isFinite(x) ? null : Math.round(x * 1000) / 1000);
const fmtR = x => (x >= 0 ? '+' : '') + x.toFixed(2).replace('.', ',') + 'R';

const state = readJSON('state.json', {});
const prevStatus = readJSON('status.json', {});
state.sent ||= {}; state.lastBreak ||= {}; state.devices ||= {};
const status = { version: 3, mode: MODE, trigger: TRIGGER, startedAt: t0, cfg: { window: CFG.WINDOW, top: TOP_N, alerts: ALERTS } };
const journal = new Journal(readJSON('journal.json', null));
let model = readJSON('model.json', null);

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
  const add = rows.filter(r => r[8] === '1' && +r[0] === upTo).map(r => r.map(Number));
  const out = { t: K.t.slice(0, cut), o: K.o.slice(0, cut), h: K.h.slice(0, cut), l: K.l.slice(0, cut), c: K.c.slice(0, cut), v: K.v.slice(0, cut) };
  for (const r of add) { out.t.push(r[0]); out.o.push(r[1]); out.h.push(r[2]); out.l.push(r[3]); out.c.push(r[4]); out.v.push(r[5]); }
  const n = out.t.length, from = Math.max(0, n - (CFG.WINDOW + CFG.WARMUP));
  for (const k of Object.keys(out)) out[k] = out[k].slice(from);
  return out;
}

async function connectOkx() {
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
  return { ticks, universe };
}

/* ---------------- ghi nhớ & học ---------------- */

// Mốc bot bắt đầu chạy thật: tín hiệu trước mốc này chưa từng được xét để gửi.
function botStart(signals) {
  if (!state.firstScanAt) {
    const ts = signals.map(s => s.t).filter(Boolean);
    state.firstScanAt = ts.length ? Math.min(...ts) : Date.now();
  }
  return state.firstScanAt;
}

const puOf = s => s.pu ?? (s.pushed > 0 ? (s.via === 'summary' ? 2 : 1) : 0);

async function bootstrap(universe, signals) {
  const t1 = Date.now();
  log(`Chạy lại ${BOOT_HOURS} giờ quá khứ để có dữ liệu học…`);
  const hist = {};
  await pool(universe, async u => { hist[u.instId] = (await okx.candles(u.instId, '1H', CFG.WINDOW + CFG.WARMUP + BOOT_HOURS)).K; });
  const sig = new Map(signals.map(s => [s.id, s]));
  const start = botStart(signals);
  let added = 0;
  const calls = replay(hist, BOOT_HOURS, (instId, e, f) => {
    const id = eventId(instId, e);
    if (journal.has(id)) return;
    const s = sig.get(id);
    const pu = s ? puOf(s) : e.t >= start ? 0 : null;
    journal.add(makeRow(instId, instId.split('-')[0], e, f, { src: 'boot', pu }));
    added++;
  });
  const resolved = journal.evaluate(hist);
  state.bootAt = Date.now();
  log(`  ${calls} lần phân tích trên ${Object.keys(hist).length} đồng: thêm ${added} tín hiệu, ${resolved} đã có kết quả — ${((Date.now() - t1) / 1000).toFixed(1)} giây`);
  return hist;
}

// Gọn file cho app tải nhanh trên điện thoại: bỏ đặc trưng (đã có trong nhật ký), giá giữ 8 chữ số có nghĩa.
const P8 = x => (typeof x === 'number' && isFinite(x) ? +x.toPrecision(8) : x);
function slim(s) {
  const { f, ...o } = s;
  for (const k of ['close', 'linePrice', 'level']) o[k] = P8(o[k]);
  if (o.line) { o.line = { ...o.line }; for (const k of ['pa', 'pb', 'mPerH', 'level']) o.line[k] = P8(o.line[k]); }
  return o;
}

function learn(signals) {
  journal.prune();
  model = trainAll(journal.rows);
  const stats = buildStats(journal.rows, model);
  writeJSON('journal.json', journal.toJSON(), false);
  writeJSON('model.json', model);
  writeJSON('stats.json', stats);
  const v = model.validation || {};
  status.learn = {
    rows: journal.rows.length, resolved: stats.all.n, pending: stats.all.pending, nWL: model.nWL,
    ready: model.ready, filtering: model.filtering, reason: v.reason, lift: v.lift, keep: v.keep,
    win: stats.all.win, avgR: stats.all.avgR,
  };
  log(`Học: ${journal.rows.length} tín hiệu trong nhật ký, ${stats.all.n} đã có kết quả (thắng ${stats.all.win == null ? '—' : (stats.all.win * 100).toFixed(0) + '%'}, kỳ vọng ${stats.all.avgR == null ? '—' : fmtR(stats.all.avgR)})` +
    ` · ${!model.ready ? `đang học (${model.nWL}/${LEARN.MIN_TRAIN})` : model.filtering ? `ĐANG TỰ LỌC (lọc giúp ${fmtR(v.lift)}/lệnh, giữ ${(v.keep * 100).toFixed(0)}%)` : `chưa lọc — ${v.reason}`}`);

  // đồng bộ kết quả vào danh sách tín hiệu của app, giữ 7 ngày
  for (const s of signals) {
    const r = journal.get(s.id);
    if (s.pu == null) s.pu = puOf(s);
    if (!r) continue;
    Object.assign(s, { o: r.o, h: r.h, r24: r.r24, r72: r.r72, now: r.now, mfe: r.mfe, mae: r.mae });
    if (s.p == null && r.p != null) { s.p = r.p; s.ev = r.ev; }
  }
  const keepFrom = Date.now() - SIGNAL_DAYS * 24 * HOUR;
  writeJSON('signals.json', signals.filter(s => s.t >= keepFrom).sort((a, b) => b.t - a.t).slice(0, 1500).map(slim), false);

  // Dấu trên biểu đồ (500 nến ≈ 21 ngày): tín hiệu nào đã đẩy về máy, kết quả ra sao.
  // Gọn theo từng đồng: { instId: [[loại|cạnh|giờ phá, đã đẩy, kết quả], …] }
  const markFrom = Date.now() - MARK_DAYS * 24 * HOUR, m = {};
  for (const r of journal.rows) if (r.t >= markFrom) (m[r.s] ||= []).push([r.id.slice(r.s.length + 1), r.pu, r.o]);
  writeJSON('marks.json', { v: 1, from: markFrom, m }, false);
}

function finish(extra = {}) {
  Object.assign(status, extra, { finishedAt: Date.now() });
  const live = new Set(devices.map(d => d.id));
  for (const id of Object.keys(state.devices)) if (!live.has(id)) delete state.devices[id];
  status.devices = Object.entries(state.devices).map(([id, r]) => ({ id, ...r }));
  status.push = { configured: devices.length, ids: devices.map(d => d.id) };
  if (!status.learn && prevStatus.learn) status.learn = prevStatus.learn;
  // giữ lại thông tin lần quét thật gần nhất để app hiển thị
  if (MODE === 'scan' && status.result === 'ok') status.lastScan = {
    at: status.finishedAt, target: status.target, closeAt: status.closeAt, trigger: TRIGGER, host: status.host,
    readyAfterCloseMs: status.readyAfterCloseMs, pushDoneAfterCloseMs: status.pushDoneAfterCloseMs,
    counts: status.counts, signals: status.signals, pushes: status.pushes, sent: status.sent, skipped: status.skipped,
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
  log(`Chế độ ${MODE} · kích hoạt bởi ${TRIGGER} · ${devices.length} máy nhận thông báo · nhật ký ${journal.rows.length} tín hiệu`);

  if (MODE === 'test-push') {
    if (!devices.length) { log('Chưa có PUSH_CONFIG — chưa có máy nào để gửi.'); return finish({ result: 'no-devices' }); }
    const n = await pushAll({ title: 'Bot Trade đã kết nối ✓', body: 'Thông báo thử. Thấy dòng này là bot đã gửi được tới máy bạn.', url: './#tab=settings', tag: 'test' });
    return finish({ result: n ? 'test-sent' : 'test-failed' });
  }

  if (MODE === 'bootstrap') {
    const { universe } = await connectOkx();
    const signals = readJSON('signals.json', []);
    await bootstrap(universe, signals);
    learn(signals);
    return finish({ result: 'bootstrap' });
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

  const { ticks, universe } = await connectOkx();

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
    for (const e of ev) found.push({ ...e, f: featuresAt(r.W, r.A, e), instId: u.instId, coin: u.coin, tickSz: ticks[u.instId] });
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
    writeJSON('dryrun.json', { at: Date.now(), host: status.host, target: stamp(target), hours: 48, byType, bySize, perDay: +(found.length / 2).toFixed(1), perDayAtLeast, perCoin, sample, timing: { prefetchMs: status.prefetchMs, analyzeMs: status.analyzeMs } });
    log(`Thử 48 giờ: ${JSON.stringify(byType)} → khoảng ${(found.length / 2).toFixed(0)} thông báo/ngày`);
    if (process.env.DUMP_CANDLES) {
      const dump = {};
      for (const u of universe) if (data[u.instId]) dump[u.instId] = data[u.instId];
      writeJSON('dryrun-candles.json', { at: Date.now(), target, data: dump });
    }
    return finish({ result: 'dry-run' });
  }

  // ----- chấm điểm, lọc, gửi -----
  const signals = readJSON('signals.json', []);
  const start = botStart(signals);
  const fresh = [], skipped = [];
  const learned = model && model.ready;
  for (const e of found.sort((a, b) => a.t - b.t)) {
    const key = eventId(e.instId, e);
    if (state.sent[key] || journal.has(key)) continue;     // đã xử lý ở lượt trước
    e._key = key;
    if (learned) { e.p = predict(model, e.f); e.ev = evOf(e.p); e.showScore = !!model.filtering; }
    let why = null;
    if (!ALERTS.includes(e.type)) why = 'loại thông báo đang tắt';
    else if (e.line.span < MIN_SPAN_ALERT) why = `mô hình nhỏ hơn ${MIN_SPAN_ALERT} nến`;
    else if (e.type === 'BREAK') {
      const lb = state.lastBreak[e.instId + '|' + e.side];
      if (lb && e.t - lb.t <= COOLDOWN * HOUR && e.line.span < 2 * lb.span) why = 'vừa báo phá cùng chiều';
    }
    if (!why && learned && model.filtering && e.ev < LEARN.EV_MIN) why = 'bot chấm kỳ vọng thấp';
    state.sent[key] = Date.now();
    if (why) { e.why = why; skipped.push(e); log(`  không đẩy ${e.coin} ${e.type} ${e.dir}: ${why}${e.ev != null ? ` (${fmtR(e.ev)})` : ''}`); continue; }
    if (e.type === 'BREAK') state.lastBreak[e.instId + '|' + e.side] = { t: e.t, span: e.line.span };
    fresh.push(e);
  }

  const batches = plan(fresh);
  let sentN = 0;
  for (const b of batches) {
    log(`${b.msg.title} — ${b.msg.body.replace(/\n/g, ' / ')}`);
    const okN = devices.length ? await pushAll(b.msg) : 0;
    if (okN) sentN++;
    for (const e of b.events) { e._pu = devices.length ? (b.summary ? 2 : 1) : 0; e._okN = okN; }
  }
  if (!devices.length && fresh.length) log('Chưa có máy nào (PUSH_CONFIG trống) — tín hiệu chỉ được lưu, không gửi.');
  state.lastCandle = target;
  status.sent = sentN; status.signals = fresh.length; status.skipped = skipped.length; status.pushes = batches.length;
  status.pushDoneAfterCloseMs = Date.now() - (target + HOUR);
  log(`Gửi xong: ${fresh.length} tín hiệu, ${batches.length} thông báo, gửi được ${sentN}, không đẩy ${skipped.length}. Báo sau khi nến đóng ${(status.pushDoneAfterCloseMs / 1000).toFixed(1)} giây.`);

  // ===== từ đây trở đi thông báo đã đi rồi: ghi nhớ và học, không ảnh hưởng tốc độ báo =====
  for (const e of [...fresh, ...skipped]) {
    const pu = e._pu ?? 0;
    journal.add(makeRow(e.instId, e.coin, e, e.f, { p: r3(e.p), ev: r3(e.ev), pu, why: e.why || null }));
    signals.unshift({
      id: e._key, instId: e.instId, coin: e.coin, type: e.type, dir: e.dir, side: e.side,
      t: e.t, close: e.close, atr: +e.atr.toPrecision(6), linePrice: e.linePrice, level: e.level, confirmed: e.confirmed,
      others: e.others, tickSz: e.tickSz, line: e.line,
      sentAt: Date.now(), pushed: e._okN || 0, pu, via: pu === 2 ? 'summary' : pu === 1 ? 'single' : null,
      why: e.why || null, p: r3(e.p), ev: r3(e.ev), f: e.f,
    });
  }

  // chấm lại tín hiệu cũ — cần nến của cả những đồng đã rơi khỏi top 50
  const extra = journal.pendingInsts().filter(id => !data[id]).slice(0, 25);
  if (extra.length) await pool(extra.map(instId => ({ instId })), async u => { data[u.instId] = (await okx.candles(u.instId, '1H', 120)).K; });
  const resolved = journal.evaluate(data);
  if (resolved) log(`Chấm kết quả: ${resolved} tín hiệu vừa ngã ngũ`);

  // nhật ký trống (lần đầu, hoặc mất dữ liệu) → tự chạy lại quá khứ
  if (journal.rows.length < 50 && (!state.bootAt || Date.now() - state.bootAt > 6 * HOUR)) await bootstrap(universe, signals);

  // dọn bộ nhớ chống trùng cũ hơn 20 ngày
  const old = Date.now() - 20 * 24 * HOUR;
  for (const [k, v] of Object.entries(state.sent)) if (v < old) delete state.sent[k];
  for (const [k, v] of Object.entries(state.lastBreak)) if (v.t < old) delete state.lastBreak[k];

  learn(signals);
  status.botStart = start;
  finish({ result: 'ok' });
}

main().catch(e => {
  log('LỖI:', e.stack || e.message || e);
  finish({ result: 'error', error: String(e.message || e) });
  process.exitCode = 1;
});
