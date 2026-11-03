// app/overlay.js — lớp vẽ phủ lên biểu đồ nến (Lightweight Charts v5 "series primitive"):
//   • Bản đồ thanh lý ước tính (prompt 2.2): mỗi cụm thanh lý là một vệt ngang từ lúc sinh tới lúc bị quét;
//     càng đậm = càng nhiều tiền. Long (dưới giá) xanh lơ, Short (trên giá) cam. Cột bên phải = cụm còn sống.
//   • Vùng mua / bán (prompt 5.2, 5.3): Hộp Tím, Order Block, FVG chưa lấp, ổ thanh khoản 💧, vùng OTE, POC.
//   • Kế hoạch lệnh của tín hiệu đang xem: Entry / SL / TP1 / TP2.

const ZC = {
  box: ['rgba(170,110,255,0.16)', 'rgba(190,140,255,0.85)'],
  obUp: ['rgba(195,242,63,0.13)', 'rgba(195,242,63,0.8)'],
  obDn: ['rgba(242,57,139,0.13)', 'rgba(242,57,139,0.8)'],
  fvgUp: ['rgba(46,168,255,0.10)', 'rgba(110,190,255,0.8)'],
  fvgDn: ['rgba(255,140,60,0.10)', 'rgba(255,170,100,0.8)'],
  ote: ['rgba(255,214,10,0.10)', 'rgba(255,214,10,0.85)'],
  pool: 'rgba(120,220,255,0.9)', poc: 'rgba(200,160,255,0.7)',
  liqL: [32, 208, 255], liqS: [255, 176, 32],
};

export class Overlay {
  constructor(view) { this.v = view; this.data = { zones: null, liq: null }; this.show = { zones: true, liq: true }; }
  attached({ chart, series, requestUpdate }) { this.chart = chart; this.series = series; this.req = requestUpdate; }
  detached() { this.chart = null; }
  update() { if (this.req) this.req(); }
  updateAllViews() {}
  paneViews() { return [{ zOrder: () => 'bottom', renderer: () => ({ draw: t => this.draw(t) }) }]; }

  // giờ (ms) → toạ độ x (px, toạ độ CSS) của cây nến hiển thị chứa giờ đó
  x(tMs) {
    const v = this.v, times = v.bars ? v.bars.all.map(r => +r[0]) : null;
    if (!times || !times.length) return null;
    const t = v.snap(tMs, times);
    return this.chart.timeScale().timeToCoordinate(v.T(t));
  }

  draw(target) {
    if (!this.chart || !this.series || !this.v.bars) return;
    const ts = this.chart.timeScale();
    target.useBitmapCoordinateSpace(sc => {
      const ctx = sc.context, hr = sc.horizontalPixelRatio, vr = sc.verticalPixelRatio, W = sc.bitmapSize.width;
      const Y = p => { const y = this.series.priceToCoordinate(p); return y == null ? null : y * vr; };
      const X = t => { const x = this.x(t); return x == null ? null : x * hr; };
      const font = (px, w = 500) => { ctx.font = `${w} ${Math.round(px * vr)}px -apple-system, BlinkMacSystemFont, sans-serif`; };
      // nhãn chữ có nền tối mờ để đọc được trên nến
      const label = (txt, x, y, color, align = 'left') => {
        font(10, 600); ctx.textAlign = align; ctx.textBaseline = 'bottom';
        const w = ctx.measureText(txt).width, h = 13 * vr, x0 = align === 'right' ? x - w : x, y1 = y - 2 * vr;
        ctx.fillStyle = 'rgba(0,0,0,0.62)'; ctx.fillRect(x0 - 3 * hr, y1 - h + 2 * vr, w + 6 * hr, h);
        ctx.fillStyle = color; ctx.fillText(txt, x, y1);
      };

      /* ---- bản đồ thanh lý ---- */
      const L = this.data.liq;
      if (this.show.liq && L && L.segs && L.segs.length) {
        const max = Math.max(...L.segs.map(s => s.amt)) || 1;
        const firstT = +this.v.bars.all[0][0];
        for (const s of L.segs) {
          if ((s.t1 ?? Infinity) < firstT || s.amt < 0.04 * max) continue;      // cụm nhỏ bỏ qua cho đỡ rối
          const y = Y(s.px); if (y == null) continue;
          const x0 = X(Math.max(s.t0, firstT)), x1 = s.t1 == null ? W : X(s.t1);
          if (x0 == null || x1 == null || x1 < 0 || x0 > W) continue;
          const k = s.amt / max, a = Math.min(0.9, 0.07 + 0.8 * k);
          const [r, g, b] = s.side === 'L' ? ZC.liqL : ZC.liqS;
          ctx.fillStyle = `rgba(${r},${g},${b},${s.t1 == null ? a : a * 0.35})`;
          const h = Math.max(1, Math.round((s.t1 == null ? 1 + 2.5 * k : 1) * vr));
          ctx.fillRect(Math.max(0, x0), Math.round(y - h / 2), Math.min(W, x1) - Math.max(0, x0), h);
        }
        // cột bên phải: tổng cụm còn sống theo dải giá
        const bins = L.bins || [];
        const bmax = Math.max(...bins.map(b => b.amt), 1);
        for (const b of bins) {
          const y0 = Y(b.hi), y1 = Y(b.lo); if (y0 == null || y1 == null) continue;
          const len = Math.round((b.amt / bmax) * 48 * hr);
          const [r, g, bb] = b.side === 'L' ? ZC.liqL : ZC.liqS;
          ctx.fillStyle = `rgba(${r},${g},${bb},0.42)`;
          ctx.fillRect(W - len, Math.min(y0, y1), len, Math.max(1, Math.abs(y1 - y0) - vr));
        }
        for (const [px, side] of [[L.upPeakAt, 'S'], [L.dnPeakAt, 'L']]) {
          if (!px) continue;
          const y = Y(px); if (y == null) continue;
          label(`🧲 thanh lý ${side === 'S' ? 'Short' : 'Long'} ${this.v.fmt(px)}`, W - 4 * hr, y, side === 'S' ? 'rgb(255,190,80)' : 'rgb(90,215,255)', 'right');
        }
      }

      /* ---- vùng mua / bán ---- */
      const Z = this.data.zones;
      if (this.show.zones && Z) {
        const rect = (z, [fill, line], txt, dashed = false) => {
          const y0 = Y(z.top), y1 = Y(z.bot), x0 = z.t != null ? X(z.t) : 0;
          if (y0 == null || y1 == null || x0 == null) return;
          const xa = Math.max(0, x0), top = Math.min(y0, y1), h = Math.max(vr, Math.abs(y1 - y0));
          ctx.fillStyle = fill; ctx.fillRect(xa, top, W - xa, h);
          ctx.strokeStyle = line; ctx.lineWidth = Math.max(1, vr * 0.8);
          ctx.setLineDash(dashed ? [4 * hr, 3 * hr] : []);
          ctx.strokeRect(xa + 0.5, top + 0.5, W - xa - 1, h - 1);
          ctx.setLineDash([]);
          if (txt) label(txt, xa + 4 * hr, top + 12 * vr + 2 * vr, line);
        };
        for (const b of Z.boxes) rect(b, ZC.box, `Hộp Tím${b.poc ? ' · POC' : ''}${b.n ? ' · ' + b.n + ' phản ứng' : ''}`);
        if (Z.ote) rect(Z.ote, ZC.ote, `OTE 0,618–0,79 (${Z.ote.dir > 0 ? 'canh Long' : 'canh Short'})`, true);
        for (const o of Z.obs) rect(o, o.dir > 0 ? ZC.obUp : ZC.obDn, o.dir > 0 ? 'OB cầu (mua)' : 'OB cung (bán)');
        for (const f of Z.fvgs) rect(f, f.dir > 0 ? ZC.fvgUp : ZC.fvgDn, f.dir > 0 ? 'FVG tăng' : 'FVG giảm', true);
        for (const p of Z.pools) {
          const y = Y(p.level), x0 = X(p.t); if (y == null || x0 == null) continue;
          ctx.strokeStyle = ZC.pool; ctx.lineWidth = Math.max(1, vr); ctx.setLineDash([2 * hr, 3 * hr]);
          ctx.beginPath(); ctx.moveTo(Math.max(0, x0), Math.round(y) + 0.5); ctx.lineTo(W, Math.round(y) + 0.5); ctx.stroke(); ctx.setLineDash([]);
          label(`💧 ${p.n} ${p.side === 'high' ? 'đỉnh' : 'đáy'} bằng nhau`, Math.max(0, x0) + 4 * hr, y, ZC.pool);
        }
        if (Z.poc != null) {
          const y = Y(Z.poc);
          if (y != null) { ctx.strokeStyle = ZC.poc; ctx.lineWidth = Math.max(1, vr); ctx.setLineDash([6 * hr, 4 * hr]); ctx.beginPath(); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(W, Math.round(y) + 0.5); ctx.stroke(); ctx.setLineDash([]); }
        }
      }
    });
  }
}
