// Đánh số phiên bản vào mọi đường dẫn file JS.
//
// Vì sao cần: app thêm vào màn hình chính giữ cache tới 10 phút. Đẩy bản vá xong, mở app
// ra vẫn chạy file cũ — hoặc tệ hơn, index.html mới ghép với app/chart.js cũ, sinh ra lỗi
// không giống bản nào cả. Thêm ?v=<số> thì mỗi lần đẩy là một đường dẫn mới, trình duyệt
// buộc phải tải lại.
//
// Chạy trước mỗi lần commit:  node tools/ver.mjs

import fs from 'node:fs';
import path from 'node:path';

const GOC = path.resolve(import.meta.dirname, '..');
const so = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);   // vd 202611261105

const sua = (tep, doi) => {
  const p = path.join(GOC, tep);
  const truoc = fs.readFileSync(p, 'utf8');
  const sau = doi(truoc);
  if (sau !== truoc) { fs.writeFileSync(p, sau); return true; }
  return false;
};

let n = 0;

// index.html: thẻ script nạp app/main.js, và cả vendor
if (sua('index.html', s => s
  .replace(/src="app\/main\.js(\?v=[0-9]+)?"/, `src="app/main.js?v=${so}"`)
  .replace(/src="vendor\/lightweight-charts\.js(\?v=[0-9]+)?"/, `src="vendor/lightweight-charts.js?v=${so}"`)
)) n++;

// mọi lệnh import giữa các file trong app/ và core/
for (const thuMuc of ['app', 'core']) {
  const d = path.join(GOC, thuMuc);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith('.js')) continue;
    if (sua(path.join(thuMuc, f), s =>
      s.replace(/from '(\.\.?\/[^']+?\.js)(\?v=[0-9]+)?'/g, (_, duong) => `from '${duong}?v=${so}'`)
    )) n++;
  }
}

console.log(`phiên bản ${so} — đã đánh dấu ${n} tệp`);
