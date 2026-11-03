// bot/plan.mjs — soạn nội dung thông báo và quyết định gửi gì trong một lượt quét.
import { fmtPrice, hhmm, labelOf } from '../core/format.js';

const RANK = { BREAK: 0, RETEST: 1, CONFIRM: 2 };
const NAME = { BREAK: 'Phá', RETEST: 'Retest', CONFIRM: 'Xác nhận' };
// Thứ tự ưu tiên khi phải chọn: PHÁ > RETEST > XÁC NHẬN, rồi mô hình dài hơn.
const better = (a, b) => (RANK[a.type] - RANK[b.type]) || (b.line.span - a.line.span);

// Dòng điểm /100 (prompt V8.0) — đặt đầu nội dung thông báo để nhìn thấy ngay trên màn hình khoá.
export function scoreLines(sc, p) {
  if (!sc || sc.err || sc.s == null) return { head: sc && sc.err ? `📊 Chưa chấm được điểm (${sc.err})` : null, plan: null };
  const verdict = sc.in ? (sc.g === 'S++' ? '🔥 KÈO S++ — vào đủ ' + sc.rk + '% rủi ro' : '🎯 KÈO S+ — vào ' + sc.rk + '% rủi ro') : '⚖️ ĐỨNG NGOÀI';
  const why = [...(sc.f || []).map(x => '🚩 ' + x), ...(sc.k || []).map(x => '🔒 ' + x)];
  let head = `📊 ${sc.s}/100 · hạng ${sc.g} · ${sc.st} · ${verdict}`;
  if (!sc.in && why.length) head += '\n' + why.slice(0, 2).join('\n') + (why.length > 2 ? ` (+${why.length - 2} lý do)` : '');
  else if (!sc.in && sc.s < 88) head += ' (dưới 88 điểm)';
  if (sc.dn && sc.dn.length) head += `\nHạ 1 hạng: ${sc.dn.join(', ')}`;
  if (sc.w && sc.w.length) head += '\n' + sc.w.slice(0, 1).join('');
  const plan = `Entry ${p(sc.en)} · SL ${p(sc.sl)} (${sc.rp}%) · TP1 ${p(sc.tp1)} · TP2 ${p(sc.tp2)} · R:R ${sc.rr}`;
  return { head, plan };
}

export function buildMessage(e) {
  const p = v => fmtPrice(v, e.tickSz);
  const up = e.dir === 'LONG', L = e.line, name = labelOf(e.coin);
  const arrow = up ? '▲' : '▼';
  const lvl = up ? 'đỉnh' : 'đáy';
  let title, body;
  const tf = e.tf === '4H' ? ' H4' : e.tf === '30m' ? ' M30' : '';
  const volTxt = typeof e.vol === 'number' ? `Volume x${e.vol.toFixed(1)} so với trung bình 20 nến${e.vol >= 2 ? ' — volume lớn ✓' : ''}.` : '';
  if (e.type === 'BREAK' && L.range) {
    title = `${arrow} ${e.dir} ${name} · phá biên sideway${tf}`;
    body = `Đóng cửa ${p(e.close)} ${up ? 'trên đỉnh' : 'dưới đáy'} biên ${p(e.linePrice)} · đi ngang ${L.span} nến, ${L.touches} chạm.`;
    if (volTxt) body += '\n' + volTxt;
    if (e.others) body += ` Cùng lúc phá thêm ${e.others} đường.`;
  } else if (e.type === 'BREAK') {
    title = `${arrow} ${e.dir} ${name} · phá ${L.kind}${tf}`;
    body = `Đóng cửa ${p(e.close)} ${up ? 'trên' : 'dưới'} đường ${p(e.linePrice)} · mô hình ${L.span} nến, ${L.touches} chạm.`;
    if (volTxt) body += ' ' + volTxt;
    body += e.confirmed ? `\nĐã ${up ? 'vượt' : 'thủng'} ${lvl} cũ ${p(e.level)} ✓` : `\nChưa ${up ? 'vượt' : 'thủng'} ${lvl} cũ ${p(e.level)}.`;
    if (L.steep) body += ' Đường dốc — thường không có retest.';
    if (e.others) body += ` Cùng lúc phá thêm ${e.others} đường.`;
  } else if (e.type === 'CONFIRM') {
    title = `✓ Xác nhận ${e.dir} ${name}${tf}`;
    body = `Đóng cửa ${p(e.close)} ${up ? 'vượt' : 'thủng'} ${lvl} cũ ${p(e.level)} — cấu trúc đã gãy. Phá ${L.range ? 'biên sideway' : L.kind} ${L.span} nến lúc ${hhmm(L.tBreak)}.`;
  } else {
    title = `↺ Retest ${e.dir} ${name}${tf}`;
    body = `Giá quay về chạm ${L.range ? 'biên sideway' : L.kind} ${L.span} nến vừa phá (${p(e.linePrice)}) và đóng cửa giữ được ở ${p(e.close)}.`;
  }
  if (e.m30 && typeof e.m30 === 'object') body += e.m30.touch
    ? `\nNến M30 sau đó có rút râu về ${up ? 'đáy' : 'đỉnh'} cây phá nhưng đóng ${up ? 'xanh' : 'đỏ'} — vẫn giữ.`
    : `\nĐã giữ được 30 phút: nến M30 không quay về ${up ? 'đáy' : 'đỉnh'} cây phá.`;
  if (e.nextBar) body += e.tf === '30m' && e.cls !== 'weak'
    ? `\nNến M30 thứ 2 đóng ${p(e.nextBar.c)} tiếp tục ${up ? 'trên' : 'dưới'} đường ✓ (không vào ở nến phá)`
    : `\nCây phá chưa đẹp (sai màu / râu dài hơn thân / đóng sát đường) → đã chờ cây ${e.tf || 'H1'} sau: đóng ${p(e.nextBar.c)} tiếp tục ${up ? 'trên' : 'dưới'} đường ✓`;
  if (e.also && e.also.length) body += `\nKèm: ${e.also.map(a => `${NAME[a.type].toLowerCase()} đường ${a.line.span} nến`).join(', ')}.`;
  body += e.tf === '4H' ? `\nNến H4 ${hhmm(e.t)}–${hhmm(e.t + 4 * 3600e3)}` : e.tf === '30m' ? `\nNến M30 ${hhmm(e.t)}–${hhmm(e.t + 1800e3)}` : `\nNến H1 ${hhmm(e.t)}`;
  const sl = scoreLines(e.sc, p);
  if (sl.head) {
    body = sl.head + '\n' + body;
    if (sl.plan) body += '\n' + sl.plan;
    if (e.sc.in) title = (e.sc.g === 'S++' ? '🔥 S++ ' : '🎯 S+ ') + title;
  }
  const q = new URLSearchParams({ s: e.instId, ev: e.type, t: String(e.t) });
  if (e.tf && e.tf !== '1H') q.set('tf', e.tf);
  return { title, body, url: './#' + q.toString(), tag: `${e.instId}|${e.type}|${e.t}|${e.tf || '1H'}` };
}

/**
 * Mỗi cú phá một thông báo, không giới hạn số lượng.
 * Chỉ gộp khi CÙNG một đồng, CÙNG chiều, CÙNG cây nến (vd. vừa phá đường này vừa xác nhận đường kia):
 * một thông báo ghi đủ cả hai. Thứ tự gửi: PHÁ > RETEST > XÁC NHẬN, rồi mô hình lớn hơn.
 * Trả về [{ msg, events }] — events là các tín hiệu mà thông báo đó đại diện.
 */
export function plan(events) {
  const groups = new Map();
  for (const e of events) {
    const k = e.instId + '|' + e.dir + '|' + e.t + '|' + (e.tf || '1H');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const heads = [...groups.values()].map(g => {
    g.sort((a, b) => (RANK[a.type] - RANK[b.type]) || (b.line.span - a.line.span));
    return { ...g[0], also: g.slice(1), group: g };
  }).sort(better);
  return heads.map(h => ({ msg: buildMessage(h), events: h.group }));
}
