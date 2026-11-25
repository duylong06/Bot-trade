// app/main.js — nối các phần lại: danh sách coin, màn biểu đồ, mốc báo, kèo bot vẽ.

import { topCoins, tickers, fmtPrice, fmtUsd, decimalsOf, dropCandleCache } from './okx.js';
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
      if (CV.sym) { const x = t.get(CV.sym); if (x) CV.gia(x.last, x.open24h); CV.canNenMoi(); }
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
          ready: () => this.nutVe('xong'),
          tapMode: () => { this.nutVe('cham2'); },
          live: d => this.veLive(d),
          badSecond: () => { this.nutVe('ve'); $('#cvHint').textContent = 'Hai đầu rơi vào cùng một cây nến — kéo xa ra một chút.'; },
          moved: () => {},
        },
      });
      window.__cv = this.view;            // để soi từ console khi cần
    }
    if (this.view) this.view.cancelDraw();      // mở đồng mới thì bỏ hết nét đang kẻ dở
    this.nutVe('ve');
    $('#cvHint').textContent = 'Đang tải nến…';
    this.dangNap = true;
    try {
      const xong = await this.view.load(id, this.tf, this.tick);
      if (!xong || this.sym !== id) return;            // đã bấm sang đồng khác, bỏ lượt này
      this.view.fit();
      this.leg(null);
      $('#cvHint').textContent = '';
    } catch (e) {
      $('#cvHint').textContent = 'Không tải được nến: ' + e.message;
    } finally { this.dangNap = false; }
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
      + `<button data-sw="magnet" class="hot" aria-pressed="${this.view ? this.view.show.magnet : true}">Nam châm</button>`
      + `<button data-sw="levels" aria-pressed="true">Kháng cự</button>`
      + `<button data-sw="bot" aria-pressed="true">Đường bot</button>`
      + `<button data-sw="ema" aria-pressed="true">EMA200</button>`;
    el.querySelectorAll('[data-tf]').forEach(b => b.onclick = async () => {
      this.tf = b.dataset.tf;
      el.querySelectorAll('[data-tf]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      const sym = this.sym, tf = this.tf;
      try {
        const xong = await this.view.load(sym, tf, this.tick);
        if (!xong || sym !== this.sym || tf !== this.tf) return;
        this.view.fit(); this.leg(null); this.napMoc();
      } catch (e) {}
    });
    el.querySelectorAll('[data-sw]').forEach(b => b.onclick = () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      this.view.toggle(b.dataset.sw, on);
    });
  },

  /* Sang cây nến kế tiếp thì tải lại chuỗi nến, không thì cây cuối cứ phình mãi.
     Phải chắc biểu đồ đang thật sự đứng ở đồng này: lúc vừa bấm sang đồng khác thì
     v.bars vẫn là nến của đồng cũ, tải chen vào đây là đè mất biểu đồ vừa mở. */
  async canNenMoi() {
    const v = this.view;
    if (!v || !v.bars || this.dangNap) return;
    if (v.sym !== this.sym || v.tf !== this.tf) return;
    if (Date.now() < v.bars.t.at(-1) + tfMs(this.tf)) return;
    this.dangNap = true;
    const sym = this.sym, tf = this.tf;
    try {
      dropCandleCache();
      const giu = v.chart.timeScale().getVisibleLogicalRange();
      const xong = await v.load(sym, tf, this.tick);
      if (!xong || sym !== this.sym || tf !== this.tf) return;
      if (giu) try { v.chart.timeScale().setVisibleLogicalRange(giu); } catch (e) {}
      if (!v.coNen()) v.fit();          // khung nhìn lạc ra vùng trống thì kéo về
      this.leg(null);
    } catch (e) {} finally { this.dangNap = false; }
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

  /* Nút dưới đáy đổi theo việc đang làm. */
  nutVe(trangThai) {
    const d = {
      ve:    { draw: 1, cancel: 0, redo: 0, done: 0, hint: '' },
      dangVe:{ draw: 0, cancel: 1, redo: 0, done: 0, hint: '<b>Rê</b> để đưa dấu thập tới chỗ cần, rồi <b>chạm</b> để chốt.', live: 1 },
      cham2: { draw: 0, cancel: 1, redo: 0, done: 0, hint: 'Xong điểm thứ nhất. Rê tiếp rồi chạm để chốt điểm thứ hai.' },
      xong:  { draw: 0, cancel: 1, redo: 1, done: 1, hint: 'Kéo hai đầu tròn để chỉnh cho khớp râu nến. Vừa ý thì bấm Xong.' },
    }[trangThai];
    $('#cvDraw').hidden = !d.draw;
    $('#cvCancel').hidden = !d.cancel;
    $('#cvRedo').hidden = !d.redo;
    $('#cvDone').hidden = !d.done;
    $('#cvHint').innerHTML = d.hint;
    // chế độ ngắm: ghép luôn giá và giờ đang ngắm vào sau câu hướng dẫn
    if (d.live && this.view && this.view.cross) this.veLive(this.view.cross, d.hint);
  },

  /* Giá và giờ chỗ dấu thập đang ngắm, hiện ngay dưới đáy như bên OKX. */
  veLive(p, dan) {
    const v = this.view;
    const duoi = dan || (v.pending1 ? 'chạm để chốt điểm thứ hai' : 'chạm để chốt');
    $('#cvHint').innerHTML = `<b>${fmtPrice(p.p, v.dec)}</b> · ${hhmm(p.t)}` +
      (p.bam ? ` <span style="color:var(--mark)">bám ${esc(p.bam)}</span>` : '') +
      `<br><span style="color:var(--faint)">${duoi}</span>`;
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
  },
};
$('#cvBack').onclick = () => CV.dong();
$('#cvDraw').onclick = () => { CV.view.startDraw(); CV.nutVe('dangVe'); };
$('#cvRedo').onclick = () => { CV.view.startDraw(); CV.nutVe('dangVe'); };
$('#cvCancel').onclick = () => { CV.view.cancelDraw(); CV.nutVe('ve'); };
$('#cvDone').onclick = () => { if (CV.view.draft) CV.moTam(CV.view.draft); };

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
  CV.view.cancelDraw();
  CV.nutVe('ve');
}
$('#shDrop').onclick = dongTam;
$('#shSave').onclick = async () => {
  const m = CV.tam; if (!m) return dongTam();
  if (m.ta === m.tb) {
    $('#shInfo').textContent = 'Hai đầu đang nằm trên cùng một cây nến nên chưa thành đường. Bỏ rồi kẻ lại.';
    return;
  }
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
    const sap = res.items.filter(x => x.trang !== 'pha').length;
    const pha = res.items.length - sap;
    $('#botStat').textContent = `Bot quét lúc ${hhmm(res.ts)} — ${sap} đồng sắp phá, ${pha} đồng vừa phá. Tham khảo, không phải lệnh.`;
    $('#botList').innerHTML = res.items.map(x => {
      const daPha = x.trang === 'pha';
      const nhan = daPha
        ? ['done', x.nen === 0 ? 'vừa phá' : `phá ${x.nen} nến trước`]
        : x.distPct < 0.5 ? ['on', 'sát đường'] : ['wait', 'đang tới'];
      const y = x.side === 'R'
        ? ['Kháng cự giảm', 'phá lên là tín hiệu <b>Long</b>']
        : ['Hỗ trợ tăng', 'phá xuống là tín hiệu <b>Short</b>'];
      const than = daPha
        ? `${y[0]} <b>đã bị phá</b>${x.xacNhan ? ', đã xác nhận gãy cấu trúc' : ''}${x.retest ? ', đã retest giữ được' : ''}.<br>
           Giá ${fmtPrice(x.price)}, đường ở ${fmtPrice(x.linePx)} — đã đi xa <b>${x.distPct.toFixed(2)}%</b>.`
        : `${y[0]} — ${y[1]}.<br>
           Giá ${fmtPrice(x.price)}, đường đang ở ${fmtPrice(x.linePx)} — cách <b>${x.distPct.toFixed(2)}%</b>.`;
      return `<div class="mk">
        <div class="mk-h"><span class="sy">${esc(x.base)}</span><span class="tf">${esc(x.tf)}</span>
          <span class="st ${nhan[0]}">${nhan[1]}</span></div>
        <div class="mk-b">${than}<br>Đường chạm ${x.touches} lần, kéo dài ${x.span} nến.</div>
        <div class="mk-f"><button class="ghost" data-open="${esc(x.sym)}" data-tf="${esc(x.tf)}">Mở biểu đồ</button></div>
      </div>`;
    }).join('');
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

/* iPhone để app chạy nền lâu thì hay xoá trắng canvas để lấy lại bộ nhớ. Quay lại app mà
   biểu đồ đang mở thì vẽ lại từ đầu, và kéo khung nhìn về nếu nó đang lạc ngoài vùng có nến. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const v = CV.view;
  if (!CV.sym || !v || !v.bars) return;
  try {
    v.setBars(v.bars);
    if (!v.coNen()) v.fit();
    CV.leg(null);
  } catch (e) {}
});

window.__CV = CV; window.__TOP = TOP;   // để soi và kiểm thử từ console

/* ================= khởi động ================= */
TOP.tai();
