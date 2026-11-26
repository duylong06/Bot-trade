// app/chart.js — biểu đồ nến kiểu TradingView.
//
// Dùng chính thư viện mã nguồn mở của TradingView (Lightweight Charts v5, để trong vendor/),
// nên cảm giác kéo ngang, phóng to thu nhỏ, crosshair giống hệt bên đó.
//
// Bố cục: khung trên là nến + EMA200 + volume, khung dưới là hai đường Stoch
// (32·13·5 vàng dài hạn, 10·5·5 đỏ ngắn hạn) — đúng bộ bạn đang dùng.

import { candles, decimalsOf, fmtPrice } from './okx.js';
import { ema, stoch, keyLevels } from './ta.js';

const L = () => window.LightweightCharts;

/* Thư viện hiển thị giờ như UTC. Cộng sẵn lệch múi giờ để đọc ra giờ Việt Nam. */
const TZ = -new Date().getTimezoneOffset() * 60;
export const toSec = ms => Math.floor(ms / 1000) + TZ;
export const toMs = sec => (sec - TZ) * 1000;

export const C = {
  up: '#2FBE8C', dn: '#E45A50', ema: '#E5A03C',
  stY: '#E8C44A', stR: '#E45A50',
  grid: 'rgba(255,255,255,.045)', line: '#26313C', text: '#8B96A3',
  res: '#E45A50', sup: '#2FBE8C',
  mine: '#4AA8FF', bot: '#C08CFF', sel: '#FFD60A',
};

export const TFS = [
  { id: '15m', label: '15m', ms: 9e5 },
  { id: '30m', label: '30m', ms: 18e5 },
  { id: '1H', label: '1H', ms: 36e5 },
  { id: '4H', label: '4H', ms: 144e5 },
  { id: '1Dutc', label: '1D', ms: 864e5 },
];
export const tfMs = id => (TFS.find(t => t.id === id) || TFS[2]).ms;

/* ---------------------------------------------------------------- *
 * Lớp vẽ phủ lên nến: trendline của bạn, đường bot vẽ, mức kháng cự.
 * Là "series primitive" của thư viện nên tự vẽ lại mỗi khi kéo/zoom.
 * ---------------------------------------------------------------- */
class Overlay {
  constructor(view) { this.v = view; }
  attached({ chart, series, requestUpdate }) { this.chart = chart; this.series = series; this.req = requestUpdate; }
  detached() { this.chart = null; }
  update() { if (this.req) this.req(); }
  updateAllViews() {}
  paneViews() { return [{ zOrder: () => 'top', renderer: () => ({ draw: t => this.draw(t) }) }]; }

  draw(target) {
    const v = this.v;
    if (!this.chart || !this.series || !v.bars) return;
    target.useBitmapCoordinateSpace(sc => {
      const ctx = sc.context, hr = sc.horizontalPixelRatio, vr = sc.verticalPixelRatio;
      const W = sc.bitmapSize.width, H = sc.bitmapSize.height;
      const Y = p => { const y = this.series.priceToCoordinate(p); return y == null ? null : y * vr; };
      const X = tMs => { const x = v.xOf(tMs); return x == null ? null : x * hr; };

      const label = (txt, x, y, color, align = 'left') => {
        ctx.font = `600 ${Math.round(10.5 * vr)}px -apple-system,BlinkMacSystemFont,sans-serif`;
        ctx.textAlign = align; ctx.textBaseline = 'bottom';
        const w = ctx.measureText(txt).width, h = 14 * vr;
        const x0 = align === 'right' ? x - w : x;
        ctx.fillStyle = 'rgba(14,19,24,.78)';
        ctx.fillRect(x0 - 4 * hr, y - h + 2 * vr, w + 8 * hr, h);
        ctx.fillStyle = color; ctx.fillText(txt, x, y - 2 * vr);
      };

      /* --- mức kháng cự / hỗ trợ --- */
      if (v.show.levels && v.levels) {
        ctx.setLineDash([5 * hr, 4 * hr]);
        ctx.lineWidth = Math.max(1, vr);
        for (const lv of v.levels) {
          const y = Y(lv.lvl); if (y == null) continue;
          ctx.strokeStyle = lv.side === 'res' ? 'rgba(228,90,80,.5)' : 'rgba(47,190,140,.5)';
          ctx.beginPath(); ctx.moveTo(0, Math.round(y) + .5); ctx.lineTo(W, Math.round(y) + .5); ctx.stroke();
          label(v.fmt(lv.lvl), W - 6 * hr, y - 2 * vr, lv.side === 'res' ? '#F0938C' : '#63D6AC', 'right');
        }
        ctx.setLineDash([]);
      }

      /* --- các đường xiên --- */
      const drawLine = (m, color, selected) => {
        const t0 = Math.min(m.ta, m.tb), t1 = Math.max(m.ta, m.tb);
        // kéo dài sang phải tới mép phải của khung nhìn
        const tEnd = v.rightEdgeMs();
        const pAt = t => m.pa + (m.pb - m.pa) * (t - m.ta) / (m.tb - m.ta || 1);
        const xa = X(t0), ya = Y(pAt(t0));
        const tz = Math.max(t1, tEnd), xz = X(tz), yz = Y(pAt(tz));
        if (xa == null || ya == null || xz == null || yz == null) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.6 * vr, selected ? 2.4 * vr : 1.8 * vr);
        // phần giữa hai điểm neo liền nét, phần kéo dài nét đứt
        const xb = X(t1), yb = Y(pAt(t1));
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(xb, yb); ctx.stroke();
        if (xz > xb + 1) {
          ctx.setLineDash([6 * hr, 5 * hr]);
          ctx.beginPath(); ctx.moveTo(xb, yb); ctx.lineTo(xz, yz); ctx.stroke();
          ctx.setLineDash([]);
        }
        // hai đầu neo
        if (selected || m.handles) {
          for (const [x, y] of [[xa, ya], [xb, yb]]) {
            ctx.fillStyle = '#0E1318'; ctx.strokeStyle = color; ctx.lineWidth = 2 * vr;
            ctx.beginPath(); ctx.arc(x, y, 5.5 * vr, 0, 7); ctx.fill(); ctx.stroke();
          }
        }
        if (m.label) label(m.label, xa + 6 * hr, ya - 4 * vr, color);
      };

      if (v.show.bot) for (const m of v.botLines) drawLine(m, C.bot, false);
      for (const m of v.marks) drawLine(m, m.id === v.selId ? C.sel : C.mine, m.id === v.selId);
      if (v.draft) drawLine({ ...v.draft, handles: true }, C.sel, true);

      /* --- điểm neo đầu tiên khi đang kẻ dở --- */
      if (v.pending1) {
        const x = X(v.pending1.t), y = Y(v.pending1.p);
        if (x != null && y != null) {
          ctx.fillStyle = C.sel;
          ctx.beginPath(); ctx.arc(x, y, 5 * vr, 0, 7); ctx.fill();
        }
      }

      /* --- dấu thập ngắm --- */
      // Rê ngón ở đâu cũng được, dấu thập đi theo đúng khoảng cách đó, nên ngón không che
      // mất chỗ cần ngắm. Chạm một cái mới chốt điểm.
      if (v.cross) {
        const x = X(v.cross.t), y = Y(v.cross.p);
        if (x != null && y != null) {
          ctx.strokeStyle = 'rgba(255,214,10,.75)';
          ctx.lineWidth = Math.max(1, vr);
          ctx.setLineDash([5 * hr, 4 * hr]);
          ctx.beginPath(); ctx.moveTo(0, Math.round(y) + .5); ctx.lineTo(W, Math.round(y) + .5); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, 0); ctx.lineTo(Math.round(x) + .5, H); ctx.stroke();
          ctx.setLineDash([]);
          // vòng ngắm
          ctx.strokeStyle = C.sel; ctx.lineWidth = 2.2 * vr;
          ctx.beginPath(); ctx.arc(x, y, 9 * vr, 0, 7); ctx.stroke();
          ctx.fillStyle = C.sel;
          ctx.beginPath(); ctx.arc(x, y, 2.2 * vr, 0, 7); ctx.fill();
          // thẻ giá vàng bên phải, chữ tối cho nổi
          const txt = v.fmt(v.cross.p) + (v.cross.bam ? ' · ' + v.cross.bam : '');
          ctx.font = `700 ${Math.round(10.5 * vr)}px -apple-system,BlinkMacSystemFont,sans-serif`;
          ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
          const wt = ctx.measureText(txt).width;
          ctx.fillStyle = C.sel;
          ctx.fillRect(W - wt - 12 * hr, y - 8 * vr, wt + 12 * hr, 16 * vr);
          ctx.fillStyle = '#1A1206';
          ctx.fillText(txt, W - 6 * hr, y);
        }
      }
    });
  }
}

/* ---------------------------------------------------------------- *
 * Biểu đồ
 * ---------------------------------------------------------------- */
export class ChartView {
  constructor(el, opts = {}) {
    this.el = el;
    this.sym = null; this.tf = '1H'; this.dec = 2;
    this.bars = null; this.step = tfMs('1H');
    this.marks = []; this.botLines = []; this.levels = [];
    this.selId = null; this.draft = null; this.pending1 = null; this.cross = null;
    this.mode = 'pan';                 // 'pan' | 'draw' (đang ngắm) | 'sua' (chỉnh hai đầu)
    this.show = { levels: true, bot: true, ema: true, magnet: true };
    this.on = opts.on || {};
    this.build();
  }

  fmt(p) { return fmtPrice(p, this.dec); }

  build() {
    const Lib = L();
    const chart = this.chart = Lib.createChart(this.el, {
      // KHÔNG dùng autoSize. Nó đo khung qua ResizeObserver, chạy lệch nhịp với lúc mình
      // mở màn biểu đồ; trên iPhone ở chế độ app màn hình chính, khung lúc đó có khi còn
      // bằng 0 nên biểu đồ vẽ ra rỗng. Tự đo, tự đặt kích thước, và tự kiểm lại.
      width: Math.max(80, this.el.clientWidth || 360),
      height: Math.max(120, this.el.clientHeight || 420),
      layout: {
        background: { color: '#0E1318' }, textColor: C.text, fontSize: 11,
        fontFamily: '-apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,sans-serif',
        panes: { separatorColor: C.line, separatorHoverColor: 'rgba(255,255,255,.08)', enableResize: true },
        attributionLogo: false,
      },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.line, scaleMargins: { top: .08, bottom: .22 } },
      // rightOffset: chừa sẵn khoảng trống bên phải cây nến cuối, để còn chỗ kẻ đường
      // vượt qua giá hiện tại
      timeScale: { borderColor: C.line, timeVisible: true, secondsVisible: false, rightOffset: 14, barSpacing: 7, minBarSpacing: .6 },
      crosshair: {
        mode: 0,
        vertLine: { color: 'rgba(139,150,163,.5)', width: 1, style: 2, labelBackgroundColor: '#26313C' },
        horzLine: { color: 'rgba(139,150,163,.5)', width: 1, style: 2, labelBackgroundColor: '#26313C' },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      localization: { priceFormatter: p => this.fmt(p) },
    });

    this.candle = chart.addSeries(Lib.CandlestickSeries, {
      upColor: C.up, downColor: C.dn, borderUpColor: C.up, borderDownColor: C.dn,
      wickUpColor: C.up, wickDownColor: C.dn, priceLineVisible: true, lastValueVisible: true,
      priceLineColor: 'rgba(139,150,163,.6)', priceLineStyle: 2,
    }, 0);

    this.vol = chart.addSeries(Lib.HistogramSeries, {
      priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false,
    }, 0);
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: .84, bottom: 0 }, visible: false });

    this.emaL = chart.addSeries(Lib.LineSeries, {
      color: C.ema, lineWidth: 1.5, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
    }, 0);

    /* khung Stoch */
    // Stoch luôn chạy 0–100, khoá cứng thang đo để khung không co giãn lung tung
    // và mốc 80 / 20 lúc nào cũng nằm đúng chỗ.
    const stLine = (color, w, dash) => chart.addSeries(Lib.LineSeries, {
      color, lineWidth: w, lineStyle: dash ? 2 : 0, lastValueVisible: false, priceLineVisible: false,
      crosshairMarkerVisible: false, priceFormat: { type: 'price', precision: 0, minMove: 1 },
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
    }, 1);
    this.sYk = stLine(C.stY, 2, false);
    this.sYd = stLine('rgba(232,196,74,.55)', 1, true);
    this.sRk = stLine(C.stR, 2, false);
    this.sRd = stLine('rgba(228,90,80,.55)', 1, true);
    this.g80 = stLine('rgba(139,150,163,.3)', 1, true);
    this.g20 = stLine('rgba(139,150,163,.3)', 1, true);

    // Khung Stoch có thang riêng; để lề mặc định thì 0–100 bị đệm thành −20…120.
    try {
      chart.panes()[1].priceScale('right').applyOptions({
        scaleMargins: { top: .06, bottom: .06 }, borderColor: C.line,
      });
    } catch (e) {}

    this.ov = new Overlay(this);
    this.candle.attachPrimitive(this.ov);

    chart.subscribeCrosshairMove(p => this.on.hover && this.on.hover(this.readAt(p)));
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      this.ov.update();
      this.tuChua();
    });

    this.layout();
    this.bindPointer();
    addEventListener('resize', () => this.layout());
    addEventListener('orientationchange', () => setTimeout(() => this.layout(), 250));
    try { new ResizeObserver(() => this.layout()).observe(this.el); } catch (e) {}
  }

  /* Tự đo khung rồi tự đặt kích thước cho biểu đồ.
     Trên iPhone ở chế độ app màn hình chính, lề an toàn trên dưới có thể bóp khung còn rất
     thấp, có lúc bằng 0 ngay lúc vừa mở — lúc đó biểu đồ vẽ ra rỗng. Gặp vậy thì ÉP một
     chiều cao dùng được và ghi lại để còn biết đường mà báo. */
  layout() {
    const el = this.el;
    const wThat = el.clientWidth, hThat = el.clientHeight;
    let w = wThat, h = hThat;
    let ep = false;
    if (!(h > 120)) { h = Math.max(260, Math.round((window.innerHeight || 700) * 0.55)); ep = true; }
    if (!(w > 80)) { w = Math.max(280, window.innerWidth || 360); ep = true; }
    if (ep) el.style.minHeight = h + 'px';
    this.khung = { w, h, wThat, hThat, ep };
    try { this.chart.resize(w, h, true); } catch (e) {}
    try {
      const panes = this.chart.panes();
      if (panes[1]) { panes[0].setHeight(Math.round(h * 0.72)); panes[1].setHeight(Math.round(h * 0.28)); }
    } catch (e) {}
    if (this.ov) this.ov.update();
  }

  /* ---------- đổi qua lại giữa giờ và toạ độ ---------- */

  /* Giờ (ms) → chỉ số nến (cho phép lẻ và vượt ra ngoài để kéo dài đường). */
  idxOf(tMs) {
    const b = this.bars; if (!b) return null;
    return (tMs - b.t[0]) / this.step;
  }
  xOf(tMs) {
    const i = this.idxOf(tMs); if (i == null) return null;
    try { return this.chart.timeScale().logicalToCoordinate(i); } catch (e) { return null; }
  }
  tOf(x) {
    const b = this.bars; if (!b) return null;
    let i = null;
    try { i = this.chart.timeScale().coordinateToLogical(x); } catch (e) { return null; }
    return i == null ? null : b.t[0] + i * this.step;
  }
  /* Giờ ứng với mép phải khung nhìn — để kéo dài đường ra tới đó. */
  rightEdgeMs() {
    const b = this.bars; if (!b) return 0;
    try {
      const r = this.chart.timeScale().getVisibleLogicalRange();
      if (r) return b.t[0] + r.to * this.step;
    } catch (e) {}
    return b.t.at(-1);
  }
  /* Bắt điểm neo về đúng nến gần nhất.
     Cho phép đặt neo ra PHÍA PHẢI cây nến cuối (khoảng trống tương lai) — kẻ trendline
     thường phải kéo qua giá hiện tại. Chỉ chặn phía trái, chỗ không có dữ liệu. */
  snapT(tMs) {
    const b = this.bars; if (!b) return tMs;
    const i = Math.round((tMs - b.t[0]) / this.step);
    const max = b.t.length - 1 + 1000;
    return b.t[0] + Math.max(0, Math.min(max, i)) * this.step;
  }

  readAt(p) {
    if (!p || !p.time || !this.bars) return null;
    const ms = toMs(p.time), i = Math.round((ms - this.bars.t[0]) / this.step);
    const b = this.bars;
    if (i < 0 || i >= b.c.length) return null;
    return { i, t: b.t[i], o: b.o[i], h: b.h[i], l: b.l[i], c: b.c[i], v: b.v[i] };
  }

  /* ---------- nạp dữ liệu ---------- */

  /* Mỗi lần nạp mang một số thứ tự. Nạp xong mà số đã cũ nghĩa là trong lúc chờ mạng
     người dùng đã mở đồng khác — bỏ kết quả này đi, nếu không nó đè lên biểu đồ mới. */
  async load(sym, tf, tickSz) {
    const lan = (this._lan = (this._lan || 0) + 1);
    const k = await candles(sym, tf, 300);
    if (lan !== this._lan) return false;
    this.sym = sym; this.tf = tf; this.step = tfMs(tf);
    this.dec = decimalsOf(tickSz || 0, k.c.at(-1));
    this.setBars(k);
    return true;
  }

  setBars(k) {
    this.bars = k;
    const n = k.c.length;
    const cd = [], vd = [];
    for (let i = 0; i < n; i++) {
      const t = toSec(k.t[i]);
      cd.push({ time: t, open: k.o[i], high: k.h[i], low: k.l[i], close: k.c[i] });
      vd.push({ time: t, value: k.v[i], color: k.c[i] >= k.o[i] ? 'rgba(47,190,140,.35)' : 'rgba(228,90,80,.35)' });
    }
    this.candle.setData(cd);
    this.vol.setData(vd);
    this.candle.applyOptions({ priceFormat: { type: 'price', precision: this.dec, minMove: Math.pow(10, -this.dec) } });

    const e = ema(k.c, 200);
    this.emaL.setData(this.show.ema ? cd.map((d, i) => ({ time: d.time, value: e[i] })).filter(d => Number.isFinite(d.value)) : []);

    const A = stoch(k, 32, 13, 5), B = stoch(k, 10, 5, 5);
    const ser = (arr, s) => cd.map((d, i) => ({ time: d.time, value: arr[i] })).filter(d => Number.isFinite(d.value));
    this.sYk.setData(ser(A.k)); this.sYd.setData(ser(A.d));
    this.sRk.setData(ser(B.k)); this.sRd.setData(ser(B.d));
    this.g80.setData(cd.map(d => ({ time: d.time, value: 80 })));
    this.g20.setData(cd.map(d => ({ time: d.time, value: 20 })));

    this.levels = keyLevels(k, 160, .6).filter(l => l.n >= 2).slice(0, 6);
    this.stochNow = {
      y: { k: A.k.at(-1), d: A.d.at(-1) },
      r: { k: B.k.at(-1), d: B.d.at(-1) },
    };
    this.ov.update();
  }

  /* Cập nhật giá cây nến đang chạy mà không tải lại cả chuỗi.
     Chỉ nhận giá CỦA ĐÚNG ĐỒNG đang vẽ, và phải nằm trong khoảng hợp lý so với cây nến
     hiện tại — giá lệch cả chục lần là giá của đồng khác lọt sang, ghi vào là nến bẹp dí. */
  tick(last, sym) {
    const b = this.bars; if (!b || !Number.isFinite(last) || last <= 0) return;
    if (sym && sym !== this.sym) return;
    const truoc = b.c.at(-1);
    if (Number.isFinite(truoc) && truoc > 0) {
      const ti = last / truoc;
      if (ti > 1.5 || ti < 0.67) return;
    }
    const i = b.c.length - 1;
    b.c[i] = last;
    if (last > b.h[i]) b.h[i] = last;
    if (last < b.l[i]) b.l[i] = last;
    this.candle.update({ time: toSec(b.t[i]), open: b.o[i], high: b.h[i], low: b.l[i], close: last });
  }

  /* Khung nhìn có đang thấy nến không, hay đã lạc ra vùng trống? */
  coNen() {
    const b = this.bars; if (!b) return false;
    try {
      const r = this.chart.timeScale().getVisibleLogicalRange();
      if (!r) return false;
      const chung = Math.min(r.to, b.c.length) - Math.max(r.from, 0);
      return chung / Math.max(1, r.to - r.from) > 0.15;
    } catch (e) { return false; }
  }

  /* Lưới an toàn: khung nhìn mà trôi hẳn ra chỗ không có nến thì tự kéo về.
     Không ai cố ý nhìn vào khoảng trống trắng, nên trường hợp này luôn là hỏng — dù hỏng
     vì lý do gì. Chỉ chạy khi KHÔNG đang kẻ và KHÔNG đang chạm, để không giật tay người dùng. */
  tuChua() {
    if (this._dangCham || this.mode === 'draw') return;
    if (!this.bars || this.coNen()) { this._hen = null; return; }
    if (this._hen) return;
    this._hen = setTimeout(() => {
      this._hen = null;
      if (this._dangCham || this.mode === 'draw' || this.coNen()) return;
      this.fit();
      if (this.on.daChua) this.on.daChua();
    }, 500);
  }

  /* Đưa khung nhìn về cây nến mới nhất, chừa sẵn khoảng trống bên phải.
     scrollToRealTime() không kéo về khi biểu đồ đã bị cuộn xa ra tương lai, nên đặt thẳng vị trí.
     Đặt xong còn kiểm lại: vẫn không thấy nến thì ép khung ôm trọn dữ liệu. */
  fit() {
    const ts = this.chart.timeScale();
    try { ts.scrollToPosition(ts.options().rightOffset || 14, false); } catch (e) {}
    if (this.coNen()) return;
    try { ts.scrollToRealTime(); } catch (e) {}
    if (this.coNen()) return;
    try { ts.fitContent(); } catch (e) {}
  }

  /* ---------- chạm, kéo, kẻ đường ---------- */

  /* Khung vẽ của phần nến, tính bằng điểm ảnh CSS (trừ cột giá bên phải và khung Stoch). */
  khungVe() {
    const k = this.khung || { w: this.el.clientWidth, h: this.el.clientHeight };
    let w = k.w, h = k.h;
    try { w -= this.chart.priceScale('right').width(); } catch (e) {}
    try { h = this.chart.panes()[0].getHeight(); } catch (e) {}
    return { w: Math.max(40, w), h: Math.max(40, h) };
  }

  /* Điểm neo từ toạ độ chạm. Nam châm: ở gần đầu râu hay mép thân nến thì bám vào đó,
     vì trendline phải chạm đúng đầu râu / mép thân chứ không phải lơ lửng giữa không. */
  diem(x, y) {
    const t = this.snapT(this.tOf(x));
    let p = null;
    try { p = this.candle.coordinateToPrice(y); } catch (e) {}
    if (t == null || p == null) return null;
    if (!this.show.magnet) return { t, p, bam: null };
    const b = this.bars, i = Math.round((t - b.t[0]) / this.step);
    if (i < 0 || i >= b.c.length) return { t, p, bam: null };

    // Nến trên điện thoại chỉ cao vài điểm ảnh, nên "bám mức gần nhất" hay nhảy lung tung:
    // ngắm râu trên mà lệch vài điểm ảnh là nó bám sang râu dưới. Luật rõ hơn: ngón ở NỬA TRÊN
    // cây nến thì chỉ xét râu trên và mép thân trên, nửa dưới thì chỉ xét râu dưới và mép thân dưới.
    const px = v => this.candle.priceToCoordinate(v);
    const yHi = px(b.h[i]), yLo = px(b.l[i]);
    if (yHi == null || yLo == null) return { t, p, bam: null };
    const tren = y <= (yHi + yLo) / 2;
    const than = tren ? Math.max(b.o[i], b.c[i]) : Math.min(b.o[i], b.c[i]);
    const ung = tren
      ? [['râu trên', b.h[i]], ['thân trên', than]]
      : [['râu dưới', b.l[i]], ['thân dưới', than]];

    let best = null;
    for (const [ten, v] of ung) {
      const yy = px(v); if (yy == null) continue;
      const d = Math.abs(yy - y);
      if (d > 18) continue;
      // râu được ưu ái 3 điểm ảnh — kẻ trendline thường bám đầu râu hơn là mép thân
      const uu = ten.startsWith('râu') ? d - 3 : d;
      if (!best || uu < best.uu) best = { uu, p: v, ten };
    }
    return best ? { t, p: best.p, bam: best.ten } : { t, p, bam: null };
  }

  /* Đặt dấu thập theo toạ độ điểm ảnh, cập nhật nét xem trước và dòng chữ dưới đáy. */
  datNgam(nx, ny) {
    const d = this.diem(nx, ny);
    if (!d) return;
    this.cross = d;
    if (this.pending1) {
      this.draft = { id: 'nhap', ta: this.pending1.t, pa: this.pending1.p, tb: d.t, pb: d.p, nhap: true };
    }
    this.ov.update();
    if (this.on.live) this.on.live(d);
  }

  /* Giữ dấu thập ở mép thì cuộn biểu đồ về phía đó, mỗi nhịp một chút.
     huong: 1 sang phải (ra tương lai) · −1 sang trái · 0 dừng. */
  tuCuon(huong, nx, ny) {
    if (this._cuonHuong === huong) return;
    this._cuonHuong = huong;
    clearInterval(this._cuon);
    this._cuon = null;
    if (!huong) return;
    const ts = this.chart.timeScale();
    this._cuon = setInterval(() => {
      let p, span = 50;
      try {
        p = ts.scrollPosition();
        const r = ts.getVisibleLogicalRange();
        if (r) span = r.to - r.from;
      } catch (e) { return; }
      // Chặn ở 60% bề ngang: cuộn quá tay thì nến bị đẩy hết ra khỏi màn hình, nhìn vào
      // chỉ thấy khoảng trống. Muốn với xa hơn nữa thì chụm hai ngón thu nhỏ lại — giới hạn
      // này tính theo số nến đang nhìn thấy nên tự nới ra theo.
      const tran = Math.max(14, span * 0.6);
      const moi = Math.max(-(this.bars ? this.bars.c.length - 10 : 0), Math.min(tran, p + huong * 1.6));
      if (Math.abs(moi - p) < 0.01) return;
      try { ts.scrollToPosition(moi, false); } catch (e) { return; }
      this.datNgam(nx, ny);
    }, 40);
  }
  dungCuon() { clearInterval(this._cuon); this._cuon = null; this._cuonHuong = 0; }

  bindPointer() {
    const el = this.el;
    this.pad = document.createElement('div');
    // z-index phải trên cả thanh chia khung của thư viện (z-index 50), nếu không thì chạm
    // trúng đường ranh giữa khung nến và khung Stoch là mất, không chốt được điểm.
    this.pad.style.cssText = 'position:absolute;inset:0;z-index:60;touch-action:none;display:none';
    el.style.position = 'relative';
    el.appendChild(this.pad);

    let drag = null, daKeo = false, neo = null, nPointer = 0;

    const pos = ev => {
      const r = el.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };
    const bao = d => { if (this.on.live) this.on.live(d); };
    const XY = c => ({
      x: this.xOf(c.t),
      y: this.candle.priceToCoordinate(c.p),
    });

    /* Dựng đường từ hai điểm neo, xếp điểm cũ trước. */
    const chot = (a, b) => {
      if (a.t === b.t) { if (this.on.badSecond) this.on.badSecond(); return false; }
      const [x, y] = a.t < b.t ? [a, b] : [b, a];
      this.draft = { id: 'm' + Date.now().toString(36), ta: x.t, pa: x.p, tb: y.t, pb: y.p };
      this.pending1 = null; this.cross = null; this.dungCuon();
      this.mode = 'sua';                 // vẫn giữ pad để kéo lại hai đầu
      this.setPad(); this.ov.update();
      if (this.on.ready) this.on.ready(this.draft);
      return true;
    };

    this.pad.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      nPointer++;
      // Hai ngón = muốn phóng to. Bỏ nét đang kẻ dở và nhả pad ra cho biểu đồ nhận.
      if (nPointer > 1) {
        drag = null; this.dungCuon();
        if (this.mode === 'draw' && !this.draft) { this.pending1 = null; this.ov.update(); }
        this.pad.style.pointerEvents = 'none';
        setTimeout(() => { this.pad.style.pointerEvents = ''; }, 700);
        return;
      }
      const { x, y } = pos(ev);
      const d = this.diem(x, y);
      if (!d) return;
      try { this.pad.setPointerCapture(ev.pointerId); } catch (e) {}

      // Đã có đường HOÀN CHỈNH → thử bắt một đầu neo để kéo lại. Đường nháp đang rê
      // (cờ nhap) không tính: nó chỉ là nét xem trước, bắt vào nó thì chốt điểm hỏng.
      const m = (this.draft && !this.draft.nhap) ? this.draft : this.marks.find(k => k.id === this.selId);
      if (m) {
        const kc = (tt, pp) => {
          const xx = this.xOf(tt), yy = this.candle.priceToCoordinate(pp);
          return xx == null || yy == null ? 1e9 : Math.hypot(xx - x, yy - y);
        };
        const da = kc(m.ta, m.pa), db = kc(m.tb, m.pb);
        if (Math.min(da, db) < 34) {
          drag = { kieu: 'dau', m, end: da <= db ? 'a' : 'b' };
          daKeo = false;
          return;
        }
      }

      if (this.mode !== 'draw') return;

      // Kiểu dấu thập ngắm: rê ngón để dời dấu thập ĐÚNG BẰNG quãng ngón đi, nên ngón
      // đặt chỗ nào cũng được, không che mất chỗ cần ngắm. Chạm một cái mới chốt điểm.
      const c0 = XY(this.cross);
      if (c0.x == null || c0.y == null) return;
      drag = { kieu: 'ngam', fx: x, fy: y, cx: c0.x, cy: c0.y };
      daKeo = false;
    });

    this.pad.addEventListener('pointermove', ev => {
      if (!drag || nPointer > 1) return;
      ev.preventDefault();
      const { x, y } = pos(ev);

      if (drag.kieu === 'ngam') {
        if (Math.hypot(x - drag.fx, y - drag.fy) > 5) daKeo = true;
        // Chặn dấu thập trong khung nến: ra ngoài là mất tăm, không biết đang ngắm đâu.
        const k = this.khungVe();
        const nx = Math.max(2, Math.min(k.w - 2, drag.cx + (x - drag.fx)));
        const ny = Math.max(2, Math.min(k.h - 2, drag.cy + (y - drag.fy)));
        this.datNgam(nx, ny);
        // Đẩy tới mép thì biểu đồ tự chạy, nhờ vậy kẻ ra xa tới đâu cũng được —
        // không bị bó trong khoảng trống có sẵn bên phải.
        const MEP = 44;
        const huong = nx >= k.w - MEP ? 1 : nx <= MEP ? -1 : 0;
        this.tuCuon(huong, nx, ny);
        return;
      }

      const d = this.diem(x, y);
      if (!d) return;
      daKeo = true;
      if (drag.end === 'a') { drag.m.ta = d.t; drag.m.pa = d.p; }
      else { drag.m.tb = d.t; drag.m.pb = d.p; }
      this.ov.update();
      bao(d);
    });

    const xong = ev => {
      nPointer = Math.max(0, nPointer - 1);
      this.dungCuon();
      if (!drag) return;
      const k = drag; drag = null;
      if (k.kieu === 'ngam') {
        if (daKeo) return;                       // chỉ là rê để ngắm, chưa chốt gì
        // chạm một cái = chốt điểm tại dấu thập
        if (!this.pending1) {
          this.pending1 = { t: this.cross.t, p: this.cross.p };
          this.ov.update();
          if (this.on.tapMode) this.on.tapMode();
        } else {
          this.draft = null;
          chot(this.pending1, { t: this.cross.t, p: this.cross.p });
        }
        return;
      }
      // Kéo một đầu vượt qua đầu kia thì hai điểm neo đảo thứ tự — xếp lại cho đúng
      // "điểm cũ trước, điểm mới sau", vì phần hiển thị và bot đều đọc theo thứ tự đó.
      const m = k.m;
      if (m && m.ta > m.tb) {
        const t = m.ta, p = m.pa;
        m.ta = m.tb; m.pa = m.pb; m.tb = t; m.pb = p;
        this.ov.update();
      }
      if (this.on.moved) this.on.moved(m);
    };
    this.pad.addEventListener('pointerup', xong);
    this.pad.addEventListener('pointercancel', xong);
    this.batDauNeo();
  }

  /* Chỉnh hai đầu neo SAU KHI đã kẻ xong, mà không khoá biểu đồ.
     Bắt sự kiện ở pha capture trên chính khung biểu đồ: cú chạm rơi sát đầu neo thì mình
     giữ lấy, còn lại thả cho thư viện kéo và phóng như thường. */
  batDauNeo() {
    const el = this.el;
    let drag = null;
    const pos = ev => {
      const r = el.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };

    el.addEventListener('pointerdown', ev => {
      this._dangCham = true;                       // đang chạm thì đừng tự kéo khung nhìn
      if (this.mode !== 'sua' || !this.draft) return;
      const { x, y } = pos(ev);
      const m = this.draft;
      const kc = (tt, pp) => {
        const xx = this.xOf(tt), yy = this.candle.priceToCoordinate(pp);
        return xx == null || yy == null ? 1e9 : Math.hypot(xx - x, yy - y);
      };
      const da = kc(m.ta, m.pa), db = kc(m.tb, m.pb);
      if (Math.min(da, db) > 30) return;           // xa đầu neo → để biểu đồ nhận
      ev.preventDefault(); ev.stopPropagation();
      drag = { m, end: da <= db ? 'a' : 'b' };
      try { el.setPointerCapture(ev.pointerId); } catch (e) {}
    }, true);

    el.addEventListener('pointermove', ev => {
      if (!drag) return;
      ev.preventDefault(); ev.stopPropagation();
      const { x, y } = pos(ev);
      const d = this.diem(x, y);
      if (!d) return;
      if (drag.end === 'a') { drag.m.ta = d.t; drag.m.pa = d.p; }
      else { drag.m.tb = d.t; drag.m.pb = d.p; }
      this.ov.update();
      if (this.on.live) this.on.live(d);
    }, true);

    const het = ev => {
      this._dangCham = false;
      setTimeout(() => this.tuChua(), 60);         // nhả tay rồi mới xét có cần kéo về không
      if (!drag) return;
      ev.stopPropagation();
      const m = drag.m; drag = null;
      if (m.ta > m.tb) {
        const t = m.ta, p = m.pa;
        m.ta = m.tb; m.pa = m.pb; m.tb = t; m.pb = p;
        this.ov.update();
      }
      if (this.on.moved) this.on.moved(m);
    };
    el.addEventListener('pointerup', het, true);
    el.addEventListener('pointercancel', het, true);
  }

  /* Lớp phủ CHỈ bật khi đang ngắm. Kẻ xong rồi thì tắt đi, trả biểu đồ lại cho ngón tay —
     lúc đó muốn chỉnh hai đầu neo thì có bộ bắt riêng ở dưới (batDauNeo), chỉ ăn cú chạm
     rơi sát ngay đầu neo, còn lại để biểu đồ kéo và phóng như thường. */
  setPad() {
    const active = this.mode === 'draw';
    this.pad.style.display = active ? 'block' : 'none';
    this.pad.style.cursor = active ? 'crosshair' : 'default';
  }

  /* Đặt dấu thập vào giữa khung nhìn, ngang giá hiện tại — chỗ nào cũng rê tới được. */
  datCross() {
    const b = this.bars; if (!b) return;
    let i = b.c.length - 1;
    try {
      const r = this.chart.timeScale().getVisibleLogicalRange();
      if (r) i = Math.round((r.from + r.to) / 2);
    } catch (e) {}
    i = Math.max(0, Math.min(b.c.length - 1, i));
    // giá lấy ở giữa khung đang nhìn, không lấy giá hiện tại — giá hiện tại có thể đang
    // nằm sát mép trên, dấu thập hiện ra chỗ khó thấy
    let p = b.c.at(-1);
    try { const q = this.candle.coordinateToPrice(this.khungVe().h / 2); if (q != null) p = q; } catch (e) {}
    this.cross = { t: b.t[i], p, bam: null };
  }

  startDraw() {
    this.mode = 'draw'; this.pending1 = null; this.draft = null; this.selId = null;
    this.datCross(); this.setPad(); this.ov.update();
    if (this.on.live && this.cross) this.on.live(this.cross);
  }
  cancelDraw() { this.dungCuon(); this.mode = 'pan'; this.pending1 = null; this.draft = null; this.cross = null; this.setPad(); this.ov.update(); }
  select(id) { this.selId = id; this.draft = null; this.mode = 'pan'; this.setPad(); this.ov.update(); }
  setMarks(a) { this.marks = a || []; this.ov.update(); }
  setBotLines(a) { this.botLines = a || []; this.ov.update(); }
  toggle(key, on) { this.show[key] = on; if (key === 'ema') this.setBars(this.bars); else this.ov.update(); }

  destroy() { this.dungCuon(); try { this.chart.remove(); } catch (e) {} }
}
