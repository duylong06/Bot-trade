// bot/keo.mjs — bot thông báo Kèo Pro.
//
// Chạy trên GitHub Actions mỗi 30 phút. Quét 4 đồng (BTC, ETH, SOL, BNB) trên khung M30, H1 và H4,
// chạy bộ máy core/keopro.js, và chỉ đẩy thông báo cho kèo hạng A+ hoặc A không dính cờ xấu.
// Mỗi (đồng, khung) chỉ giữ MỘT kèo cùng lúc, giống luật của chỉ báo: có kèo đang chạy thì
// tín hiệu mới bị bỏ qua. Kèo đang chạy được theo dõi và báo tiếp khi chạm TP1 / TP2 / SL.
//
// Biến môi trường:
//   PUSH_CONFIG  mã app tạo khi bấm "Bật thông báo" (chứa khoá VAPID riêng của bot) — GitHub Secret
//   MODE         scan (mặc định) · test-push · dry-run (quét, in ra, không gửi, không ghi trạng thái)
//                · reset-open (xoá kèo đang giữ, giữ danh sách máy nhận)
//   GRADES       hạng được đẩy, mặc định 'A+,A'. Đặt 'A+' nếu chỉ muốn kèo mạnh nhất.
//
// Trạng thái nằm ở nhánh data (state-keo.json). Không có thì bot chạy như lần đầu.

import fs from 'node:fs';
import crypto from 'node:crypto';
import webpush from 'web-push';
import { keoPro, atr } from '../core/keopro.js';

const API = 'https://www.okx.com';
const PAGES = 'https://duylong06.github.io/Bot-trade/';
const NTFY = 'https://ntfy.sh/bottrade-duylong06-7f3k9q2m';
const DATA = 'https://raw.githubusercontent.com/duylong06/Bot-trade/data/';
const COINS = (process.env.COINS || 'BTC,ETH,SOL,BNB').split(',').map(s => s.trim()).filter(Boolean);
// htf = khung lớn mà bản Pine lấy cho chart đó · oi = độ mịn chuỗi OI · stop = số nến quá hạn
// (bản Pine: intraday 60 giờ, swing 240 giờ, chia cho độ dài nến)
const TFS = [
  { k: '30m', sec: 1800, label: 'M30', htf: '4H', oi: '5m', stop: 120, back: 5 },
  { k: '1H', sec: 3600, label: 'H1', htf: '4H', oi: '1H', stop: 60, back: 4 },
  { k: '4H', sec: 14400, label: 'H4', htf: '1Dutc', oi: '1H', stop: 60, back: 2 },
];
const MODE = process.env.MODE || 'scan';
// hạng tối thiểu để đẩy thông báo: A+ (điểm ≥ 5/7) hoặc A (≥ 3/7)
const GRADES = new Set((process.env.GRADES || 'A+,A').split(',').map(s => s.trim()).filter(Boolean));
const t0 = Date.now();
const log = (...a) => console.log(...a);
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const vn = t => new Date(t + 7 * 3600e3).toISOString().slice(5, 16).replace('T', ' ');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt = (p) => p >= 1000 ? p.toFixed(0) : p >= 10 ? p.toFixed(2) : p >= 1 ? p.toFixed(3) : p.toFixed(5);
const pct = (a, b) => ((a / b - 1) * 100).toFixed(2) + '%';

/* ---------------- OKX ---------------- */
async function okx(path, q, tries = 4) {
  const u = API + path + '?' + new URLSearchParams(q);
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const j = await r.json();
      if (j.code === '0') return j.data;
      log('  okx', path, j.code, j.msg);
    } catch (e) { log('  okx lỗi mạng', path, String(e.message)); }
    await sleep(900);
  }
  return null;
}
/** Nến ĐÃ ĐÓNG, cũ → mới. OKX đánh dấu nến đang chạy bằng cột thứ 9 = '0'. */
async function candles(inst, bar, pages = 3) {
  let all = [], after;
  for (let p = 0; p < pages; p++) {
    const q = { instId: inst, bar, limit: '100' }; if (after) q.after = after;
    const d = await okx('/api/v5/market/history-candles', q);
    if (!d || !d.length) break;
    all = all.concat(d); after = d[d.length - 1][0];
    await sleep(220);
  }
  const rows = all.filter(r => r[8] === '1').reverse().map(r => r.map(Number));
  return { t: rows.map(r => r[0]), o: rows.map(r => r[1]), h: rows.map(r => r[2]), l: rows.map(r => r[3]), c: rows.map(r => r[4]), v: rows.map(r => r[5]) };
}
async function oiSeries(inst, period, pages = 2) {
  let out = [], end;
  for (let p = 0; p < pages; p++) {
    const q = { instId: inst, period, limit: '100' }; if (end) q.end = end;
    const d = await okx('/api/v5/rubik/stat/contracts/open-interest-history', q);
    if (!d || !d.length) break;
    out = out.concat(d.map(r => [+r[0], +r[3]]));
    end = d[d.length - 1][0];
    await sleep(350);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/* ---------------- trạng thái ---------------- */
async function loadState() {
  // Trong chế độ chạy liên tục, bot quét nhiều lượt trong cùng một job. Nhánh data đi qua
  // CDN nên đọc lại ngay sau khi ghi có thể ra bản cũ — vì vậy ưu tiên file ngay tại máy.
  try {
    if (fs.existsSync('out/state-keo.json')) {
      const st = JSON.parse(fs.readFileSync('out/state-keo.json', 'utf8'));
      log('trạng thái: lấy từ lượt quét trước trong cùng job');
      return st;
    }
  } catch (e) { log('trạng thái tại máy đọc lỗi, lấy từ nhánh data:', e.message); }
  try {
    const r = await fetch(DATA + 'state-keo.json', { cache: 'no-store' });
    if (r.ok) return await r.json();
  } catch {}
  return {};
}

/* ---------------- gửi thông báo ---------------- */
function parseSecret(raw) {
  if (!raw || !raw.trim()) return [];
  let items = [];
  try { const j = JSON.parse(raw); items = Array.isArray(j) ? j : [j]; }
  catch { items = (raw.match(/\{[^\n]*\}/g) || []).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean); }
  return items.filter(x => x && x.sub && x.sub.endpoint && x.vapid && x.vapid.pub && x.vapid.priv)
    .map(x => ({ ...x, id: sha(x.sub.endpoint), src: 'secret' }));
}
const secret = parseSecret(process.env.PUSH_CONFIG);
const keys = new Map(secret.map(d => [d.vapid.pub, d.vapid]));
const PUSH_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)\//;

/** App gửi đăng ký mới qua ntfy; chỉ nhận đăng ký dùng đúng khoá công khai của bot. */
async function intake(state) {
  if (!keys.size) return;
  state.subs ||= {}; state.dead ||= {};
  try {
    const since = state.ntfySince ? String(state.ntfySince + 1) : '24h';
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(`${NTFY}/json?poll=1&since=${since}`, { signal: ctl.signal }).finally(() => clearTimeout(tm));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    let n = 0;
    for (const line of (await r.text()).split('\n')) {
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.event !== 'message') continue;
      state.ntfySince = Math.max(state.ntfySince || 0, m.time || 0);
      let j; try { j = JSON.parse(m.message); } catch { continue; }
      const ep = j?.sub?.endpoint;
      if (!ep || !PUSH_HOSTS.test(ep) || !j.sub.keys?.p256dh || !j.sub.keys?.auth || !keys.has(j.pub)) continue;
      if (state.dead[sha(ep)]) continue;
      state.subs[sha(ep)] = { sub: { endpoint: ep, keys: { p256dh: j.sub.keys.p256dh, auth: j.sub.keys.auth } }, pub: j.pub, name: String(j.name || 'iPhone').slice(0, 40), at: (m.time || 0) * 1000 };
      n++;
    }
    const ids = Object.keys(state.subs).sort((a, b) => state.subs[b].at - state.subs[a].at);
    for (const id of ids.slice(8)) delete state.subs[id];
    if (n) log(`Nhận ${n} đăng ký mới từ app`);
  } catch (e) { log('  ntfy:', e.message); }
}
function devices(state) {
  const out = new Map(secret.filter(d => !state.dead?.[d.id]).map(d => [d.id, d]));
  for (const [id, s] of Object.entries(state.subs || {})) {
    const v = keys.get(s.pub);
    if (v && !out.has(id) && !state.dead?.[id]) out.set(id, { id, name: s.name, sub: s.sub, vapid: v, src: 'app' });
  }
  return [...out.values()];
}
async function push(state, title, body, tag) {
  if (MODE === 'dry-run') { log(`\n[KHÔNG GỬI] ${title}\n${body}\n`); return 0; }
  const list = devices(state);
  if (!list.length) { log('  chưa có máy nào đăng ký nhận thông báo'); return 0; }
  const payload = JSON.stringify({ web_push: 8030, notification: { title, body, navigate: PAGES, tag, lang: 'vi', silent: false } });
  let ok = 0;
  for (const d of list) {
    try {
      await webpush.sendNotification(d.sub, payload, { TTL: 3600, urgency: 'high', vapidDetails: { subject: PAGES, publicKey: d.vapid.pub, privateKey: d.vapid.priv } });
      ok++;
    } catch (e) {
      log(`  gửi lỗi ${e.statusCode || 0}`, String(e.body || e.message).slice(0, 120));
      if (e.statusCode === 404 || e.statusCode === 410) { state.dead ||= {}; state.dead[d.id] = Date.now(); delete state.subs?.[d.id]; }
    }
  }
  log(`  → gửi ${ok}/${list.length} máy`);
  return ok;
}

/* ---------------- nội dung thông báo ---------------- */
function bodyOf(coin, tf, r, s, htfLabel) {
  const d = s.dir > 0 ? 'MUA' : 'BÁN';
  const L = [];
  L.push(`${d} ${coin} ${tf} · ${s.kindName} · hạng ${s.grade} (${s.score >= 0 ? '+' : '−'}${Math.abs(s.score)}/7) · ${r.styleTxt}`);
  L.push(`Vì sao: ${s.why}`);
  L.push('');
  L.push(`Vào ${fmt(s.e1)}${s.p1 > 0 ? ` (${Math.round(s.p1 * 100)}% ngay)` : ' — chờ hết ở vùng'}`);
  if (s.p1 < 1) L.push(`Còn ${Math.round((1 - s.p1) * 100)}% chờ ở vùng ${fmt(s.zB)}–${fmt(s.zT)}`);
  L.push(`SL ${fmt(s.sl)} (${pct(s.sl, s.e1)}) · TP1 ${fmt(s.tp1)} (${pct(s.tp1, s.e1)}) · TP2 ${fmt(s.tp2)} (${pct(s.tp2, s.e1)})`);
  L.push(`R:R sau phí 1:${s.rr.toFixed(2)} · ATR ${r.atrPct.toFixed(2)}%`);
  L.push('');
  L.push('Chỉ số:');
  for (const w of s.whyList) L.push('  ' + w);
  L.push('');
  const flow = [];
  if (r.volX != null) flow.push(`volume ${r.volX.toFixed(2)}× trung bình`);
  flow.push(`${r.buyPct.toFixed(0)}% khối lượng 20 nến thuộc nến tăng`);
  if (Number.isFinite(r.oiChg)) flow.push(`OI ${r.oiChg >= 0 ? '+' : '−'}${Math.abs(r.oiChg).toFixed(1)}%/24h`);
  L.push('Dòng tiền: ' + flow.join(' · '));
  const lv = [];
  if (Number.isFinite(r.res1)) lv.push(`kháng cự ${fmt(r.res1)} (${pct(r.res1, r.px)})`);
  if (Number.isFinite(r.sup1)) lv.push(`hỗ trợ ${fmt(r.sup1)} (${pct(r.sup1, r.px)})`);
  if (lv.length) L.push('Mốc gần: ' + lv.join(' · '));
  L.push(`Khung ${htfLabel}: ${r.htf.tr === 1 ? 'TĂNG' : r.htf.tr === -1 ? 'GIẢM' : 'chưa rõ'} · EMA ${r.htf.ema === 1 ? 'xếp tăng' : r.htf.ema === -1 ? 'xếp giảm' : 'đan xen'}`);
  if (s.grade === 'A') L.push('Hạng A — yếu hơn A+, cân nhắc giảm khối lượng.');
  L.push('');
  L.push('Luật máy — không phải lời khuyên đầu tư.');
  return L.join('\n');
}

/* ---------------- bù lượt bị bỏ ----------------
   Lịch GitHub Actions hay bị bỏ (repo này có lúc chỉ chạy 1 trong 17 lượt), nên khi bot
   chạy được thì soi lại vài nến đã đóng gần nhất chứ không chỉ nến cuối. Kèo tìm thấy ở
   nến cũ chỉ còn giá trị nếu giá chưa chạm SL và chưa chạm TP1 — chỉ báo cũng cho phép
   chờ ở vùng (intraday 16 giờ, swing 72 giờ), nên kèo trễ vài nến vẫn vào được. */
const cut = (K, b) => b === 0 ? K : {
  t: K.t.slice(0, -b), o: K.o.slice(0, -b), h: K.h.slice(0, -b),
  l: K.l.slice(0, -b), c: K.c.slice(0, -b), v: K.v.slice(0, -b),
};
// kèo mở ở nến `bi` còn vào được không: xét các nến sau nó
function stillOk(K, bi, s) {
  const i0 = K.t.indexOf(bi);
  if (i0 < 0) return { ok: false, lý: 'không tìm thấy nến' };
  for (let i = i0 + 1; i < K.c.length; i++) {
    if (s.dir > 0 ? K.l[i] <= s.sl : K.h[i] >= s.sl) return { ok: false, lý: 'đã chạm SL' };
    if (s.dir > 0 ? K.h[i] >= s.tp1 : K.l[i] <= s.tp1) return { ok: false, lý: 'đã chạm TP1' };
  }
  return { ok: true };
}

/* ---------------- theo dõi kèo đang chạy ---------------- */
function track(open, K, stop) {
  // trả danh sách sự kiện mới kể từ nến `open.lastBar`
  const ev = [];
  const i0 = K.t.findIndex(t => t > open.lastBar);
  if (i0 < 0) return ev;
  for (let i = i0; i < K.c.length; i++) {
    const up = open.dir > 0;
    const hitSL = up ? K.l[i] <= open.sl : K.h[i] >= open.sl;
    const hitT1 = up ? K.h[i] >= open.tp1 : K.l[i] <= open.tp1;
    const hitT2 = up ? K.h[i] >= open.tp2 : K.l[i] <= open.tp2;
    if (hitSL) { ev.push({ k: 'SL', t: K.t[i], px: open.sl }); open.done = true; break; }
    if (!open.t1 && hitT1) { open.t1 = true; open.sl = open.e1; ev.push({ k: 'TP1', t: K.t[i], px: open.tp1 }); }
    if (open.t1 && hitT2) { ev.push({ k: 'TP2', t: K.t[i], px: open.tp2 }); open.done = true; break; }
    open.bars = (open.bars || 0) + 1;
    open.lastBar = K.t[i];
    if (open.bars >= stop) { ev.push({ k: 'HẠN', t: K.t[i], px: K.c[i] }); open.done = true; break; }
  }
  open.lastBar = K.t[K.c.length - 1];
  return ev;
}

/* ---------------- chạy ---------------- */
const state = await loadState();
state.open ||= {}; state.sent ||= {}; state.subs ||= {}; state.dead ||= {};
await intake(state);
log(`Kèo Pro · ${MODE} · ${vn(t0)} giờ VN · ${COINS.join(' ')} · ${TFS.map(t => t.label).join(' ')} · hạng ${[...GRADES].join('/')} · máy nhận: ${devices(state).length}`);

if (MODE === 'reset-open') {
  const n = Object.keys(state.open).length;
  state.open = {}; state.sent = {};
  log(`đã xoá ${n} kèo đang giữ · giữ lại ${devices(state).length} máy nhận`);
} else if (MODE === 'test-push') {
  await push(state, '🔔 Thử thông báo Kèo Pro', `Bot chạy lúc ${vn(t0)} giờ VN.\nTheo dõi ${COINS.join(', ')} trên khung ${TFS.map(t => t.label).join(', ')}, báo kèo hạng ${[...GRADES].join(' và ')}.`, 'test');
} else {
  const report = [];
  for (const coin of COINS) {
    const inst = `${coin}-USDT-SWAP`;
    const HC = new Map();                        // khung lớn, lấy một lần rồi dùng lại
    for (const tf of TFS) {
      const key = `${coin}|${tf.k}`;
      if (!HC.has(tf.htf)) HC.set(tf.htf, await candles(inst, tf.htf, 3));
      const H = HC.get(tf.htf);
      if (H.c.length < 160) { log(`${key}: thiếu nến khung lớn ${tf.htf} (${H.c.length})`); continue; }
      const K = await candles(inst, tf.k, 3);
      if (K.c.length < 220) { log(`${key}: thiếu nến (${K.c.length})`); continue; }
      const OI = await oiSeries(inst, tf.oi, 2);

      // 1) theo dõi kèo đang chạy
      const open = state.open[key];
      if (open) {
        for (const e of track(open, K, tf.stop)) {
          const r = ((e.k === 'SL' ? -1 : e.k === 'TP1' ? 1 : e.k === 'TP2' ? 3 : 0)).toFixed(0);
          const icon = e.k === 'SL' ? '🛑' : e.k === 'TP2' ? '🎯' : e.k === 'TP1' ? '✅' : '⏱';
          await push(state,
            `${icon} ${coin} ${tf.label} · ${e.k}`,
            `Kèo ${open.dir > 0 ? 'MUA' : 'BÁN'} ${open.kindName} ${open.grade} mở lúc ${vn(open.at)}.\n` +
            `${e.k === 'TP1' ? 'Chốt 50%, dời SL về hoà vốn ' + fmt(open.e1) + '.' : e.k === 'TP2' ? 'Chốt nốt phần còn lại.' : e.k === 'SL' ? 'Dừng lỗ, đóng kèo.' : 'Kèo quá hạn, đóng.'}\n` +
            `Giá ${fmt(e.px)} lúc ${vn(e.t)} giờ VN.`,
            `${key}|${e.k}`);
          log(`  ${key}: ${e.k} @ ${fmt(e.px)}`);
        }
        if (open.done) delete state.open[key];
      }

      // 2) tín hiệu mới — chỉ khi không có kèo đang chạy, soi từ nến mới nhất lùi dần
      let r0 = null, hit = null;
      for (let b = 0; b < tf.back; b++) {
        const Kb = cut(K, b);
        if (Kb.c.length < 220) break;
        const Hb = b === 0 ? H : { t: [], o: [], h: [], l: [], c: [], v: [] };
        if (b > 0) { const lim = Kb.t[Kb.t.length - 1]; for (let i = 0; i < H.t.length; i++) if (H.t[i] <= lim) { Hb.t.push(H.t[i]); Hb.o.push(H.o[i]); Hb.h.push(H.h[i]); Hb.l.push(H.l[i]); Hb.c.push(H.c[i]); Hb.v.push(H.v[i]); } }
        if (Hb.c.length < 160) break;
        const rb = keoPro(Kb, Hb, OI, tf.sec);
        if (rb.err) { if (b === 0) log(`${key}: ${rb.err}`); break; }
        if (b === 0) r0 = rb;
        const sb = rb.sig;
        if (!sb || !GRADES.has(sb.grade) || sb.bad) continue;
        if (state.sent[`${key}|${rb.bar}`]) continue;
        const v = stillOk(K, rb.bar, sb);
        if (!v.ok) { log(`  ${key}: ${sb.kindName} ${sb.grade} ở nến ${vn(rb.bar)} — bỏ, ${v.lý}`); continue; }
        hit = { r: rb, s: sb, b }; break;
      }
      const s0 = r0 && r0.sig;
      report.push(`${key} ${r0 ? fmt(r0.px) : '?'} ${s0 ? `${s0.dir > 0 ? 'MUA' : 'BÁN'} ${s0.kindName} ${s0.grade} ${s0.score}/7 bad=${s0.bad}` : 'không có tín hiệu'}${hit && hit.b > 0 ? ` · bù nến ${vn(hit.r.bar)}` : ''}`);
      if (!hit) continue;
      if (state.open[key]) { log(`  ${key}: có tín hiệu ${hit.s.grade} nhưng đang giữ kèo khác, bỏ qua`); continue; }
      const { r, s, b: lag } = hit;
      state.sent[`${key}|${r.bar}`] = t0;
      state.open[key] = { dir: s.dir, kind: s.kind, kindName: s.kindName, grade: s.grade, e1: s.e1, sl: s.sl, tp1: s.tp1, tp2: s.tp2, at: r.bar, lastBar: r.bar, bars: 0, t1: false };
      await push(state,
        `${s.dir > 0 ? '🟢' : '🔴'} ${coin} ${tf.label} · ${s.dir > 0 ? 'MUA' : 'BÁN'} ${s.grade} · ${s.kindName}`,
        bodyOf(coin, tf.label, r, s, tf.htf === '1Dutc' ? '1D' : tf.htf) +
          (lag ? `\n\nNến xác nhận đóng lúc ${vn(r.bar)} giờ VN (${lag} nến trước, giá nay ${fmt(r0 ? r0.px : s.e1)}) — lịch chạy bị trễ. Giá chưa chạm SL hay TP1 nên vùng chờ vẫn còn.` : ''),
        key);
      log(`  ${key}: ★ ${s.dir > 0 ? 'MUA' : 'BÁN'} ${s.kindName} ${s.grade} ${s.score}/7 R:R ${s.rr.toFixed(2)}${lag ? ` (bù ${lag} nến)` : ''}`);
    }
  }
  log('\n--- tổng kết lượt quét');
  for (const line of report) log('  ' + line);
}

for (const [k, v] of Object.entries(state.sent)) if (t0 - v > 14 * 24 * 3600e3) delete state.sent[k];
fs.mkdirSync('out', { recursive: true });
// dry-run chỉ để xem, không được ghi trạng thái: nếu ghi thì các kèo vừa thấy bị coi là
// "đang giữ" và lượt quét thật sau đó sẽ bỏ qua, người dùng mất thông báo vào lệnh.
if (MODE === 'dry-run') log('dry-run: không ghi trạng thái');
else fs.writeFileSync('out/state-keo.json', JSON.stringify(state));
fs.writeFileSync('out/status-keo.json', JSON.stringify({
  at: new Date().toISOString(), mode: MODE, coins: COINS, tfs: TFS.map(t => t.label), grades: [...GRADES],
  open: state.open, devices: devices(state).length, tookMs: Date.now() - t0,
}, null, 1));
log(`\nXong sau ${((Date.now() - t0) / 1000).toFixed(0)}s · kèo đang giữ: ${Object.keys(state.open).length}`);
