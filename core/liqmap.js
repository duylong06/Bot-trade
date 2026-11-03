// core/liqmap.js — Bản đồ thanh lý ước tính (prompt 2.2) từ nến 1H + Open Interest 1H của OKX.
//
// Mỗi giờ t: ΔOI = OI[t] − OI[t−1] (USD), px = (H + L + C) / 3.
//   ΔOI > 0: vị thế mới. Tỷ lệ phe Long mở mới long_share = clip(0,5 + 0,3·tanh(ret / 0,004), 0,15, 0,85),
//            ret = (C − O) / O. Chia ΔOI vào 4 bậc đòn bẩy [10, 25, 50, 100] trọng số [0,30, 0,30, 0,25, 0,15]:
//            giá thanh lý Long = px·(1 − 1/L + 0,005), Short = px·(1 + 1/L − 0,005).
//   ΔOI < 0: đóng bớt vị thế → mọi cụm còn sống nhân hệ số max(0, 1 + ΔOI / tổng OI còn sống).
//   Nến sau có Low ≤ giá thanh lý Long (hoặc High ≥ giá thanh lý Short) → cụm đó đã bị quét, xoá.
// Cụm vừa bị quét ở nến cuối có khối lượng ≥ 50% cụm lớn nhất cùng phía và ≥ 0,1% tổng OI → "VỪA QUÉT CỤM LỚN".
// Nam châm: gom cụm còn sống trong ±8% quanh giá vào các dải 0,1%; điểm = 0,6·tổng + 0,4·đỉnh cụm, bên nào lớn hơn hút giá.

const LEV = [10, 25, 50, 100], W = [0.30, 0.30, 0.25, 0.15], MMR = 0.005;

/**
 * K: nến 1H { t, o, h, l, c } cũ → mới. oi: [[ts, oiUsd], …] cũ → mới (mốc giờ trùng K.t).
 * hours: cửa sổ (24 Scalp · 72 Intraday · 168 Swing).
 */
export function liqMap(K, oi, hours = 72, { segments = false } = {}) {
  const byT = new Map(oi.map(([t, v]) => [t, v]));
  const N = K.c.length, from = Math.max(1, N - hours);
  let clusters = [];               // { px, amt, side: 'L' | 'S' }
  let swept = [];                  // cụm bị quét ở nến cuối
  const segs = [];                 // (để vẽ) mọi cụm: giá, phía, lúc sinh, lúc bị quét (null = còn sống)
  for (let i = from; i < N; i++) {
    // quét các cụm bị giá chạm trong nến i
    const last = i === N - 1;
    const peakL = Math.max(0, ...clusters.filter(c => c.side === 'L').map(c => c.amt));
    const peakS = Math.max(0, ...clusters.filter(c => c.side === 'S').map(c => c.amt));
    const totalBefore = clusters.reduce((s, c) => s + c.amt, 0);
    const keep = [];
    for (const c of clusters) {
      const hit = c.side === 'L' ? K.l[i] <= c.px : K.h[i] >= c.px;
      if (!hit) { keep.push(c); continue; }
      if (c.seg) { c.seg.t1 = K.t[i]; c.seg.amt = c.amt; }
      if (last) swept.push({ ...c, big: c.amt >= 0.5 * (c.side === 'L' ? peakL : peakS) && c.amt >= 0.001 * Math.max(totalBefore, 1) });
    }
    clusters = keep;
    // vị thế mới / đóng bớt ở giờ i
    const a = byT.get(K.t[i]), b = byT.get(K.t[i - 1]);
    if (a == null || b == null) continue;
    const d = a - b;
    if (d > 0) {
      const ret = (K.c[i] - K.o[i]) / Math.max(K.o[i], 1e-10);
      const ls = Math.min(0.85, Math.max(0.15, 0.5 + 0.3 * Math.tanh(ret / 0.004)));
      const px = (K.h[i] + K.l[i] + K.c[i]) / 3;
      LEV.forEach((L, k) => {
        for (const c of [{ side: 'L', px: px * (1 - 1 / L + MMR), amt: d * W[k] * ls, t: K.t[i] }, { side: 'S', px: px * (1 + 1 / L - MMR), amt: d * W[k] * (1 - ls), t: K.t[i] }]) {
          if (segments) { c.seg = { side: c.side, px: c.px, t0: K.t[i], t1: null, amt: c.amt, lev: L }; segs.push(c.seg); }
          clusters.push(c);
        }
      });
    } else if (d < 0) {
      const tot = clusters.reduce((s, c) => s + c.amt, 0);
      const f = Math.max(0, 1 + d / Math.max(tot, 1e-10));
      for (const c of clusters) c.amt *= f;
    }
  }
  const price = K.c[N - 1];
  // nam châm: dải 0,1% trong ±8%
  const band = Math.log(1.001), bands = new Map();
  for (const c of clusters) {
    if (Math.abs(c.px / price - 1) > 0.08) continue;
    const k = Math.round(Math.log(c.px / price) / band);
    bands.set(k, (bands.get(k) || 0) + c.amt);
  }
  let upSum = 0, upPeak = 0, upPeakAt = null, dnSum = 0, dnPeak = 0, dnPeakAt = null;
  for (const [k, v] of bands) {
    const px = price * Math.exp(k * band);
    if (k > 0) { upSum += v; if (v > upPeak) { upPeak = v; upPeakAt = px; } }
    else if (k < 0) { dnSum += v; if (v > dnPeak) { dnPeak = v; dnPeakAt = px; } }
  }
  const upScore = 0.6 * upSum + 0.4 * upPeak, dnScore = 0.6 * dnSum + 0.4 * dnPeak;
  const magnet = upScore > dnScore * 1.1 ? 'up' : dnScore > upScore * 1.1 ? 'down' : 'none';
  const bigSwept = swept.filter(c => c.big);
  return {
    magnet, upScore, dnScore, upPeakAt, dnPeakAt,
    sweptLong: bigSwept.some(c => c.side === 'L'), sweptShort: bigSwept.some(c => c.side === 'S'),
    sweptUsd: bigSwept.reduce((s, c) => s + c.amt, 0),
    alive: clusters.length,
    ...(segments ? { segs: (() => { for (const c of clusters) if (c.seg) c.seg.amt = c.amt; return segs; })(), price } : {}),
  };
}
