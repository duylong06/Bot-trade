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
    this.selId = null; this.draft = null; this.pending1 = null;
    this.mode = 'pan';                 // 'pan' | 'draw'
    this.show = { levels: true, bot: true, ema: true };
    this.on = opts.on || {};
    this.build();
  }

  fmt(p) { return fmtPrice(p, this.dec); }

  build() {
    const Lib = L();
    const chart = this.chart = Lib.createChart(this.el, {
      autoSize: true,
      layout: {
        background: { color: '#0E1318' }, textColor: C.text, fontSize: 11,
        fontFamily: '-apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,sans-serif',
        panes: { separatorColor: C.line, separatorHoverColor: 'rgba(255,255,255,.08)', enableResize: true },
        attributionLogo: false,
      },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.line, scaleMargins: { top: .08, bottom: .22 } },
      timeScale: { borderColor: C.line, timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 7, minBarSpacing: .6 },
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

    this.ov = new Overlay(this);
    this.candle.attachPrimitive(this.ov);

    chart.subscribeCrosshairMove(p => this.on.hover && this.on.hover(this.readAt(p)));
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => this.ov.update());

    this.layout();
    this.bindPointer();
    addEventListener('resize', () => this.layout());
  }

  layout() {
    try {
      const panes = this.chart.panes();
      const h = this.el.clientHeight || 420;
      if (panes[1]) { panes[0].setHeight(Math.round(h * 0.72)); panes[1].setHeight(Math.round(h * 0.28)); }
    } catch (e) {}
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
  /* Bắt điểm neo về đúng nến gần nhất. */
  snapT(tMs) {
    const b = this.bars; if (!b) return tMs;
    const i = Math.round((tMs - b.t[0]) / this.step);
    return b.t[0] + Math.max(0, Math.min(b.t.length - 1, i)) * this.step;
  }

  readAt(p) {
    if (!p || !p.time || !this.bars) return null;
    const ms = toMs(p.time), i = Math.round((ms - this.bars.t[0]) / this.step);
    const b = this.bars;
    if (i < 0 || i >= b.c.length) return null;
    return { i, t: b.t[i], o: b.o[i], h: b.h[i], l: b.l[i], c: b.c[i], v: b.v[i] };
  }

  /* ---------- nạp dữ liệu ---------- */

  async load(sym, tf, tickSz) {
    this.sym = sym; this.tf = tf; this.step = tfMs(tf);
    const k = await candles(sym, tf, 300);
    this.dec = decimalsOf(tickSz || 0, k.c.at(-1));
    this.setBars(k);
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

  /* Cập nhật giá cây nến đang chạy mà không tải lại cả chuỗi. */
  tick(last) {
    const b = this.bars; if (!b || !Number.isFinite(last)) return;
    const i = b.c.length - 1;
    b.c[i] = last;
    if (last > b.h[i]) b.h[i] = last;
    if (last < b.l[i]) b.l[i] = last;
    this.candle.update({ time: toSec(b.t[i]), open: b.o[i], high: b.h[i], low: b.l[i], close: last });
  }

  fit() { try { this.chart.timeScale().scrollToRealTime(); } catch (e) {} }

  /* ---------- chạm, kéo, kẻ đường ---------- */

  bindPointer() {
    const el = this.el;
    this.pad = document.createElement('div');
    this.pad.style.cssText = 'position:absolute;inset:0;z-index:5;touch-action:none;display:none';
    el.style.position = 'relative';
    el.appendChild(this.pad);

    let drag = null;

    const pos = ev => {
      const r = el.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };
    const priceAt = y => { try { return this.candle.coordinateToPrice(y); } catch (e) { return null; } };

    this.pad.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      const { x, y } = pos(ev);
      const t = this.snapT(this.tOf(x)), p = priceAt(y);
      if (t == null || p == null) return;

      if (this.mode === 'draw') {
        if (!this.pending1) { this.pending1 = { t, p }; this.ov.update(); }
        else {
          const m = { id: 'm' + Date.now().toString(36), ta: this.pending1.t, pa: this.pending1.p, tb: t, pb: p };
          this.pending1 = null; this.draft = m; this.mode = 'pan'; this.setPad();
          this.ov.update();
          if (this.on.drafted) this.on.drafted(m);
        }
        return;
      }

      // chế độ sửa: bắt đầu kéo một đầu neo của đường đang chọn
      const m = this.draft || this.marks.find(k => k.id === this.selId);
      if (!m) return;
      const d = (tt, pp) => {
        const xx = this.xOf(tt), yy = this.candle.priceToCoordinate(pp);
        return xx == null || yy == null ? 1e9 : Math.hypot(xx - x, yy - y);
      };
      const da = d(m.ta, m.pa), db = d(m.tb, m.pb);
      if (Math.min(da, db) < 26) drag = { m, end: da <= db ? 'a' : 'b' };
    });

    this.pad.addEventListener('pointermove', ev => {
      if (!drag) return;
      ev.preventDefault();
      const { x, y } = pos(ev);
      const t = this.snapT(this.tOf(x)), p = priceAt(y);
      if (t == null || p == null) return;
      if (drag.end === 'a') { drag.m.ta = t; drag.m.pa = p; } else { drag.m.tb = t; drag.m.pb = p; }
      this.ov.update();
    });

    const end = () => {
      if (drag && this.on.moved) this.on.moved(drag.m);
      drag = null;
    };
    this.pad.addEventListener('pointerup', end);
    this.pad.addEventListener('pointercancel', end);
  }

  setPad() {
    const active = this.mode === 'draw' || !!this.draft || !!this.selId;
    this.pad.style.display = active ? 'block' : 'none';
    this.pad.style.cursor = this.mode === 'draw' ? 'crosshair' : 'default';
  }

  startDraw() { this.mode = 'draw'; this.pending1 = null; this.draft = null; this.selId = null; this.setPad(); this.ov.update(); }
  cancelDraw() { this.mode = 'pan'; this.pending1 = null; this.draft = null; this.setPad(); this.ov.update(); }
  select(id) { this.selId = id; this.draft = null; this.mode = 'pan'; this.setPad(); this.ov.update(); }
  setMarks(a) { this.marks = a || []; this.ov.update(); }
  setBotLines(a) { this.botLines = a || []; this.ov.update(); }
  toggle(key, on) { this.show[key] = on; if (key === 'ema') this.setBars(this.bars); else this.ov.update(); }

  destroy() { try { this.chart.remove(); } catch (e) {} }
}
