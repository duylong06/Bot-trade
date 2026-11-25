// app/main.js — nối các phần lại: danh sách coin, màn biểu đồ, mốc báo, kèo bot vẽ.

import { topCoins, tickers, fmtPrice, fmtUsd, decimalsOf } from './okx.js';
import { ChartView, TFS, tfMs, toMs } from './chart.js';
import { stochTxt } from './ta.js';
import * as store from './store.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hhmm = ms => new Date(ms).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/* ================= chuyển tab ================= */
const TABS = ['top', 'bot', 'moc', 'cfg'];
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
  TABS.forEach(id => $('#' + id).hidden = id !== b.dataset.t);
  if (b.dataset.t === 'top') TOP.vao(); else TOP.ra();
  if (b.dataset.t === 'moc') MOC.tai();
  if (b.dataset.t === 'bot') BOT.tai();
});

/* ================= danh sách coin ================= */
const TOP = {
  rows: [], px: new Map(), tm: null, n: 70,

  vao() { if (this.rows.length) this.nhip(); this.tm = this.tm || setInterval(() => this.nhip(), 4000); },
  ra() { clearInterval(this.tm); this.tm = null; },

  async tai() {
    const go = $('#tpGo'); go.disabled = true; $('#tpStat').textContent = 'Đang tải…';
    try {
      this.rows = await topCoins(this.n);
      $('#tpList').innerHTML = this.rows.map((r, i) => `
        <div class="tp-r" data-id="${esc(r.id)}">
          <span class="no">${i + 1}</span>
          <span class="sy">${esc(r.base)}<span class="vo">${fmtUsd(r.vol)}</span></span>
          <span class="pz" data-px="${esc(r.id)}">${fmtPrice(r.last, decimalsOf(r.tickSz, r.last))}</span>
          <span class="ch" data-ch="${esc(r.id)}"></span>
        </div>`).join('');
      $('#tpList').querySelectorAll('.tp-r').forEach(el => el.onclick = () => CV.mo(el.dataset.id));
      this.rows.forEach(r => this.px.set(r.id, r.last));
      this.ve();
      $('#tpStat').textContent = `${this.rows.length} đồng, giá chạy mỗi 4 giây. Chạm vào một đồng để mở biểu đồ.`;
      this.vao();
    } catch (e) {
      $('#tpStat').innerHTML = `<span class="err" style="display:block">Không tải được: ${esc(e.message)}</span>`;
    }
    go.disabled = false;
  },

  async nhip() {
    try {
      const t = await tickers();
      for (const r of this.rows) {
        const x = t.get(r.id); if (!x) continue;
        const old = this.px.get(r.id);
        r.last = x.last; r.open24h = x.open24h;
        this.px.set(r.id, x.last);
        const el = document.querySelector(`[data-px="${CSS.escape(r.id)}"]`);
        if (el && old != null && x.last !== old) {
          el.classList.remove('fu', 'fd'); void el.offsetWidth;
          el.classList.add(x.last > old ? 'fu' : 'fd');
        }
      }
      this.ve();
      if (CV.sym) { const x = t.get(CV.sym); if (x) CV.gia(x.last, x.open24h); }
    } catch (e) {}
  },

  ve() {
    for (const r of this.rows) {
      const p = document.querySelector(`[data-px="${CSS.escape(r.id)}"]`);
      const c = document.querySelector(`[data-ch="${CSS.escape(r.id)}"]`);
      if (p) p.textContent = fmtPrice(r.last, decimalsOf(r.tickSz, r.last));
      if (c && r.open24h) {
        const d = (r.last - r.open24h) / r.open24h * 100;
        c.textContent = (d >= 0 ? '+' : '') + d.toFixed(2) + '%';
        c.className = 'ch ' + (d >= 0 ? 'tp-up' : 'tp-dn');
      }
    }
  },
};
$('#tpGo').onclick = () => TOP.tai();
$('#tpN').onclick = () => {
  TOP.n = TOP.n === 70 ? 150 : 70;
  $('#tpN').textContent = TOP.n + ' đồng';
  if (TOP.rows.length) TOP.tai();
};

/* ================= màn biểu đồ ================= */
const CV = {
  view: null, sym: null, base: '', tf: '1H', tick: 0, marks: [], botLines: [],

  async mo(id, opts = {}) {
    this.sym = id; this.base = id.split('-')[0];
    const r = TOP.rows.find(x => x.id === id);
    this.tick = r ? r.tickSz : 0;
    if (opts.tf) this.tf = opts.tf;
    $('#cvTtl').textContent = this.base + ' · vĩnh cửu';
    $('#cv').classList.add('on');
    document.body.style.overflow = 'hidden';
    this.thanh();
    if (!this.view) {
      this.view = new ChartView($('#chart'), {
        on: {
          hover: b => this.leg(b),
          drafted: m => this.moTam(m),
          moved: () => {},
        },
      });
      window.__cv = this.view;            // để soi từ console khi cần
    }
    $('#cvHint').textContent = 'Đang tải nến…';
    try {
      await this.view.load(id, this.tf, this.tick);
      this.view.fit();
      this.leg(null);
      $('#cvHint').textContent = '';
    } catch (e) { $('#cvHint').textContent = 'Không tải được nến: ' + e.message; }
    await this.napMoc();
    if (opts.line) { this.view.draft = { ...opts.line, id: 'xem' }; this.view.ov.update(); }
    if (r) this.gia(r.last, r.open24h);
    TOP.vao();
  },

  dong() {
    $('#cv').classList.remove('on');
    document.body.style.overflow = '';
    this.sym = null;
    if (this.view) this.view.cancelDraw();
  },

  thanh() {
    const el = $('#cvTf');
    el.innerHTML = TFS.map(t => `<button data-tf="${t.id}" aria-pressed="${t.id === this.tf}">${t.label}</button>`).join('')
      + `<span class="sp"></span>`
      + `<button data-sw="levels" aria-pressed="true">Kháng cự</button>`
      + `<button data-sw="bot" aria-pressed="true">Đường bot</button>`
      + `<button data-sw="ema" aria-pressed="true">EMA200</button>`;
    el.querySelectorAll('[data-tf]').forEach(b => b.onclick = async () => {
      this.tf = b.dataset.tf;
      el.querySelectorAll('[data-tf]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      try { await this.view.load(this.sym, this.tf, this.tick); this.view.fit(); this.leg(null); this.napMoc(); } catch (e) {}
    });
    el.querySelectorAll('[data-sw]').forEach(b => b.onclick = () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      this.view.toggle(b.dataset.sw, on);
    });
  },

  gia(last, open24h) {
    const d = open24h ? (last - open24h) / open24h * 100 : 0;
    $('#cvPx').innerHTML = `<b>${fmtPrice(last, decimalsOf(this.tick, last))}</b>` +
      `<i class="${d >= 0 ? 'tp-up' : 'tp-dn'}">${d >= 0 ? '+' : ''}${d.toFixed(2)}%</i>`;
    if (this.view) this.view.tick(last);
  },

  leg(b) {
    const v = this.view; if (!v || !v.bars) return;
    const k = b || { o: v.bars.o.at(-1), h: v.bars.h.at(-1), l: v.bars.l.at(-1), c: v.bars.c.at(-1) };
    const s = v.stochNow || {};
    const f = p => fmtPrice(p, v.dec);
    const st = (o, nm, col) => o ? `<span style="color:${col}">${nm} ${o.k == null || !isFinite(o.k) ? '—' : o.k.toFixed(1)}</span>` : '';
    $('#cvLeg').innerHTML =
      `<div><b>${esc(this.base)}</b> · ${esc((TFS.find(t => t.id === this.tf) || {}).label || this.tf)}</div>` +
      `<div>M ${f(k.o)} C ${f(k.c)} · T ${f(k.h)} Đ ${f(k.l)}</div>` +
      `<div>${st(s.y, 'Stoch 32', '#E8C44A')} &nbsp; ${st(s.r, 'Stoch 10', '#E45A50')}</div>`;
  },

  async napMoc() {
    const res = await store.readMarks();
    const all = store.mergeMarks(res.marks, store.pending());
    this.marks = all.filter(m => m.sym === this.sym && m.state !== 'done');
    this.view.setMarks(this.marks.map(m => ({ ...m, label: m.cho ? 'chờ bot nhận' : null })));
    const bl = await store.readBotLines();
    this.botLines = bl.items.filter(x => x.sym === this.sym).map(x => ({ ...x.line, label: 'bot vẽ' }));
    this.view.setBotLines(this.botLines);
  },

  /* vừa kẻ xong hai điểm → mở tấm lưu mốc */
  moTam(m) {
    this.tam = m;
    const v = this.view;
    $('#shInfo').textContent =
      `${this.base} · ${fmtPrice(m.pa, v.dec)} lúc ${hhmm(m.ta)} → ${fmtPrice(m.pb, v.dec)} lúc ${hhmm(m.tb)}.` +
      ` Đường dốc ${m.pb > m.pa ? 'lên' : 'xuống'}, bot sẽ nối dài sang phải theo đúng độ dốc đó.`;
    $('#shNote').textContent = 'Nến M30 đóng ngoài đường chắc hơn: râu quét qua rồi thụt lại thì không báo.';
    $('#sheet').classList.add('on');
    $('#cvDraw').hidden = true; $('#cvCancel').hidden = true;
  },
};
$('#cvBack').onclick = () => CV.dong();
$('#cvDraw').onclick = () => {
  CV.view.startDraw();
  $('#cvHint').textContent = 'Chạm điểm thứ nhất, rồi chạm điểm thứ hai.';
  $('#cvDraw').hidden = true; $('#cvCancel').hidden = false;
};
$('#cvCancel').onclick = () => {
  CV.view.cancelDraw();
  $('#cvHint').textContent = ''; $('#cvDraw').hidden = false; $('#cvCancel').hidden = true;
};

/* ---- tấm lưu mốc ---- */
let shDir = 'down', shMode = 'close';
$('#shDir').querySelectorAll('button').forEach(b => b.onclick = () => {
  shDir = b.dataset.v;
  $('#shDir').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
});
$('#shMode').querySelectorAll('button').forEach(b => b.onclick = () => {
  shMode = b.dataset.v;
  $('#shMode').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  $('#shNote').textContent = shMode === 'close'
    ? 'Nến M30 đóng ngoài đường chắc hơn: râu quét qua rồi thụt lại thì không báo.'
    : 'Báo ngay khi giá chạm đường, kể cả chỉ là râu nến. Nhanh hơn nhưng nhiễu hơn.';
});
function dongTam() {
  $('#sheet').classList.remove('on');
  $('#cvDraw').hidden = false; $('#cvCancel').hidden = true;
  $('#cvHint').textContent = '';
  CV.view.cancelDraw();
}
$('#shDrop').onclick = dongTam;
$('#shSave').onclick = async () => {
  const m = CV.tam; if (!m) return dongTam();
  const mark = {
    id: m.id, sym: CV.sym, base: CV.base, tf: CV.tf,
    ta: m.ta, pa: m.pa, tb: m.tb, pb: m.pb,
    dir: shDir, mode: shMode, state: 'on', at: Date.now(),
  };
  $('#shSave').disabled = true; $('#shSave').textContent = 'Đang gửi…';
  try {
    await store.addMark(mark);
    store.addPending(mark);
    dongTam();
    $('#cvHint').textContent = 'Đã gửi. Bot nhận ở lượt quét tới (trong vòng 30 phút).';
    await CV.napMoc();
  } catch (e) {
    $('#cvHint').textContent = 'Không gửi được: ' + e.message;
  }
  $('#shSave').disabled = false; $('#shSave').textContent = 'Lưu mốc';
};

/* ================= mốc của tôi ================= */
const MOC = {
  async tai() {
    $('#mocStat').textContent = 'Đang đọc…';
    const res = await store.readMarks();
    const all = store.mergeMarks(res.marks, store.pending());
    if (res.err) { $('#mocStat').innerHTML = `<span class="err" style="display:block">Không đọc được: ${esc(res.err)}</span>`; }
    else if (res.missing) { $('#mocStat').textContent = 'Bot chưa ghi mốc nào. Mốc bạn vừa kẻ sẽ hiện sau lượt quét tới.'; }
    else { $('#mocStat').textContent = res.ts ? `Bot cập nhật lúc ${hhmm(res.ts)}.` : ''; }

    if (!all.length) { $('#mocList').innerHTML = `<div class="empty">Chưa có mốc nào.<br>Mở một đồng ở tab Biểu đồ rồi bấm <b>Kẻ đường</b>.</div>`; return; }
    all.sort((a, b) => (b.at || 0) - (a.at || 0));
    $('#mocList').innerHTML = all.map(m => {
      const st = m.cho ? ['wait', 'chờ bot nhận'] : m.state === 'done' ? ['done', 'đã báo'] : ['on', 'đang canh'];
      const huong = m.dir === 'down' ? 'phá xuống' : 'phá lên';
      const kieu = m.mode === 'close' ? 'nến M30 đóng ngoài đường' : 'giá chạm đường';
      return `<div class="mk">
        <div class="mk-h"><span class="sy">${esc(m.base || m.sym)}</span>
          <span class="tf">${esc(m.tf || '')}</span>
          <span class="st ${st[0]}">${st[1]}</span></div>
        <div class="mk-b">Báo khi <b>${huong}</b>, điều kiện: ${kieu}.<br>
          Neo ${fmtPrice(m.pa)} lúc ${hhmm(m.ta)} → ${fmtPrice(m.pb)} lúc ${hhmm(m.tb)}.
          ${m.firedAt ? `<br>Đã báo lúc ${hhmm(m.firedAt)}${m.firedPx ? ' ở giá ' + fmtPrice(m.firedPx) : ''}.` : ''}</div>
        <div class="mk-f">
          <button class="ghost" data-open="${esc(m.sym)}" data-tf="${esc(m.tf || '1H')}">Xem biểu đồ</button>
          ${m.state === 'done' ? '' : `<button class="lk" data-del="${esc(m.id)}">Xoá mốc</button>`}
        </div></div>`;
    }).join('');
    $('#mocList').querySelectorAll('[data-open]').forEach(b => b.onclick = () => CV.mo(b.dataset.open, { tf: b.dataset.tf }));
    $('#mocList').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      b.disabled = true; b.textContent = 'Đang xoá…';
      try { await store.delMark(b.dataset.del); store.dropPending(b.dataset.del); b.closest('.mk').style.opacity = .4; b.textContent = 'Đã gửi lệnh xoá'; }
      catch (e) { b.textContent = 'Lỗi: ' + e.message; b.disabled = false; }
    });
  },
};

/* ================= kèo bot tự vẽ ================= */
const BOT = {
  async tai() {
    $('#botStat').textContent = 'Đang đọc…';
    const res = await store.readBotLines();
    if (!res.items.length) {
      $('#botStat').textContent = '';
      $('#botList').innerHTML = `<div class="empty">Bot chưa tìm thấy đồng nào sắp phá.<br>Bot quét lại mỗi 30 phút.</div>`;
      return;
    }
    $('#botStat').textContent = `Bot quét lúc ${hhmm(res.ts)} — ${res.items.length} đồng đáng để mắt. Đây là tham khảo, không phải lệnh.`;
    res.items.sort((a, b) => a.distPct - b.distPct);
    $('#botList').innerHTML = res.items.map(x => `
      <div class="mk">
        <div class="mk-h"><span class="sy">${esc(x.base)}</span><span class="tf">${esc(x.tf)}</span>
          <span class="st ${x.distPct < 0.5 ? 'on' : 'wait'}">${x.distPct < 0.5 ? 'sát đường' : 'đang tới'}</span></div>
        <div class="mk-b">
          ${x.side === 'R' ? 'Kháng cự giảm — phá lên là tín hiệu <b>Long</b>' : 'Hỗ trợ tăng — phá xuống là tín hiệu <b>Short</b>'}.<br>
          Giá ${fmtPrice(x.price)}, đường đang ở ${fmtPrice(x.linePx)} — cách <b>${x.distPct.toFixed(2)}%</b>.<br>
          Đường chạm ${x.touches} lần, kéo dài ${x.span} nến.
        </div>
        <div class="mk-f"><button class="ghost" data-open="${esc(x.sym)}" data-tf="${esc(x.tf)}">Mở biểu đồ</button></div>
      </div>`).join('');
    $('#botList').querySelectorAll('[data-open]').forEach(b => b.onclick = () => CV.mo(b.dataset.open, { tf: b.dataset.tf }));
  },
};

/* ================= cài đặt ================= */
$('#topic').value = store.topic();
$('#save').onclick = () => {
  store.setTopic($('#topic').value);
  $('#topic').value = store.topic();
  $('#saved').textContent = 'Đã lưu trên máy này.';
};

/* ================= khởi động ================= */
TOP.tai();
