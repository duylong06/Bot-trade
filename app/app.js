// app/app.js — điều khiển giao diện: tab, biểu đồ, tín hiệu, top 50, thông báo, tình trạng bot.
import * as okx from '../core/okx.js';
import { CFG, HOUR, lineAt } from '../core/breakout.js';
import { REPO, TOP_N, PINNED, DATA_API, DATA_RAW, ALERTS, MIN_SPAN_ALERT } from '../core/config.js';
import { fmtPrice, fmtVol, fmtPct, hhmm, ddmm, coinOf, labelOf, nameOf } from '../core/format.js';
import { ChartView, TFS } from './chart.js';
import { businessWS, publicWS } from './ws.js';
import * as push from './push.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem('bt.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('bt.' + k, JSON.stringify(v)); } catch {} },
};
const TYPE = { BREAK: 'Phá', RETEST: 'Retest', CONFIRM: 'Xác nhận' };
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '');
const pushedOf = s => (s.pu ?? (s.pushed > 0 ? 1 : 0)) > 0;
const ago = ms => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'vừa xong' : m < 60 ? `${m} phút trước` : m < 1440 ? `${Math.floor(m / 60)} giờ ${m % 60} phút trước` : `${Math.floor(m / 1440)} ngày trước`; };

const S = {
  tab: 'chart',
  inst: LS.get('inst', 'BTC-USDT-SWAP'),
  tf: LS.get('tf', '1H'),
  ticks: {}, allow: null, all: [], markets: [], mkMap: new Map(), tickSubs: new Set(),
  signals: [], status: null, sigFilter: 'all', seen: LS.get('seen', 0),
  sigMap: new Map(), markMap: new Map(), dataAt: 0,
  config: null, devId: null,
};
let chart, bws, pws;

function toast(msg, ms = 2400) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Đã sao chép'); }
  catch { toast('Không chép tự động được — nhấn giữ đoạn mã để chép'); }
}

/* ======================= TAB ======================= */

function showTab(tab) {
  S.tab = tab;
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== 'v-' + tab;
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
  if (tab === 'signals') { renderSignals(); markSeen(); loadData(); }
  if (tab === 'markets') renderMarkets();
  if (tab === 'settings') { renderPush(); renderBot(); loadData(); }
}

/* ======================= GIÁ ======================= */

function setHeader() {
  const c = coinOf(S.inst);
  $('#symCoin').textContent = c;
  $('#symSub').textContent = nameOf(c) ? `${nameOf(c)} · USDT vĩnh cửu` : 'USDT · Vĩnh cửu';
  const m = S.mkMap.get(S.inst);
  if (m && isFinite(m.last)) {
    $('#px').textContent = fmtPrice(m.last, S.ticks[S.inst]);
    const ch = $('#chg');
    ch.textContent = fmtPct(m.chg);
    ch.className = 'chg ' + (m.chg >= 0 ? 'up' : 'down');
    $('#px').className = 'px ' + (m.chg >= 0 ? 'up' : 'down');
  }
}

function onTicker(data) {
  for (const x of data) {
    const last = +x.last, open = +x.open24h;
    const m = S.mkMap.get(x.instId) || { instId: x.instId, coin: coinOf(x.instId) };
    m.last = last; m.open24h = open; m.chg = open ? (last - open) / open : 0;
    if (+x.volCcy24h) m.volUsd = +x.volCcy24h * last;
    S.mkMap.set(x.instId, m);
    if (x.instId === S.inst) setHeader();
    if (S.tab === 'markets') updateMarketRow(m);
  }
}

function subscribeTickers() {
  const want = new Set([...S.markets.map(m => m.instId), S.inst]);
  for (const id of [...S.tickSubs]) if (!want.has(id)) { pws.unsub({ channel: 'tickers', instId: id }); S.tickSubs.delete(id); }
  for (const id of want) if (!S.tickSubs.has(id)) { pws.sub({ channel: 'tickers', instId: id }, onTicker); S.tickSubs.add(id); }
}

async function loadMarkets() {
  try {
    const list = await okx.swapTickers(S.allow);
    S.all = list;
    S.markets = okx.pickUniverse(list);
    // vàng, dầu lên đầu danh sách
    S.markets.sort((a, b) => PINNED.includes(b.instId) - PINNED.includes(a.instId));
    for (const m of list) S.mkMap.set(m.instId, { ...(S.mkMap.get(m.instId) || {}), ...m });
    subscribeTickers();
    setHeader();
    if (S.tab === 'markets') renderMarkets();
  } catch (e) {
    if (S.tab === 'markets') $('#mkList').innerHTML = `<div class="empty">Không tải được danh sách từ OKX.<br>${esc(e.message)}</div>`;
  }
}

/* ======================= BIỂU ĐỒ ======================= */

function initChart() {
  $('#tfs').innerHTML = TFS.map(t => `<button class="tf${t.id === S.tf ? ' on' : ''}" data-tf="${t.id}" role="tab">${t.label}</button>`).join('');
  $('#tfs').addEventListener('click', e => {
    const b = e.target.closest('[data-tf]'); if (!b) return;
    S.tf = b.dataset.tf; LS.set('tf', S.tf);
    for (const x of document.querySelectorAll('.tf')) x.classList.toggle('on', x === b);
    chart.open(S.inst, S.ticks[S.inst], S.tf, chart.focus);
  });
  $('#tgLines').addEventListener('click', e => {
    const on = !e.currentTarget.classList.contains('on');
    e.currentTarget.classList.toggle('on', on);
    e.currentTarget.setAttribute('aria-pressed', on);
    chart.setShow('lines', on);
  });

  chart = new ChartView($('#chart'), bws, {
    onPrice: p => { const m = S.mkMap.get(S.inst); if (m) { m.last = p; if (m.open24h) m.chg = (p - m.open24h) / m.open24h; setHeader(); } },
    onLegend: renderLegend,
    onLines: (res, fm) => renderLines(res, fm),
    // mũi tên trên biểu đồ: tín hiệu này bot đã đẩy chưa, kết quả ra sao
    eventInfo: id => S.sigMap.get(id) || S.markMap.get(id) || null,
    onStatus: (st, msg) => {
      const el = $('#chartStatus');
      if (st === 'loading') { el.hidden = false; el.textContent = `Đang tải ${coinOf(S.inst)}…`; }
      else if (st === 'error') { el.hidden = false; el.textContent = `Không tải được dữ liệu OKX: ${msg}`; }
      else el.hidden = true;
    },
  });
  setInterval(() => {   // đếm ngược tới lúc nến đóng + nút "Tự căn" khi trục giá bị kéo tay
    if (!chart) return;
    chart.legend(null);
    const b = $('#autoBtn'), off = !chart.isAuto();
    if (b.hidden === off) b.hidden = !off;
  }, 1000);
  $('#autoBtn').addEventListener('click', () => { chart.autoFit(); $('#autoBtn').hidden = true; });
}

function openSymbol(inst, focus = null) {
  S.inst = inst; LS.set('inst', inst);
  if (focus && S.tf !== '1H') {
    S.tf = '1H'; LS.set('tf', '1H');
    for (const x of document.querySelectorAll('.tf')) x.classList.toggle('on', x.dataset.tf === '1H');
  }
  setHeader();
  subscribeTickers();
  if (chart.inst !== inst) {
    $('#legend').innerHTML = '';
    setLines(`<div class="lrow"><span></span><span class="t1 muted">Đang tìm trendline của ${esc(coinOf(inst))}…</span></div>`);
  }
  chart.open(inst, S.ticks[inst], S.tf, focus);
}

// Chỉ ghi lại khi nội dung đổi — không làm khung đường nhảy/giật mỗi 2 giây.
let linesHtml = '';
function setLines(html) { if (html !== linesHtml) { linesHtml = html; $('#lines').innerHTML = html; } }

function renderLegend(d) {
  const tick = S.ticks[S.inst], p = v => fmtPrice(v, tick);
  const chg = d.o ? (d.c - d.o) / d.o : 0;
  const cls = d.c >= d.o ? 'up' : 'down';
  const mm = Math.max(0, Math.floor(d.closeIn / 60000)), ss = Math.max(0, Math.floor(d.closeIn / 1000) % 60);
  const cd = d.live ? ` · <span class="cd">đóng nến sau ${mm >= 60 ? Math.floor(mm / 60) + ':' + String(mm % 60).padStart(2, '0') : mm}:${String(ss).padStart(2, '0')}</span>` : '';
  $('#legend').innerHTML =
    `O <b>${p(d.o)}</b> H <b>${p(d.h)}</b> L <b>${p(d.l)}</b> C <b class="${cls}">${p(d.c)}</b> <span class="${cls}">${fmtPct(chg)}</span><br>` +
    `<span class="ema">EMA200 ${d.ema != null ? p(d.ema) : '—'}</span>${cd}`;
  const f = v => (v == null ? '—' : v.toFixed(2));
  const lbl = $('#stochLbl');
  lbl.innerHTML = `Stoch <span class="y">32 13 5 · ${f(d.kY)} ${f(d.dY)}</span>  <span class="r">10 5 5 · ${f(d.kR)} ${f(d.dR)}</span>`;
  try { lbl.style.top = (chart.chart.paneSize(0).height + 5) + 'px'; } catch {}
  throttleLines();
}

let linesTimer = 0;
function throttleLines() {
  if (linesTimer) return;
  linesTimer = setTimeout(() => { linesTimer = 0; if (chart && chart.res) renderLines(chart.res, chart.focusMatch); }, 2000);
}

function renderLines(res, fm) {
  const tick = S.ticks[S.inst], p = v => fmtPrice(v, tick);
  const price = chart.livePrice();
  const now = Date.now();
  let html = '';
  if (fm) {
    const e = fm.ev, ln = fm.line;
    html += `<div class="banner">${fm.found
      ? `Đang xem: ${TYPE[e.type]} ${e.dir} · ${esc(cap(ln.kind))} ${ln.span} nến · nến H1 ${hhmm(e.t)} ${ddmm(e.t)}`
      : `Tín hiệu này đã ra khỏi 500 nến gần nhất — đang vẽ lại theo dữ liệu bot đã lưu.`}</div>`;
  }
  const lines = [...res.lines];
  if (fm && !lines.some(x => x.ta === fm.line.ta && x.tb === fm.line.tb)) lines.unshift(fm.line);
  lines.sort((a, b) => (a.tBreak != null) - (b.tBreak != null) || b.span - a.span);
  for (const ln of lines) {
    const isF = fm && ln.ta === fm.line.ta && ln.tb === fm.line.tb;
    const broken = ln.tBreak != null;
    const nowLine = lineAt(ln, now);
    const R = ln.side === 'R';
    let ic, t2, pr;
    if (broken) {
      ic = `<span class="${R ? 'up' : 'down'}">${R ? '▲' : '▼'}</span>`;
      t2 = `Phá ${hhmm(ln.tBreak)} ${ddmm(ln.tBreak)}` + (ln.tConfirm ? ' · đã gãy cấu trúc' : '') + (ln.tRetest ? ` · retest ${hhmm(ln.tRetest)}` : '') + (ln.tFail ? ' · phá hụt' : '');
      pr = p(lineAt(ln, ln.tBreak));
    } else {
      ic = `<span style="color:#2f7dff">━</span>`;
      const dist = price ? (price - nowLine) / nowLine : 0;
      const beyond = price && (R ? price > nowLine : price < nowLine);
      t2 = beyond ? `<span class="${R ? 'up' : 'down'}">Giá đang ở ngoài đường — chờ nến H1 đóng</span>` : `Đang giữ · giá cách đường ${(Math.abs(dist) * 100).toFixed(2)}%`;
      pr = p(nowLine);
    }
    html += `<button class="lrow${isF ? ' focus' : ''}" data-ta="${ln.ta}" data-tb="${ln.tb}" data-side="${ln.side}">
      <span class="ic">${ic}</span>
      <span class="t1">${esc(cap(ln.kind))} · ${ln.span} nến · ${ln.touches} chạm${ln.steep ? ' · dốc' : ''}</span>
      <span class="pr">${pr}</span>
      <span class="t2">${t2}</span>
    </button>`;
  }
  if (!lines.length) html += `<div class="lrow"><span></span><span class="t1 muted">Chưa thấy đường xu hướng đủ chuẩn trong 500 nến H1 gần nhất.</span></div>`;
  setLines(html);
}

/* ======================= DỮ LIỆU BOT ======================= */

const etags = {}, cache = {};
async function fetchData(name) {
  try {
    const h = { Accept: 'application/vnd.github.raw+json' };
    if (etags[name]) h['If-None-Match'] = etags[name];
    const r = await fetch(DATA_API + name + '?ref=data', { headers: h, cache: 'no-store' });
    if (r.status === 304 && cache[name]) return cache[name];
    if (r.ok) {
      const j = await r.json();
      etags[name] = r.headers.get('ETag'); cache[name] = j;
      return j;
    }
    if (r.status === 404) return null;
  } catch {}
  const r = await fetch(DATA_RAW + name + '?t=' + Math.floor(Date.now() / 60000), { cache: 'no-store' });
  if (!r.ok) return cache[name] || null;
  return (cache[name] = await r.json());
}

// Đọc status.json trước (nhỏ); chỉ khi bot vừa chạy xong lần mới thì mới tải tín hiệu và dấu biểu đồ.
let loading = null;
function loadData(force = false) {
  if (loading) return loading;
  loading = (async () => {
    try {
      const st = await fetchData('status.json');
      if (st) S.status = st;
      const key = st ? st.finishedAt || 1 : 0;
      if (force || !S.dataAt || key !== S.dataAt) {
        const [sig, marks] = await Promise.all(['signals.json', 'marks.json'].map(f => fetchData(f).catch(() => null)));
        if (Array.isArray(sig)) { S.signals = sig; S.sigMap = new Map(sig.map(x => [x.id, x])); S.dataAt = key; }
        if (marks && marks.m) {
          const m = new Map();
          for (const [inst, arr] of Object.entries(marks.m)) for (const [suf, pu] of arr) m.set(inst + '|' + suf, { pu });
          S.markMap = m;
        }
        if (chart && chart.res) chart.drawLines();
        if (S.tab === 'signals') { renderSignals(); markSeen(); }
        if (S.tab === 'markets') renderMarkets();
      }
      if (S.tab === 'settings') { renderBot(); renderPushStatus(); }
      updateBadges();
    } catch {} finally { loading = null; }
  })();
  return loading;
}

function updateBadges() {
  const n = S.signals.filter(s => s.sentAt > S.seen && pushedOf(s)).length;
  const b = $('#sigBadge');
  b.hidden = !n || S.tab === 'signals'; b.textContent = n > 99 ? '99+' : n;
  const last = S.status && (S.status.finishedAt || 0);
  $('#setBadge').hidden = !(last && Date.now() - last > 90 * 60000);
}

function markSeen() {
  const top = S.signals.reduce((m, s) => Math.max(m, s.sentAt || 0), 0);
  if (top > S.seen) { S.seen = top; LS.set('seen', top); }
  updateBadges();
}

/* ======================= TÍN HIỆU ======================= */

function renderSignals() {
  const f = S.sigFilter;
  const list = S.signals.filter(s => f === 'all' || (f === 'pushed' ? pushedOf(s) : s.dir === f || s.type === f));
  const ls = S.status && S.status.lastScan;
  $('#sigMeta').textContent = ls ? `bot quét lúc ${hhmm(ls.at)} · ${ls.counts ? ls.counts.coins : '?'} đồng` : '';
  if (!list.length) {
    $('#sigList').innerHTML = `<div class="empty">${S.signals.length ? 'Không có tín hiệu nào khớp bộ lọc.' : 'Chưa có tín hiệu nào.<br>Bot quét mỗi giờ khi nến H1 đóng; tín hiệu sẽ hiện ở đây và đẩy về điện thoại.'}</div>`;
    return;
  }
  let html = '', day = '';
  for (const s of list) {
    const d = ddmm(s.t);
    if (d !== day) { day = d; html += `<div class="dayhead">${d === ddmm(Date.now()) ? 'Hôm nay' : d}</div>`; }
    const up = s.dir === 'LONG', ln = s.line || {};
    const ds = `${esc(cap(ln.kind || ''))} · ${ln.span || '?'} nến · ${ln.touches || '?'} chạm` + (s.type === 'BREAK' ? (s.confirmed ? ' · đã gãy cấu trúc' : '') : '') + (ln.steep ? ' · dốc' : '');
    const pushed = pushedOf(s);
    const ex = pushed ? '' : `<span class="why">không đẩy: ${esc(s.why || (s.pu == null ? 'trước khi bot chạy' : 'chưa có máy nhận'))}</span>`;
    html += `<button class="srow${pushed ? '' : ' skip'}" data-id="${esc(s.id)}">
      <span class="tm">${hhmm(s.t)}</span>
      <span class="ti"><span class="co">${esc(labelOf(s.coin))}</span><span class="dir ${up ? 'up' : 'down'}">${up ? '▲ LONG' : '▼ SHORT'}</span><span class="ty ${s.type}">${TYPE[s.type] || s.type}</span></span>
      <span class="pr">${fmtPrice(s.close, s.tickSz)}</span>
      <span class="ds">${ds}</span>
      <span class="ex">${ex}</span>
    </button>`;
  }
  $('#sigList').innerHTML = html;
}

/* ======================= TOP 60 + VÀNG, DẦU ======================= */

function marketRow(m, sigDir) {
  const tick = S.ticks[m.instId];
  return `<button class="mrow" data-inst="${m.instId}">
    <span class="nm"><b>${esc(m.coin)}</b>${nameOf(m.coin) ? `<em>${esc(nameOf(m.coin))}</em>` : ''}${sigDir ? `<i class="${sigDir}">${sigDir === 'LONG' ? '▲' : '▼'} 24h</i>` : ''}<small>KL ${fmtVol(m.volUsd)}</small></span>
    <span class="p">${fmtPrice(m.last, tick)}</span>
    <span class="c ${m.chg >= 0 ? 'up' : 'down'}">${fmtPct(m.chg || 0)}</span>
  </button>`;
}

function recentDir(inst) {
  const s = S.signals.find(x => x.instId === inst && Date.now() - x.t < 24 * HOUR);
  return s ? s.dir : null;
}

function renderMarkets() {
  const q = ($('#search').value || '').trim().toUpperCase();
  const src = q ? S.all.filter(m => m.coin.includes(q) || (nameOf(m.coin) || '').toUpperCase().includes(q)).slice(0, 60) : S.markets;
  if (!src.length) { $('#mkList').innerHTML = `<div class="empty">${S.all.length ? 'Không tìm thấy.' : 'Đang tải danh sách…'}</div>`; return; }
  $('#mkList').innerHTML = src.map(m => marketRow(S.mkMap.get(m.instId) || m, recentDir(m.instId))).join('');
}

function updateMarketRow(m) {
  const el = document.querySelector(`.mrow[data-inst="${m.instId}"]`);
  if (!el) return;
  el.querySelector('.p').textContent = fmtPrice(m.last, S.ticks[m.instId]);
  const c = el.querySelector('.c');
  c.textContent = fmtPct(m.chg || 0);
  c.className = 'c ' + (m.chg >= 0 ? 'up' : 'down');
}

/* ======================= THÔNG BÁO ======================= */

async function renderPush() {
  const body = $('#pushBody');
  const repoSecret = `https://github.com/${REPO}/settings/secrets/actions/new`;

  if (push.isIOS() && !push.isStandalone()) {
    body.innerHTML = `<p>iPhone chỉ cho nhận thông báo khi app được <b>thêm vào Màn hình chính</b> và mở từ biểu tượng đó.</p>
      <div class="ios-steps">
        <div><b class="n">1</b><span>Bấm nút <b>Chia sẻ</b> <span class="muted">(ô vuông có mũi tên lên)</span> ở thanh dưới của Safari.</span></div>
        <div><b class="n">2</b><span>Chọn <b>Thêm vào MH chính</b> → <b>Thêm</b>.</span></div>
        <div><b class="n">3</b><span>Mở <b>Bot Trade</b> từ màn hình chính, vào lại tab Cài đặt.</span></div>
      </div>`;
    return;
  }
  if (!push.pushSupported()) { body.innerHTML = `<p class="muted">Trình duyệt này không hỗ trợ thông báo đẩy. Trên iPhone cần iOS 16.4 trở lên.</p>`; return; }
  if (push.permission() === 'denied') {
    body.innerHTML = `<p class="bad">Thông báo đang bị chặn.</p><p>Vào <b>Cài đặt</b> của iPhone → <b>Thông báo</b> → <b>Bot Trade</b> → bật <b>Cho phép thông báo</b>, rồi mở lại app.</p>`;
    return;
  }

  S.config = await push.currentConfig().catch(() => null);
  if (!S.config) {
    body.innerHTML = `<p>Bật để bot gửi tín hiệu phá vỡ thẳng về máy này, kể cả khi đang không mở app.</p>
      <button class="btn" id="btnPush">Bật thông báo trên máy này</button>`;
    $('#btnPush').onclick = async () => {
      try { S.config = await push.enablePush(); renderPush(); toast('Đã bật — giờ dán đoạn mã vào GitHub'); }
      catch (e) { toast(e.message, 4000); renderPush(); }
    };
    return;
  }

  S.devId = await push.deviceId(S.config);
  body.innerHTML = `
    <p id="pushStatus" class="muted">Đang kiểm tra bot đã nhận máy này chưa…</p>
    <details id="pushHow">
      <summary>Đoạn mã của máy này và cách dán vào GitHub</summary>
      <ol class="steps">
        <li>Chép đoạn mã dưới đây.<code class="blob" id="cfgBlob">${esc(S.config)}</code><button class="mini" id="btnCopyCfg">Sao chép đoạn mã</button></li>
        <li>Mở <a href="${repoSecret}" target="_blank" rel="noopener">trang thêm Secret của repo</a> (đăng nhập GitHub nếu được hỏi).</li>
        <li>Ô <b>Name</b> ghi đúng: <code>PUSH_CONFIG</code> · ô <b>Secret</b> dán đoạn mã → <b>Add secret</b>.<br><span class="muted">Đã có PUSH_CONFIG rồi thì bấm vào nó → Update, dán đè.</span></li>
        <li>Lần quét kế tiếp bot sẽ gửi “Bot Trade đã nhận máy này”. Muốn thử ngay: mở <a href="https://github.com/${REPO}/actions/workflows/scan.yml" target="_blank" rel="noopener">trang Actions</a> → <b>Run workflow</b> → chọn <b>test-push</b> → Run.</li>
      </ol>
      <p class="muted">Đoạn mã chứa khoá riêng của máy này — chỉ dán vào GitHub Secret, đừng gửi cho ai.</p>
    </details>
    <button class="btn sec" id="btnRePush">Tạo lại đăng ký</button>`;
  $('#btnCopyCfg').onclick = () => copyText(S.config);
  $('#btnRePush').onclick = async () => {
    try { S.config = await push.enablePush(); renderPush(); toast('Đã làm mới — dán lại đoạn mã mới vào GitHub'); }
    catch (e) { toast(e.message, 4000); }
  };
  renderPushStatus();
}

function renderPushStatus() {
  const el = $('#pushStatus');
  if (!el || !S.devId) return;
  const st = S.status;
  const known = st && st.push && (st.push.ids || []).includes(S.devId);
  const rec = st && (st.devices || []).find(d => d.id === S.devId);
  const how = $('#pushHow');
  if (rec && rec.ok) {
    el.className = 'ok';
    el.textContent = `✓ Bot đã gửi tới máy này lúc ${hhmm(rec.at)} ${ddmm(rec.at)}.`;
    if (how) how.open = false;
  } else if (rec && rec.gone) {
    el.className = 'bad';
    el.textContent = 'Đăng ký của máy này đã hết hạn. Bấm “Tạo lại đăng ký” rồi dán đoạn mã mới vào GitHub.';
    if (how) how.open = true;
  } else if (rec) {
    el.className = 'bad';
    el.textContent = `Lần gửi gần nhất bị lỗi (${rec.status || '?'}). ${rec.error ? rec.error.slice(0, 120) : ''}`;
  } else if (known) {
    el.className = 'muted';
    el.textContent = 'Bot đã có đoạn mã của máy này, sẽ gửi lời chào ở lần quét kế tiếp.';
  } else {
    el.className = 'warnc';
    el.textContent = 'Bot chưa có đoạn mã của máy này. Làm theo các bước dưới đây.';
    if (how) how.open = true;
  }
}

/* ======================= TÌNH TRẠNG BOT ======================= */

const TRIG = { schedule: 'lịch GitHub (hay trễ)', workflow_dispatch: 'hẹn giờ ngoài / bấm tay', push: 'sửa code', local: 'máy tính' };
const RESULT = { ok: 'đã quét', 'nothing-to-do': 'nến này đã quét rồi', 'test-sent': 'gửi thử thành công', 'test-failed': 'gửi thử thất bại', 'no-devices': 'chưa có máy nhận', error: 'LỖI', 'dry-run': 'chạy thử' };

function renderBot() {
  const st = S.status, el = $('#botBody');
  if (!st) { el.innerHTML = '<p class="muted">Chưa có dữ liệu — bot chưa chạy lần nào trên nhánh main.</p>'; return; }
  const ls = st.lastScan;
  const late = Date.now() - (st.finishedAt || 0) > 90 * 60000;
  const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  let html = '';
  if (late) html += `<p class="warnc">Bot chưa chạy hơn 1,5 giờ. Cài hẹn giờ cron-job.org ở mục dưới để bot chạy đều mỗi giờ.</p>`;
  if (st.result === 'error') html += `<p class="bad">Lần chạy gần nhất bị lỗi: ${esc(st.error || '')}</p>`;
  html += '<dl class="kv">';
  html += row('Chạy gần nhất', `${hhmm(st.finishedAt)} · ${ago(st.finishedAt)}`);
  html += row('Kết quả', esc(RESULT[st.result] || st.result || '—'));
  html += row('Kích hoạt bởi', esc(TRIG[st.trigger] || st.trigger || '—'));
  if (ls) {
    html += row('Quét thật gần nhất', `nến H1 ${hhmm(ls.target)} ${ddmm(ls.target)}`);
    if (ls.pushDoneAfterCloseMs != null && ls.pushDoneAfterCloseMs < 3600e3) html += row('Báo sau khi nến đóng', `${(ls.pushDoneAfterCloseMs / 1000).toFixed(1)} giây`);
    if (ls.counts) html += row('Đang theo dõi', `${ls.counts.coins} đồng · ${ls.counts.lines} đường`);
    html += row('Tín hiệu lần đó', `${ls.signals || 0} · gửi ${ls.pushes || 0} thông báo`);
  }
  html += row('Máy nhận thông báo', String(st.push ? st.push.configured : 0));
  html += row('Nguồn giá', esc((st.host || (ls && ls.host) || '').replace('https://', '')));
  html += '</dl>';
  html += `<a class="btn sec" href="https://github.com/${REPO}/actions/workflows/scan.yml" target="_blank" rel="noopener">Mở trang chạy bot trên GitHub</a>`;
  el.innerHTML = html;
}

function renderRules() {
  const pins = PINNED.map(id => nameOf(coinOf(id)) || coinOf(id));
  const items = [
    `Theo dõi top ${TOP_N} đồng crypto USDT vĩnh cửu trên OKX theo khối lượng 24h (cập nhật mỗi giờ)${pins.length ? `, cộng ${pins.join(', ')} luôn được theo dõi` : ''}.`,
    `Nến H1, xét tối đa ${CFG.WINDOW} nến gần nhất — mô hình nhỏ hay lớn đều tính.`,
    `Đường neo vào râu nến, cần ít nhất ${CFG.MIN_TOUCH} lần chạm; giữa hai lần chạm giá phải bật ra ≥ ${CFG.REACT} ATR. Đường càng dài càng phải nối các đỉnh/đáy lớn.`,
    `Phá vỡ = nến H1 <b>đóng cửa</b> ra ngoài đường ≥ ${CFG.BUF} ATR, thân nến ≥ ${CFG.BODY} ATR. Râu chọc qua không tính.`,
    `Nến đầu tiên đóng ra ngoài còn yếu (giá trôi qua đường, hay gặp ở đường dốc) thì đường chưa bị bỏ: giá còn nằm ngoài, bot theo dõi thêm tối đa ${CFG.FOLLOW} nến — nến nào đạt chuẩn trên, hoặc đóng cách đường ≥ ${CFG.FAR} ATR, là báo.`,
    `Xác nhận = đóng cửa vượt đỉnh/đáy cuối cùng nằm trên đường (gãy cấu trúc).`,
    `Retest = sau khi phá, giá chạy xa ≥ ${CFG.AWAY} ATR rồi quay về chạm đường và đóng cửa giữ được.`,
    `Thông báo: ${ALERTS.map(a => TYPE[a]).join(', ')}${MIN_SPAN_ALERT ? `, chỉ mô hình từ ${MIN_SPAN_ALERT} nến` : ''}. Cùng đồng cùng chiều gộp một tin; giờ nào nhiều hơn 3 tín hiệu thì gửi 2 tin lớn nhất + 1 tin tóm tắt.`,
  ];
  $('#rules').innerHTML = items.map(x => `<li>${x}</li>`).join('');
}

/* ======================= ĐIỀU HƯỚNG ======================= */

const focusOf = s => ({ ev: s.type, t: s.t, line: s.line });

async function openFromSignal(inst, ev, t) {
  showTab('chart');
  const find = () => S.signals.find(x => x.instId === inst && x.type === ev && x.t === t);
  let sig = find();
  if (!sig) { await loadData(true); sig = find(); }
  openSymbol(inst, sig ? focusOf(sig) : { ev, t, line: null });
}

function route(hash) {
  const q = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const s = q.get('s');
  if (s) {
    openFromSignal(s, q.get('ev'), +q.get('t'));
    try { history.replaceState(null, '', location.pathname); } catch {}
    return true;
  }
  const tab = q.get('tab');
  if (tab && ['chart', 'signals', 'markets', 'settings'].includes(tab)) { showTab(tab); try { history.replaceState(null, '', location.pathname); } catch {} }
  return false;
}

function bindUI() {
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
  $('#symBtn').addEventListener('click', () => { showTab('markets'); setTimeout(() => $('#search').focus(), 50); });
  $('#search').addEventListener('input', renderMarkets);
  $('#mkList').addEventListener('click', e => {
    const b = e.target.closest('[data-inst]'); if (!b) return;
    $('#search').value = '';
    openSymbol(b.dataset.inst); showTab('chart');
  });
  $('#sigFilter').addEventListener('click', e => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    S.sigFilter = b.dataset.f;
    for (const x of document.querySelectorAll('#sigFilter .chip')) x.classList.toggle('on', x === b);
    renderSignals();
  });
  $('#sigList').addEventListener('click', e => {
    const b = e.target.closest('[data-id]'); if (!b) return;
    const s = S.signals.find(x => x.id === b.dataset.id); if (!s) return;
    showTab('chart');
    openSymbol(s.instId, focusOf(s));
  });
  $('#lines').addEventListener('click', e => {
    const b = e.target.closest('[data-ta]'); if (!b || !chart.res) return;
    const ln = chart.res.lines.find(x => String(x.ta) === b.dataset.ta && String(x.tb) === b.dataset.tb)
      || (chart.focusMatch && chart.focusMatch.line);
    if (ln) chart.zoomTo(ln);
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    copyText(document.getElementById(b.dataset.copy).textContent);
  });
  addEventListener('hashchange', () => route(location.hash));
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => {
    if (e.data && e.data.type === 'open') route(new URL(e.data.url).hash);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    loadData(); chart && chart.resync();
    if (Date.now() - clockAt > 30 * 60000) syncClock();
  });
  $('#cjUrl').textContent = `https://api.github.com/repos/${REPO}/actions/workflows/scan.yml/dispatches`;
  const rl = $('#repoLink'); rl.href = `https://github.com/${REPO}`; rl.textContent = `github.com/${REPO}`;
  renderRules();
}

/* ======================= KHỞI ĐỘNG ======================= */

// Đồng hồ máy có thể lệch vài giây–vài phút: lấy giờ của OKX để đếm ngược đóng nến cho đúng.
let clockAt = 0;
async function syncClock() {
  clockAt = Date.now();
  try {
    const t0 = Date.now();
    const d = await okx.api('/api/v5/public/time', {}, { retries: 1 });
    const t1 = Date.now(), off = +d[0].ts - (t0 + t1) / 2;
    if (isFinite(off) && Math.abs(off) < 6 * HOUR && chart) { chart.clockOffset = Math.abs(off) < 250 ? 0 : off; chart.scheduleHourly(); }
  } catch {}
}

async function boot() {
  push.registerSW();
  push.getVapid().catch(() => {});
  bws = businessWS(); pws = publicWS();
  bws.onState = on => $('#wsDot').classList.toggle('on', on);
  bws.onReconnect = () => chart && chart.resync();
  bindUI();
  initChart();
  setHeader();

  // bước giá + danh sách hợp đồng: dùng bản đã lưu (≤ 24 giờ) để mở biểu đồ ngay, làm mới ở nền
  const ic = LS.get('insts', null);
  if (ic && ic.ticks && ic.allow) { S.ticks = ic.ticks; S.allow = new Set(ic.allow); }
  const instP = ic && Date.now() - ic.at < 24 * HOUR ? Promise.resolve() : okx.instruments().then(insts => {
    S.ticks = Object.fromEntries(insts.filter(x => x.instId.endsWith('-USDT-SWAP')).map(x => [x.instId, x.tickSz]));
    S.allow = okx.allowedSet(insts);
    LS.set('insts', { at: Date.now(), ticks: S.ticks, allow: [...S.allow] });
    chart.setTick(S.ticks[S.inst]);
    setHeader();
  }).catch(() => {});

  syncClock();
  if (!route(location.hash)) openSymbol(S.inst);
  loadData();
  (S.allow ? Promise.resolve() : instP).then(loadMarkets);
  setInterval(() => { if (document.visibilityState === 'visible') loadData(); }, 120000);
  setInterval(() => { if (document.visibilityState === 'visible') loadMarkets(); }, 300000);
}

boot();
