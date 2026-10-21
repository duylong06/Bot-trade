// app/chart.js — biểu đồ kiểu OKX/TradingView: nến realtime, EMA200, Stoch 32/13/5 + 10/5/5,
// cùng các đường xu hướng và điểm phá mà bot đang theo dõi (tính bằng đúng lõi của bot).
import { analyze, lineAt, HOUR, fromRows } from '../core/breakout.js';
import * as okx from '../core/okx.js';
import { fmtPrice, hhmm, stamp, decimalsOf } from '../core/format.js';
import { ema, stoch } from './indicators.js';

const L = window.LightweightCharts;
const TZ = -new Date().getTimezoneOffset() * 60;            // lệch giờ so với UTC, tính bằng giây
const T = ms => Math.floor(ms / 1000) + TZ;                  // giờ đưa vào chart (chart hiển thị như UTC)
const MS = sec => (sec - TZ) * 1000;

export const COLORS = {
  up: '#c3f23f', down: '#f2398b', ema: '#f6a51a', blue: '#2f7dff', blueDim: 'rgba(47,125,255,0.55)',
  focus: '#ffd60a', stochY: '#f5d90a', stochR: '#ff4a4a', grid: 'rgba(255,255,255,0.045)', text: '#8b8e95', line: '#24262b',
};

export const TFS = [
  { id: '5m', label: '5m', ms: 5 * 60e3 },
  { id: '15m', label: '15m', ms: 15 * 60e3 },
  { id: '1H', label: '1H', ms: HOUR },
  { id: '4H', label: '4H', ms: 4 * HOUR },
  { id: '1Dutc', label: '1D', ms: 24 * HOUR },
];

export class ChartView {
  constructor(el, ws, hooks = {}) {
    this.el = el; this.ws = ws; this.hooks = hooks;
    this.inst = null; this.tf = '1H'; this.tickSz = null;
    this.bars = null; this.h1 = null; this.res = null;
    this.lineSeries = []; this.focus = null; this.show = { lines: true, ema: true, stoch: true };
    this.unsub = null; this.seq = 0;
    this.build();
    this.scheduleHourly();
  }

  build() {
    const c = this.chart = L.createChart(this.el, {
      autoSize: true,
      layout: {
        background: { type: 'solid', color: '#000000' }, textColor: COLORS.text, fontSize: 11,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Roboto, sans-serif',
        panes: { separatorColor: COLORS.line, separatorHoverColor: 'rgba(255,255,255,0.08)', enableResize: true },
        attributionLogo: true,
      },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      rightPriceScale: { borderColor: COLORS.line, scaleMargins: { top: 0.08, bottom: 0.12 } },
      timeScale: { borderColor: COLORS.line, timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 4.5, minBarSpacing: 1 },
      crosshair: { mode: L.CrosshairMode.Normal, vertLine: { color: '#5d6067', labelBackgroundColor: '#2a2c31' }, horzLine: { color: '#5d6067', labelBackgroundColor: '#2a2c31' } },
      localization: { locale: 'en-US' },
    });

    this.candles = c.addSeries(L.CandlestickSeries, {
      upColor: COLORS.up, downColor: COLORS.down, borderVisible: false,
      wickUpColor: COLORS.up, wickDownColor: COLORS.down,
    }, 0);
    this.vol = c.addSeries(L.HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false }, 0);
    c.priceScale('vol', 0).applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
    this.ema = c.addSeries(L.LineSeries, { color: COLORS.ema, lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }, 0);
    this.markers = L.createSeriesMarkers(this.candles, []);

    const fixed = () => ({ priceRange: { minValue: 0, maxValue: 100 } });
    const st = (color, width) => ({ color, lineWidth: width, lastValueVisible: true, priceLineVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: fixed, priceFormat: { type: 'price', precision: 2, minMove: 0.01 } });
    this.kY = c.addSeries(L.LineSeries, st(COLORS.stochY, 2), 1);
    this.dY = c.addSeries(L.LineSeries, st('rgba(245,217,10,0.55)', 1), 1);
    this.kR = c.addSeries(L.LineSeries, st(COLORS.stochR, 2), 1);
    this.dR = c.addSeries(L.LineSeries, st('rgba(255,74,74,0.55)', 1), 1);
    for (const p of [80, 50, 20]) this.kY.createPriceLine({ price: p, color: 'rgba(255,255,255,0.22)', lineWidth: 1, lineStyle: L.LineStyle.Dashed, axisLabelVisible: false });
    c.panes()[0].setStretchFactor(3);
    c.panes()[1].setStretchFactor(1);

    c.subscribeCrosshairMove(p => this.legend(p));
  }

  /* ---------- tải dữ liệu ---------- */

  async open(inst, tickSz, tf = this.tf, focus = null) {
    const seq = ++this.seq;
    const changedSym = inst !== this.inst;
    this.inst = inst; this.tickSz = tickSz; this.tf = tf; this.focus = focus;
    const d = tickSz ? Math.min(10, decimalsOf(tickSz)) : 4;
    this.candles.applyOptions({ priceFormat: { type: 'custom', minMove: tickSz ? +tickSz : 0.0001, formatter: p => fmtPrice(p, tickSz || null) } });
    this.hooks.onStatus && this.hooks.onStatus('loading');

    try {
      const [rows, h1] = await Promise.all([
        this.fetchRows(inst, tf, tf === '1H' ? 520 : 600),
        tf === '1H' ? null : okx.candles(inst, '1H', 520),
      ]);
      if (seq !== this.seq) return;
      this.bars = rows;
      this.h1 = tf === '1H' ? fromRows(rows.closed) : h1.K;
      this.render(true);
      this.analyze();
      this.subscribe();
      if (!focus) this.chart.timeScale().scrollToRealTime();
      this.hooks.onStatus && this.hooks.onStatus('ok');
    } catch (e) {
      if (seq !== this.seq) return;
      this.hooks.onStatus && this.hooks.onStatus('error', e.message);
    }
    if (changedSym) this.hooks.onSymbol && this.hooks.onSymbol(inst);
  }

  async fetchRows(inst, bar, count) {
    const seen = new Map();
    let after;
    for (let page = 0; page < 3 && seen.size < count; page++) {
      const p = { instId: inst, bar, limit: '300' };
      if (after) p.after = after;
      const d = await okx.api('/api/v5/market/candles', p);
      if (!d.length) break;
      for (const r of d) seen.set(r[0], r);
      after = d[d.length - 1][0];
      if (d.length < 300) break;
    }
    const all = [...seen.values()].sort((a, b) => a[0] - b[0]).slice(-count);
    return { all, closed: all.filter(r => r[8] === '1') };
  }

  subscribe() {
    if (this.unsub) this.unsub();
    const channel = 'candle' + this.tf;
    const inst = this.inst, tf = this.tf;
    this.unsub = this.ws.sub({ channel, instId: inst }, data => {
      if (inst !== this.inst || tf !== this.tf) return;
      for (const r of data) this.onRow(r);
    });
  }

  // Sau khi mất kết nối: lấy lại vài nến gần nhất để vá chỗ hổng.
  async resync() {
    if (!this.inst) return;
    try {
      const d = await okx.api('/api/v5/market/candles', { instId: this.inst, bar: this.tf, limit: '100' });
      d.sort((a, b) => a[0] - b[0]).forEach(r => this.onRow(r));
    } catch {}
  }

  onRow(r) {
    if (!this.bars) return;
    const all = this.bars.all;
    const last = all[all.length - 1];
    if (last && +r[0] < +last[0]) {
      const i = all.findIndex(x => x[0] === r[0]);
      if (i >= 0) all[i] = r; else return;
      this.render(true);
      return;
    }
    if (last && r[0] === last[0]) all[all.length - 1] = r; else all.push(r);
    const bar = this.toBar(r);
    this.candles.update(bar);
    this.vol.update(this.toVol(r));
    this.indicators(false);
    this.legend(null);
    this.hooks.onPrice && this.hooks.onPrice(+r[4]);
    if (r[8] === '1' && this.tf === '1H') this.onH1Close();
  }

  /* ---------- vẽ ---------- */

  toBar(r) { return { time: T(+r[0]), open: +r[1], high: +r[2], low: +r[3], close: +r[4] }; }
  toVol(r) { return { time: T(+r[0]), value: +(r[7] || r[5]), color: +r[4] >= +r[1] ? 'rgba(195,242,63,0.32)' : 'rgba(242,57,139,0.32)' }; }

  render(full) {
    const all = this.bars.all;
    this.candles.setData(all.map(r => this.toBar(r)));
    this.vol.setData(all.map(r => this.toVol(r)));
    this.indicators(true);
    this.legend(null);
    if (full && all.length) this.hooks.onPrice && this.hooks.onPrice(+all[all.length - 1][4]);
  }

  indicators(full) {
    const all = this.bars.all;
    const h = all.map(r => +r[2]), l = all.map(r => +r[3]), c = all.map(r => +r[4]);
    const times = all.map(r => T(+r[0]));
    const e = ema(c, 200), y = stoch(h, l, c, 32, 13, 5), rr = stoch(h, l, c, 10, 5, 5);
    this.last = { ema: e[e.length - 1], kY: y.k[y.k.length - 1], dY: y.d[y.d.length - 1], kR: rr.k[rr.k.length - 1], dR: rr.d[rr.d.length - 1] };
    const pts = arr => arr.map((v, i) => (v == null ? { time: times[i] } : { time: times[i], value: v }));
    const set = (s, arr, on) => {
      if (!on) { s.setData([]); return; }
      if (full) s.setData(pts(arr)); else if (arr[arr.length - 1] != null) s.update({ time: times[times.length - 1], value: arr[arr.length - 1] });
    };
    set(this.ema, e, this.show.ema);
    set(this.kY, y.k, this.show.stoch); set(this.dY, y.d, this.show.stoch);
    set(this.kR, rr.k, this.show.stoch); set(this.dR, rr.d, this.show.stoch);
  }

  legend(p) {
    if (!this.bars || !this.hooks.onLegend) return;
    let r = null;
    if (p && p.time != null) {
      const t = MS(p.time);
      r = this.bars.all.find(x => +x[0] === t);
    }
    if (!r) r = this.bars.all[this.bars.all.length - 1];
    if (!r) return;
    const tf = TFS.find(x => x.id === this.tf);
    const closeIn = +r[0] + tf.ms - Date.now();
    this.hooks.onLegend({ o: +r[1], h: +r[2], l: +r[3], c: +r[4], t: +r[0], live: r[8] === '0', closeIn, ...this.last });
  }

  /* ---------- đường xu hướng ---------- */

  analyze() {
    if (!this.h1 || this.h1.c.length < 60) { this.res = null; this.drawLines(); return; }
    this.res = analyze(this.h1);
    this.drawLines();
    this.hooks.onLines && this.hooks.onLines(this.res, this.focusMatch);
  }

  barTimes() { return this.bars.all.map(r => +r[0]); }

  // thời điểm t (ms) → giờ mở của cây nến hiển thị chứa nó
  snap(t, times) {
    let lo = 0, hi = times.length - 1;
    if (t <= times[0]) return times[0];
    if (t >= times[hi]) return times[hi];
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (times[mid] <= t) lo = mid; else hi = mid - 1; }
    return times[lo];
  }

  drawLines() {
    for (const s of this.lineSeries) this.chart.removeSeries(s);
    this.lineSeries = [];
    if (!this.res || !this.bars || !this.bars.all.length) { this.markers.setMarkers([]); return; }
    const times = this.barTimes();
    const lastT = times[times.length - 1];
    const lines = this.show.lines ? [...this.res.lines] : [];

    // tín hiệu đang được mở từ thông báo / danh sách
    this.focusMatch = null;
    if (this.focus) {
      const ev = this.res.events.find(e => e.type === this.focus.ev && e.t === this.focus.t);
      const line = ev ? ev.line : this.focus.line;
      if (line) {
        this.focusMatch = { ev: ev || null, line, found: !!ev };
        const same = lines.findIndex(x => x.ta === line.ta && x.tb === line.tb && x.side === line.side);
        if (same >= 0) lines.splice(same, 1);
        lines.push({ ...line, _focus: true });
      }
    }

    for (const ln of lines) {
      const broken = ln.tBreak != null;
      const tEnd = broken ? Math.min(lastT, (ln.tRetest || ln.tFail || ln.tBreak) + (ln.tRetest ? 6 : 24) * HOUR) : lastT;
      const t0 = this.snap(ln.ta, times), t1 = this.snap(tEnd, times);
      if (t1 <= t0) continue;
      const color = ln._focus ? COLORS.focus : broken ? COLORS.blueDim : COLORS.blue;
      const s = this.chart.addSeries(L.LineSeries, {
        color, lineWidth: ln._focus ? 2 : broken ? 1 : 2,
        lineStyle: broken && !ln._focus ? L.LineStyle.Dashed : L.LineStyle.Solid,
        lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
        autoscaleInfoProvider: () => null,
      }, 0);
      s.setData([{ time: T(t0), value: lineAt(ln, t0) }, { time: T(t1), value: lineAt(ln, t1) }]);
      this.lineSeries.push(s);
    }

    // điểm phá / xác nhận / retest
    const firstT = times[0];
    const tf = TFS.find(x => x.id === this.tf);
    const mk = [];
    const shown = new Set(lines.map(x => x.ta + '|' + x.tb));
    for (const e of this.res.events) {
      if (e.t < firstT) continue;
      const isFocus = this.focusMatch && this.focusMatch.ev === e;
      if (!isFocus && !shown.has(e.line.ta + '|' + e.line.tb)) continue;
      const at = this.snap(tf.ms < HOUR ? e.t + HOUR - 1 : e.t, times);
      const up = e.dir === 'LONG';
      const color = isFocus ? COLORS.focus : e.type === 'RETEST' ? COLORS.blue : up ? COLORS.up : COLORS.down;
      mk.push({
        time: T(at), position: up ? 'belowBar' : 'aboveBar', color,
        shape: e.type === 'BREAK' ? (up ? 'arrowUp' : 'arrowDown') : e.type === 'RETEST' ? 'circle' : 'square',
        text: e.type === 'BREAK' ? 'Phá' : e.type === 'RETEST' ? 'RT' : 'XN',
        size: isFocus ? 2 : 1,
      });
    }
    mk.sort((a, b) => a.time - b.time);
    this.markers.setMarkers(mk);

    if (this.focusMatch) this.zoomTo(this.focusMatch.line);
  }

  zoomTo(ln) {
    const times = this.barTimes();
    const end = times[times.length - 1];
    const from = Math.max(times[0], ln.ta - 12 * HOUR);
    requestAnimationFrame(() => {
      try {
        this.chart.timeScale().setVisibleRange({ from: T(this.snap(from, times)), to: T(end) });
        this.chart.timeScale().applyOptions({ rightOffset: 8 });
      } catch {}
    });
  }

  setShow(k, v) {
    this.show[k] = v;
    if (k === 'lines') this.drawLines(); else this.indicators(true);
  }

  /* ---------- mỗi giờ: cập nhật lại đường khi nến H1 đóng ---------- */

  scheduleHourly() {
    const next = Math.ceil(Date.now() / HOUR) * HOUR + 4000;
    clearTimeout(this.hourTimer);
    this.hourTimer = setTimeout(() => { this.onH1Close(); this.scheduleHourly(); }, next - Date.now());
  }

  async onH1Close() {
    if (!this.inst) return;
    clearTimeout(this.h1Debounce);
    this.h1Debounce = setTimeout(async () => {
      try {
        const { K } = await okx.candles(this.inst, '1H', 520);
        this.h1 = K;
        this.analyze();
      } catch {}
    }, 1500);
  }

  // Giá đường xu hướng tại thời điểm hiện tại (để app báo "đang thử phá").
  livePrice() { const r = this.bars && this.bars.all[this.bars.all.length - 1]; return r ? +r[4] : null; }
}

export { T, MS, fmtPrice, hhmm, stamp };
