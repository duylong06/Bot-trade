// bot/journal.mjs — nhật ký tín hiệu: ghi mọi tín hiệu bot thấy, chấm kết quả khi đủ nến,
// và chạy lại quá khứ từng giờ một để có dữ liệu học ngay từ đầu.
import { analyze, sliceK, CFG, HOUR } from '../core/breakout.js';
import { featuresAt, outcome, eventId, LEARN } from '../core/learn.js';

// Lưu dạng cột cho gọn (nhật ký có thể tới cả chục nghìn dòng, đẩy lên GitHub mỗi giờ).
const COLS = ['id', 's', 'c', 't', 'ty', 'd', 'sp', 'tc', 'cf', 'st', 'kd', 'vr', 'em', 'ds', 'px', 'a',
  'p', 'ev', 'pu', 'why', 'src', 'o', 'h', 'r6', 'r24', 'r72', 'mfe', 'mae', 'now'];

export class Journal {
  constructor(json) {
    const rows = json && json.cols ? json.rows.map(a => Object.fromEntries(json.cols.map((k, i) => [k, a[i] ?? null]))) : [];
    this.rows = rows;
    this.map = new Map(rows.map(r => [r.id, r]));
  }
  has(id) { return this.map.has(id); }
  get(id) { return this.map.get(id); }
  add(row) {
    if (this.map.has(row.id)) return false;
    this.rows.push(row); this.map.set(row.id, row);
    return true;
  }
  pendingInsts() { return [...new Set(this.rows.filter(r => r.o === 'P').map(r => r.s))]; }

  // Chấm lại các tín hiệu còn chờ bằng nến mới nhất. dataByInst: instId → nến đã đóng.
  evaluate(dataByInst) {
    let done = 0;
    for (const r of this.rows) {
      if (r.o !== 'P') continue;
      const K = dataByInst[r.s];
      if (!K) {
        // đồng rơi khỏi danh sách theo dõi quá lâu → không chấm được nữa
        if (Date.now() - r.t > (LEARN.HORIZON + 48) * HOUR) r.o = 'X';
        continue;
      }
      const res = outcome(K, r.t, r.d, r.px, r.a);
      if (!res) continue;
      Object.assign(r, res);
      if (r.o !== 'P') done++;
    }
    return done;
  }

  prune() {
    const old = Date.now() - LEARN.KEEP_DAYS * 24 * HOUR;
    this.rows = this.rows.filter(r => r.t >= old).sort((a, b) => a.t - b.t);
    this.map = new Map(this.rows.map(r => [r.id, r]));
  }

  toJSON() { return { v: 1, cols: COLS, rows: this.rows.map(r => COLS.map(k => r[k] ?? null)) }; }
}

export function makeRow(instId, coin, e, f, extra = {}) {
  return {
    id: eventId(instId, e), s: instId, c: coin, t: e.t, ...f,
    px: e.close, a: +e.atr.toPrecision(6),
    p: null, ev: null, pu: null, why: null, src: 'live', o: 'P', ...extra,
  };
}

/**
 * Chạy lại quá khứ đúng như bot sống: với mỗi giờ trong `hours` giờ qua, cắt đúng 520 nến kết thúc
 * ở giờ đó, phân tích, và chỉ lấy sự kiện xảy ra ở cây nến cuối — không nhìn trước tương lai.
 * data: instId → nến đã đóng (cần ≥ 520 + hours cây).  onEvent(instId, e, features)
 */
export function replay(data, hours, onEvent) {
  const span = CFG.WINDOW + CFG.WARMUP;
  let calls = 0;
  for (const [instId, K] of Object.entries(data)) {
    const N = K.c.length;
    for (let h = Math.min(hours, N - span); h >= 0; h--) {
      const Kh = sliceK(K, N - h - span, N - h);
      const r = analyze(Kh); calls++;
      const tl = Kh.t[Kh.t.length - 1];
      for (const e of r.events) if (e.t === tl) onEvent(instId, e, featuresAt(r.W, r.A, e));
    }
  }
  return calls;
}
