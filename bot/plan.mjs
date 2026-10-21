// bot/plan.mjs — soạn nội dung thông báo và quyết định gửi gì trong một lượt quét.
import { PAGES_URL } from '../core/config.js';
import { fmtPrice, hhmm } from '../core/format.js';

export const BUNDLE_AT = 3;     // lượt quét có hơn 3 tín hiệu → gửi 2 cái lớn nhất + 1 thông báo tóm tắt
const SINGLES_WHEN_BUNDLED = 2;
const RANK = { BREAK: 0, RETEST: 1, CONFIRM: 2 };
const NAME = { BREAK: 'Phá', RETEST: 'Retest', CONFIRM: 'Xác nhận' };

export function buildMessage(e) {
  const p = v => fmtPrice(v, e.tickSz);
  const up = e.dir === 'LONG', L = e.line;
  const arrow = up ? '▲' : '▼';
  const lvl = up ? 'đỉnh' : 'đáy';
  let title, body;
  if (e.type === 'BREAK') {
    title = `${arrow} ${e.dir} ${e.coin} · phá ${L.kind}`;
    body = `Đóng cửa ${p(e.close)} ${up ? 'trên' : 'dưới'} đường ${p(e.linePrice)} · mô hình ${L.span} nến, ${L.touches} chạm.`;
    body += e.confirmed ? `\nĐã ${up ? 'vượt' : 'thủng'} ${lvl} cũ ${p(e.level)} ✓` : `\nChưa ${up ? 'vượt' : 'thủng'} ${lvl} cũ ${p(e.level)}.`;
    if (L.steep) body += ' Đường dốc — thường không có retest.';
    if (e.others) body += ` Cùng lúc phá thêm ${e.others} đường.`;
  } else if (e.type === 'CONFIRM') {
    title = `✓ Xác nhận ${e.dir} ${e.coin}`;
    body = `Đóng cửa ${p(e.close)} ${up ? 'vượt' : 'thủng'} ${lvl} cũ ${p(e.level)} — cấu trúc đã gãy. Phá ${L.kind} ${L.span} nến lúc ${hhmm(L.tBreak)}.`;
  } else {
    title = `↺ Retest ${e.dir} ${e.coin}`;
    body = `Giá quay về chạm ${L.kind} ${L.span} nến vừa phá (${p(e.linePrice)}) và đóng cửa giữ được ở ${p(e.close)}.`;
  }
  if (e.also && e.also.length) body += `\nKèm: ${e.also.map(a => `${NAME[a.type].toLowerCase()} đường ${a.line.span} nến`).join(', ')}.`;
  body += `\nNến H1 ${hhmm(e.t)}`;
  const q = new URLSearchParams({ s: e.instId, ev: e.type, t: String(e.t) });
  return { title, body, url: PAGES_URL + '#' + q.toString(), tag: `${e.instId}|${e.type}|${e.t}` };
}

function buildSummary(rest, t) {
  const L = rest.filter(e => e.dir === 'LONG'), S = rest.filter(e => e.dir === 'SHORT');
  const head = [L.length ? `▲ ${L.length} LONG` : '', S.length ? `▼ ${S.length} SHORT` : ''].filter(Boolean).join(' · ');
  const list = (arr, type) => arr.filter(e => e.type === type).map(e => e.coin);
  const parts = [];
  for (const type of ['BREAK', 'RETEST', 'CONFIRM']) {
    const l = list(L, type), s = list(S, type);
    if (l.length) parts.push(`${NAME[type]} ▲ ${l.slice(0, 8).join(', ')}${l.length > 8 ? '…' : ''}`);
    if (s.length) parts.push(`${NAME[type]} ▼ ${s.slice(0, 8).join(', ')}${s.length > 8 ? '…' : ''}`);
  }
  return {
    title: `${head} cùng lúc`,
    body: parts.join('\n') + `\nMở app để xem từng đồng · Nến H1 ${hhmm(t)}`,
    url: PAGES_URL + '#tab=signals',
    tag: `summary|${t}`,
  };
}

/**
 * Gộp tín hiệu của một lượt quét thành danh sách thông báo cần gửi.
 * - Cùng đồng, cùng chiều → một thông báo (ưu tiên PHÁ > RETEST > XÁC NHẬN, rồi mô hình lớn hơn).
 * - Nhiều hơn BUNDLE_AT thông báo → gửi 2 cái lớn nhất riêng + 1 thông báo tóm tắt phần còn lại.
 * Trả về [{ msg, events }] — events là các tín hiệu mà thông báo đó đại diện.
 */
export function plan(events) {
  const groups = new Map();
  for (const e of events) {
    const k = e.instId + '|' + e.dir;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const heads = [...groups.values()].map(g => {
    g.sort((a, b) => (RANK[a.type] - RANK[b.type]) || (b.line.span - a.line.span));
    return { ...g[0], also: g.slice(1), group: g };
  }).sort((a, b) => (RANK[a.type] - RANK[b.type]) || (b.line.span - a.line.span));

  if (heads.length <= BUNDLE_AT) return heads.map(h => ({ msg: buildMessage(h), events: h.group }));
  const singles = heads.slice(0, SINGLES_WHEN_BUNDLED);
  const rest = heads.slice(SINGLES_WHEN_BUNDLED);
  return [
    ...singles.map(h => ({ msg: buildMessage(h), events: h.group })),
    { msg: buildSummary(rest, rest[0].t), events: rest.flatMap(h => h.group), summary: true },
  ];
}
