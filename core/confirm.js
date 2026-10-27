// core/confirm.js — luật xác nhận bằng nến M30 của chủ repo (chỉ áp dụng cho PHÁ).
//
// Cây H1 đóng cửa ra ngoài đường → CHƯA báo. Chờ cây M30 đầu tiên của giờ tiếp theo đóng cửa (30 phút sau):
//   - Phá lên (LONG):  đáy M30 ≤ đáy cây H1 phá  → giá đã rút về hết cây phá → KHÔNG báo,
//                      trừ khi M30 rút râu kéo lên và đóng nến XANH (đóng > mở) → vẫn báo.
//   - Phá xuống (SHORT): đỉnh M30 ≥ đỉnh cây H1 phá → KHÔNG báo, trừ khi M30 đóng nến ĐỎ → vẫn báo.
//   - Còn lại → báo.
// Nến M30 đóng bằng giá mở (không xanh không đỏ) mà đã chạm thì tính là không báo.
// Không gửi tin "phá hụt" khi bỏ.

export const M30 = 30 * 60e3;

/**
 * h1: { o, h, l, c } của cây H1 phá · m: { o, h, l, c } của cây M30 đầu tiên giờ sau (hoặc null nếu không lấy được)
 * Trả về { ok, touch, why }
 */
export function m30Verdict(dir, h1, m) {
  if (!m) return { ok: true, touch: false, why: null, missing: true };      // không lấy được M30 → vẫn báo
  const up = dir === 'LONG';
  const touch = up ? m.l <= h1.l : m.h >= h1.h;
  if (!touch) return { ok: true, touch: false, why: null };
  const held = up ? m.c > m.o : m.c < m.o;
  if (held) return { ok: true, touch: true, why: null };
  return { ok: false, touch: true, why: up ? 'nến M30 rút về dưới đáy cây phá' : 'nến M30 vọt lên trên đỉnh cây phá' };
}

// Giờ đóng của cây M30 cần xét: cây H1 mở lúc t, đóng lúc t+1h; M30 đầu tiên của giờ sau đóng lúc t+1h30.
export const m30CloseOf = tBreak => tBreak + 3600e3 + M30;
