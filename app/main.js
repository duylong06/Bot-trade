// app/main.js — nối các phần lại: danh sách coin, màn biểu đồ, mốc báo, kèo bot vẽ.

import { topCoins, tickers, fmtPrice, fmtUsd, decimalsOf, dropCandleCache, candles } from './okx.js?v=202611260406';
import { ChartView, TFS, tfMs, toMs } from './chart.js?v=202611260406';
import { stochTxt, stoch, keyLevels } from './ta.js?v=202611260406';
import * as store from './store.js?v=202611260406';

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
      if (CV.sym) { const x = t.get(CV.sym); if (x) CV.gia(x.last, x.open24h, CV.sym); CV.canNenMoi(); }
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
          daChua: () => { $('#cvHint').textContent = 'Khung nhìn trôi ra chỗ trống, đã kéo về.'; },
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
    $('#cvErr').hidden = true;
    $('#cvHint').textContent = 'Đang tải nến…';
    this.dangNap = true;
    try {
      const xong = await this.view.load(id, this.tf, this.tick);
      if (!xong || this.sym !== id) return;            // đã bấm sang đồng khác, bỏ lượt này
      this.view.layout();                              // đo lại khung, phòng khi vừa mở nó còn bằng 0
      this.view.fit();
      this.leg(null);
      $('#cvHint').textContent = '';
      this.tuKiem();
    } catch (e) {
      // Không để màn hình trống không nói gì: nói rõ hỏng ở đâu và cho bấm lại.
      this.loi(`Không tải được nến ${this.base} khung ${this.tf}.\n${e.message}\n\nThường là OKX chặn tạm vì gọi quá dày. Chờ vài giây rồi thử lại.`);
    } finally { this.dangNap = false; }
    await this.napMoc();
    if (opts.line) { this.view.draft = { ...opts.line, id: 'xem' }; this.view.ov.update(); }
    if (r) this.gia(r.last, r.open24h, id);
    TOP.vao();
  },

  dong() {
    $('#phan').classList.remove('on');
    $('#cv').classList.remove('on');
    document.body.style.overflow = '';
    this.sym = null;
    if (this.view) this.view.cancelDraw();
  },

  thanh() {
    const el = $('#cvTf');
    const s = this.view ? this.view.show : { magnet: true, levels: true, bot: true, ema: true };
    el.innerHTML = TFS.map(t => `<button data-tf="${t.id}" aria-pressed="${t.id === this.tf}">${t.label}</button>`).join('')
      + `<span class="sp"></span>`
      + `<button data-act="fit" class="hot">Về nến</button>`
      + `<button data-act="phan">Phân tích</button>`
      + `<span class="sp"></span>`
      + `<button data-sw="magnet" aria-pressed="${s.magnet}">Nam châm</button>`
      + `<button data-sw="levels" aria-pressed="${s.levels}">Kháng cự</button>`
      + `<button data-sw="bot" aria-pressed="${s.bot}">Đường bot</button>`
      + `<button data-sw="ema" aria-pressed="${s.ema}">EMA200</button>`;
    el.querySelector('[data-act="phan"]').onclick = () => this.phanTich();
    el.querySelector('[data-act="fit"]').onclick = () => {
      if (!this.view) return;
      this.view.fit();
      $('#cvHint').textContent = '';
    };
    el.querySelectorAll('[data-tf]').forEach(b => b.onclick = async () => {
      this.tf = b.dataset.tf;
      el.querySelectorAll('[data-tf]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      const sym = this.sym, tf = this.tf;
      try {
        const xong = await this.view.load(sym, tf, this.tick);
        if (!xong || sym !== this.sym || tf !== this.tf) return;
        this.view.fit(); this.leg(null);
        this.view.setMarks(this.marks.map(m => ({ ...m, label: m.cho ? 'chờ bot nhận' : null })));
        this.view.setBotLines(this.botLines);
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

  gia(last, open24h, sym) {
    if (sym && sym !== this.sym) return;
    const d = open24h ? (last - open24h) / open24h * 100 : 0;
    $('#cvPx').innerHTML = `<b>${fmtPrice(last, decimalsOf(this.tick, last))}</b>` +
      `<i class="${d >= 0 ? 'tp-up' : 'tp-dn'}">${d >= 0 ? '+' : ''}${d.toFixed(2)}%</i>`;
    // Biểu đồ có thể còn đang vẽ đồng CŨ trong lúc chờ tải đồng mới — đừng ghi giá
    // đồng mới vào nến đồng cũ.
    if (this.view) this.view.tick(last, this.sym);
  },

  leg(b) {
    const v = this.view; if (!v || !v.bars) return;
    const k = b || { o: v.bars.o.at(-1), h: v.bars.h.at(-1), l: v.bars.l.at(-1), c: v.bars.c.at(-1) };
    const s = v.stochNow || {};
    const f = p => fmtPrice(p, v.dec);
    const st = (o, nm, col) => o ? `<span style="color:${col}">${nm} ${o.k == null || !isFinite(o.k) ? '—' : o.k.toFixed(1)}</span>` : '';
    // Dòng cuối là chẩn đoán: bao nhiêu nến, thang giá từ đâu tới đâu, có lọc nến rác không.
    // Biểu đồ mà trông trống thì chỉ cần nhìn dòng này là biết hỏng ở dữ liệu hay ở khung nhìn.
    const bars = v.bars;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < bars.c.length; i++) { if (bars.l[i] < lo) lo = bars.l[i]; if (bars.h[i] > hi) hi = bars.h[i]; }
    const rac = (bars.bo || 0) + (bars.cat || 0);
    $('#cvLeg').innerHTML =
      `<div><b>${esc(this.base)}</b> · ${esc((TFS.find(t => t.id === this.tf) || {}).label || this.tf)}</div>` +
      `<div>M ${f(k.o)} C ${f(k.c)} · T ${f(k.h)} Đ ${f(k.l)}</div>` +
      `<div>${st(s.y, 'Stoch 32', '#E8C44A')} &nbsp; ${st(s.r, 'Stoch 10', '#E45A50')}</div>` +
      `<div style="color:#5C6773">${bars.c.length} nến · ${f(lo)}–${f(hi)}${rac ? ' · lọc ' + rac : ''}</div>`;
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

  /* Phân tích đa khung — đúng phần dưới biểu đồ của tab Top 70 bản cũ:
     bảng Stoch M15 · H1 · H4, và kháng cự / hỗ trợ tách riêng H1 với H4. */
  async phanTich() {
    const sym = this.sym; if (!sym) return;
    $('#phTtl').textContent = this.base + ' — phân tích';
    $('#phBody').innerHTML = '<p class="note" style="margin:0">Đang tải nến ba khung…</p>';
    $('#phan').classList.add('on');
    try {
      const [m15, h1, h4] = await Promise.all([
        candles(sym, '15m', 300), candles(sym, '1H', 300), candles(sym, '4H', 300),
      ]);
      if (this.sym !== sym) return;                    // đã sang đồng khác
      const K = { M15: m15, H1: h1, H4: h4 };
      const f1 = v => Number.isFinite(v) ? v.toFixed(1) : '—';
      const cls = v => !Number.isFinite(v) ? '' : v >= 80 ? 'tp-dn' : v <= 20 ? 'tp-up' : '';

      const hang = Object.entries(K).map(([ten, k]) => {
        const A = stoch(k, 32, 13, 5), B = stoch(k, 10, 5, 5);
        const a = A.k.at(-1), ad = A.d.at(-1), b = B.k.at(-1), bd = B.d.at(-1);
        const ket = !Number.isFinite(a) || !Number.isFinite(b) ? '—'
          : (a >= 80 && b >= 80) ? 'cả hai quá mua'
          : (a <= 20 && b <= 20) ? 'cả hai quá bán'
          : `dài hạn ${stochTxt(a)}, ngắn hạn ${stochTxt(b)}`;
        return `<tr><td>${ten}</td><td class="tp-y">${f1(a)} / ${f1(ad)}</td>` +
               `<td class="tp-rd">${f1(b)} / ${f1(bd)}</td><td class="${cls(b)}">${ket}</td></tr>`;
      }).join('');

      const mucGia = k => {
        const lv = keyLevels(k, 160, .6), gia = k.c.at(-1), dec = this.view.dec;
        const res = lv.filter(x => x.side === 'res').slice(0, 4);
        const sup = lv.filter(x => x.side === 'sup').slice(0, 4);
        const dong = (L, nhan) => `<div class="tp-lv"><span>${nhan} <b class="${L.side === 'res' ? 'tp-dn' : 'tp-up'}">${fmtPrice(L.lvl, dec)}</b> · chạm ${L.n} lần</span><span>${L.dist.toFixed(2)}%</span></div>`;
        return (res.length ? res.slice().reverse().map(L => dong(L, 'Kháng cự')).join('')
                           : '<p class="note" style="margin:0">Không có kháng cự rõ phía trên.</p>')
          + `<div class="tp-lv" style="border-top:1px solid var(--line);border-bottom:0;margin-top:4px;padding-top:7px"><span><b>Giá hiện tại</b></span><span><b>${fmtPrice(gia, dec)}</b></span></div>`
          + (sup.length ? sup.map(L => dong(L, 'Hỗ trợ')).join('')
                        : '<p class="note" style="margin:0">Không có hỗ trợ rõ phía dưới.</p>');
      };

      $('#phBody').innerHTML =
        `<table class="tp-tb"><thead><tr><th>Khung</th><th>Stoch dài hạn</th><th>Stoch ngắn hạn</th><th>Trạng thái</th></tr></thead><tbody>${hang}</tbody></table>` +
        `<p class="note" style="margin:0 0 4px">Vàng là Stoch 32·13·5 dài hạn, đỏ là 10·5·5 ngắn hạn. Số trước là %K, số sau là %D.</p>` +
        `<h3>Kháng cự – hỗ trợ H1</h3>${mucGia(h1)}` +
        `<h3>Kháng cự – hỗ trợ H4</h3>${mucGia(h4)}`;
    } catch (e) {
      $('#phBody').innerHTML = `<p class="note" style="margin:0">Không tải được: ${esc(e.message)}</p>`;
    }
  },

  /* Vẽ xong thì tự soi lại: biểu đồ có thật sự hiện ra không.
     Đếm điểm ảnh sáng trên canvas — cách duy nhất biết chắc, vì mọi phép kiểm gián tiếp
     đều có thể nói "ổn" trong khi màn hình trống trơn. Rỗng thì tự chữa một lần, vẫn rỗng
     thì hiện bảng chẩn đoán để còn biết hỏng ở đâu. */
  tuKiem(lanHai) {
    setTimeout(() => {
      const v = this.view;
      if (!v || !v.bars || this.sym !== v.sym) return;
      let sang = -1;
      try {
        const c = $('#chart').querySelector('canvas');
        if (c && c.width > 10 && c.height > 10) {
          const g = c.getContext('2d');
          const d = g.getImageData(0, 0, c.width, Math.min(400, c.height)).data;
          sang = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) sang++;
        }
      } catch (e) { return; }                 // không đọc được canvas thì thôi, đừng báo bừa
      if (sang > 400) return;                 // có vẽ ra, yên tâm

      if (!lanHai) { v.layout(); v.fit(); this.tuKiem(true); return; }

      const k = v.khung || {}, b = v.bars;
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < b.c.length; i++) { if (b.l[i] < lo) lo = b.l[i]; if (b.h[i] > hi) hi = b.h[i]; }
      let r = null; try { r = v.chart.timeScale().getVisibleLogicalRange(); } catch (e) {}
      this.loi(
        `Biểu đồ không vẽ ra được. Chụp màn hình này gửi cho Claude.\n\n` +
        `${this.base} ${this.tf} · ${b.c.length} nến · lọc ${(b.bo || 0) + (b.cat || 0)}\n` +
        `giá ${fmtPrice(lo, v.dec)}–${fmtPrice(hi, v.dec)}\n` +
        `khung ${k.wThat}×${k.hThat}${k.ep ? ' (ép ' + k.w + '×' + k.h + ')' : ''}\n` +
        `màn ${window.innerWidth}×${window.innerHeight} ·${navigator.standalone ? ' app màn hình chính' : ' trình duyệt'}\n` +
        `nhìn ${r ? r.from.toFixed(0) + '…' + r.to.toFixed(0) : '?'} · sáng ${sang}`);
    }, lanHai ? 500 : 350);
  },

  loi(txt) {
    $('#cvErrTxt').textContent = txt;
    $('#cvErr').hidden = false;
    $('#cvHint').textContent = '';
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
$('#phDong').onclick = () => $('#phan').classList.remove('on');
$('#phan').onclick = e => { if (e.target.id === 'phan') $('#phan').classList.remove('on'); };
$('#cvRetry').onclick = () => { dropCandleCache(); store.quenCache(); if (CV.sym) CV.mo(CV.sym, { tf: CV.tf }); };
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
