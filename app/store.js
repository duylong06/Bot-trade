// app/store.js — chỗ app và bot trao đổi "mốc" (đường bạn kẻ).
//
// Vì sao phải vòng vèo: app chạy trong trình duyệt trên trang công khai, nên KHÔNG được
// giữ khoá ghi vào repo — ai xem mã nguồn cũng thấy. Nên:
//
//   app  --(gửi lệnh)-->  ntfy.sh  --(bot rút mỗi lượt quét)-->  moc.json trên nhánh data
//   app  <--(đọc trạng thái hiện tại)--------------------------  moc.json trên nhánh data
//
// ntfy.sh là hộp thư công khai, không cần đăng nhập, cho gửi từ trình duyệt (CORS mở).
// Tin trong đó tự hết hạn sau 12 giờ — chỉ là đường đi, không phải nơi lưu. Nơi lưu thật
// là nhánh data của repo, do bot ghi.

const REPO = 'duylong06/Bot-trade';
const BRANCH = 'data';
const FILE = 'out/moc.json';

export const DEFAULT_TOPIC = 'botrade-duylong06-moc-7k3x9q';

export const topic = () => localStorage.getItem('ntfyTopic') || DEFAULT_TOPIC;
export const setTopic = t => localStorage.setItem('ntfyTopic', (t || '').trim() || DEFAULT_TOPIC);

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- gửi lệnh lên hộp thư ---------- */

async function send(cmd) {
  const body = JSON.stringify({ ...cmd, id: cmd.id || uid(), at: Date.now() });
  const r = await fetch('https://ntfy.sh/' + topic(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'X-Title': 'moc' },
    body,
  });
  if (!r.ok) throw new Error('Không gửi được lên hộp thư (HTTP ' + r.status + ')');
  return true;
}

export const addMark = mark => send({ act: 'add', mark });
export const delMark = markId => send({ act: 'del', markId });

/* ---------- đọc trạng thái bot đang giữ ---------- */

/* Nhánh data công khai nên đọc không cần khoá. */
export async function readMarks() {
  const url = `https://api.github.com/repos/${REPO}/contents/${FILE}?ref=${BRANCH}&t=${Date.now()}`;
  try {
    const r = await fetch(url, { headers: { Accept: 'application/vnd.github.raw' } });
    if (r.status === 404) return { marks: [], ts: 0, missing: true };
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    return { marks: Array.isArray(j.marks) ? j.marks : [], ts: j.ts || 0, fired: j.fired || [] };
  } catch (e) {
    return { marks: [], ts: 0, err: e.message };
  }
}

/* Danh sách kèo bot tự vẽ. Cùng nhánh, file khác. */
export async function readBotLines() {
  const url = `https://api.github.com/repos/${REPO}/contents/out/sap-pha.json?ref=${BRANCH}&t=${Date.now()}`;
  try {
    const r = await fetch(url, { headers: { Accept: 'application/vnd.github.raw' } });
    if (!r.ok) return { items: [], ts: 0 };
    const j = await r.json();
    return { items: Array.isArray(j.items) ? j.items : [], ts: j.ts || 0 };
  } catch (e) { return { items: [], ts: 0, err: e.message }; }
}

/* ---------- mốc chờ gửi, giữ tạm trong máy ---------- */
// Lệnh vừa gửi phải đợi bot chạy lượt tới mới vào moc.json. Trong lúc đó vẫn
// hiện lên cho bạn thấy, kèm nhãn "đang chờ bot nhận".

const PEND = 'mocCho';
export const pending = () => { try { return JSON.parse(localStorage.getItem(PEND) || '[]'); } catch { return []; } };
export const setPending = a => localStorage.setItem(PEND, JSON.stringify(a.slice(-60)));
export function addPending(mark) { const a = pending(); a.push(mark); setPending(a); }
export function dropPending(id) { setPending(pending().filter(m => m.id !== id)); }

/* Gộp mốc bot đang giữ với mốc vừa gửi chưa kịp lên. */
export function mergeMarks(remote, local) {
  const ids = new Set(remote.map(m => m.id));
  const extra = local.filter(m => !ids.has(m.id)).map(m => ({ ...m, cho: true }));
  // mốc đã lên tới bot thì xoá khỏi hàng chờ
  if (extra.length !== local.length) setPending(local.filter(m => !ids.has(m.id)));
  return [...remote, ...extra];
}
