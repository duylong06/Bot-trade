// bot/trades.mjs — Tầng Hậu Kiểm (prompt V8.0, mục 0.4 + 6): theo dõi các kèo bot chấm S+ / S++ sau khi báo.
//   +0,6R → nhắc thu hẹp 50% SL · TP1 → chốt 50%, dời SL về Entry ± 0,15R · TP2 → chốt thêm 30%
//   ≥ 2 dấu hiệu đảo chiều ngược → nhắc cắt sớm (Active Trade Guard) · quá hạn chưa tới TP1 → đóng hoà vốn (Time-Stop)
// Chạy mỗi lượt quét H1 trên nến H1 đã đóng.

import { lineAt } from '../core/breakout.js';
import { dualStoch, structure, candlePattern, sma } from '../core/ta.js';
import { fmtPrice, labelOf, hhmm } from '../core/format.js';

const HOUR = 3600e3;

export function openTrade(state, e, sc, now = Date.now()) {
  state.trades ||= {};
  const id = e._key || e.id;
  if (!id || state.trades[id]) return;
  const s = e.dir === 'LONG' ? 1 : -1, R = (sc.entry - sc.sl) * s;
  if (!(R > 0)) return;
  state.trades[id] = {
    id, instId: e.instId, coin: e.coin, dir: e.dir, tf: e.tf || '1H', grade: sc.grade, score: sc.score, style: sc.style,
    entry: sc.entry, sl0: sc.sl, sl: sc.sl, tp1: sc.tp1, tp2: sc.tp2, R, t0: now, stage: 0, guard: 0, tickSz: e.tickSz,
    line: e.line ? { pa: e.line.pa, ta: e.line.ta, mPerH: e.line.mPerH } : null,
    ts: sc.timeStopH, ts1: sc.timeStopTp1H, best: 0,
  };
}

/**
 * data: { instId: K1H } · data4: { instId: K4H } (nếu có). Trả về danh sách thông báo { title, body, url, tag }.
 */
export function trackTrades(state, data, data4 = {}, now = Date.now()) {
  const out = [];
  state.trades ||= {}; state.tradeLog ||= [];
  for (const T of Object.values(state.trades)) {
    const K = data[T.instId];
    if (!K || !K.t.length) continue;
    const s = T.dir === 'LONG' ? 1 : -1, p = v => fmtPrice(v, T.tickSz), name = labelOf(T.coin);
    const head = `${T.dir === 'LONG' ? '▲' : '▼'} ${T.dir} ${name} (${T.grade} ${T.score}đ)`;
    const url = './#' + new URLSearchParams({ s: T.instId, tab: 'chart' }).toString();
    const say = (title, body, kind) => out.push({ title: `${title} · ${head}`, body, url, tag: `trade|${T.id}|${kind}` });
    const close = (why, r) => {
      state.tradeLog.unshift({ id: T.id, coin: T.coin, dir: T.dir, tf: T.tf, grade: T.grade, score: T.score, entry: T.entry, t0: T.t0, t1: now, why, r: +r.toFixed(2), stage: T.stage });
      state.tradeLog = state.tradeLog.slice(0, 60);
      delete state.trades[T.id];
    };
    let done = false;
    for (let i = 0; i < K.t.length && !done; i++) {
      if (K.t[i] < T.t0 || (T.last && K.t[i] <= T.last)) continue;          // chỉ nến mở sau lúc báo
      T.last = K.t[i];
      const fav = s > 0 ? K.h[i] : K.l[i], adv = s > 0 ? K.l[i] : K.h[i];
      T.best = Math.max(T.best, (fav - T.entry) * s / T.R);
      if ((adv - T.sl) * s <= 0) {                                              // chạm SL (xét trước, bảo thủ)
        const r = (T.sl - T.entry) * s / T.R;
        say(T.stage >= 2 ? '🛡 Về SL hoà vốn' : T.stage === 1 ? '⛔ Chạm SL đã thu hẹp' : '⛔ Chạm SL',
          `Giá chạm ${p(T.sl)} lúc ${hhmm(K.t[i])}–${hhmm(K.t[i] + HOUR)} → ${r >= 0 ? '+' : ''}${r.toFixed(2)}R${T.stage >= 2 ? ' trên 50% còn lại (đã chốt 50% ở TP1)' : ''}.`, 'sl');
        close(T.stage >= 2 ? 'sl-be' : 'sl', T.stage >= 2 ? 0.5 * ((T.tp1 - T.entry) * s / T.R) + 0.5 * r : r);
        done = true; break;
      }
      if (T.stage < 1 && (fav - (T.entry + s * 0.6 * T.R)) * s >= 0) {
        T.stage = 1; T.sl = T.entry - s * 0.5 * T.R;
        say('🔒 +0,6R', `Đạt +0,6R (${p(T.entry + s * 0.6 * T.R)}). Thu hẹp 50% SL: dời SL về ${p(T.sl)}. TP1 ${p(T.tp1)}.`, 'r06');
      }
      if (T.stage < 2 && (fav - T.tp1) * s >= 0) {
        T.stage = 2; T.sl = T.entry + s * 0.15 * T.R;
        say('🎯 Chạm TP1', `Chạm TP1 ${p(T.tp1)} — chốt 50% khối lượng, dời SL về ${p(T.sl)} (Entry ${s > 0 ? '+' : '−'} 0,15R, bù phí). TP2 ${p(T.tp2)}.`, 'tp1');
      }
      if (T.stage < 3 && (fav - T.tp2) * s >= 0) {
        T.stage = 3; T.sl = T.tp1;
        say('🏁 Chạm TP2', `Chạm TP2 ${p(T.tp2)} — chốt thêm 30%. 20% còn lại: SL dời lên TP1 ${p(T.tp1)}${T.style === 'SWING' ? ', ôm sóng (lãi ≥ 2% thì trailing, cho hồi 1,2% từ đỉnh)' : ''}.`, 'tp2');
      }
    }
    if (done) continue;
    // Đóng theo thời gian
    const age = (now - T.t0) / HOUR, lim = T.stage >= 2 ? T.ts1 : T.ts;
    if (age >= lim) {
      const c = K.c[K.c.length - 1], r = (c - T.entry) * s / T.R;
      say('⏱ Hết hạn lệnh', T.stage >= 2
        ? `Đã ${lim} giờ sau khi báo. Đóng phần còn lại ở ${p(c)} (${r >= 0 ? '+' : ''}${r.toFixed(2)}R).`
        : `Đã ${lim} giờ mà chưa tới TP1 — đóng hoà vốn / đóng ở ${p(c)} (${r >= 0 ? '+' : ''}${r.toFixed(2)}R).`, 'time');
      close('time', T.stage >= 2 ? 0.5 * ((T.tp1 - T.entry) * s / T.R) + 0.5 * r : r);
      continue;
    }
    // Active Trade Guard: ≥ 2 dấu hiệu đảo chiều ngược trên nến vừa đóng
    const G = (T.tf === '4H' && data4[T.instId]) ? data4[T.instId] : K;
    const signs = guardSigns(G, T, s);
    if (signs.length >= 2 && T.guard < 1) {
      T.guard = 1;
      say('⚠️ Nhắc cắt sớm', `${signs.length} dấu hiệu đảo chiều ngược: ${signs.join('; ')}. Cân nhắc đóng lệnh hoặc dời SL sát.`, 'guard');
    }
  }
  return out;
}

function guardSigns(K, T, s) {
  const n = K.c.length - 1, out = [];
  if (n < 40) return out;
  if (T.line && (K.c[n] - lineAt(T.line, K.t[n])) * s < 0) out.push('đóng cửa quay lại trong đường vừa phá');
  const ds = dualStoch(K);
  const kx = ds.fastK[n], dx = ds.fastD[n], k1 = ds.fastK[n - 1], d1 = ds.fastD[n - 1];
  if ([kx, dx, k1, d1].every(x => x != null) && (k1 - d1) * s > 0 && (kx - dx) * s < 0 && (s > 0 ? k1 > 75 : k1 < 25)) out.push(`Stoch 10/5/5 cắt ${s > 0 ? 'xuống từ vùng quá mua' : 'lên từ vùng quá bán'}`);
  const st = structure(K, 5);
  if (st.lastBreak && st.lastBreak.dir === -s && st.lastBreak.kind === 'CHoCH' && K.t[st.lastBreak.i] >= T.t0) out.push(`CHoCH ${s > 0 ? 'giảm' : 'tăng'} sau khi vào lệnh`);
  const pat = candlePattern(K, n, -s);
  if (pat) out.push(`nến đảo chiều ${pat}`);
  const vm = sma(K.v, 20)[n - 1];
  if (vm > 0 && K.v[n] >= 2 * vm && (K.c[n] - K.o[n]) * s < 0) out.push('nến ngược chiều volume ≥ 2× trung bình');
  return out;
}
