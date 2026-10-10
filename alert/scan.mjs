/* Bộ quét chạy nền trên GitHub Actions — gửi cảnh báo "sắp phá / đã phá" về Telegram.
 *
 * Điểm quan trọng: file này KHÔNG chép lại logic phát hiện. Nó đọc thẳng
 * quet-tin-hieu.html trong repo, bóc khối <script> ra và dùng chính các hàm
 * trong đó. Nhờ vậy chỉ có MỘT nguồn sự thật — sửa web là bot đổi theo, không
 * bao giờ lệch nhau.
 *
 * Chạy thử ở máy:  node alert/scan.mjs --dry
 */
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DRY  = process.argv.includes('--dry');

const CFG = {
  html:    process.env.NB_HTML   || 'quet-tin-hieu.html',
  tf:      process.env.NB_TF     || '1H',      // khung cấu trúc
  trig:    process.env.NB_TRIG   || '1H',      // khung nến kích hoạt ('same' = như trên)
  volMin:  +(process.env.NB_VOL  || 2),
  scope:   process.env.NB_SCOPE  || 'liquid',  // top | liquid | all | new
  dir:     process.env.NB_DIR    || 'both',    // both | long | short
  tiers:  (process.env.NB_TIERS  || 'broken,near').split(',').map(s=>s.trim()),
  maxAge:  +(process.env.NB_MAXAGE || 0),      // 0 = chỉ nến vừa đóng
  maxMsg:  +(process.env.NB_MAXMSG || 12),
  token:   process.env.TG_TOKEN || '',
  chat:    process.env.TG_CHAT  || '',
  statePath: resolve(HERE, 'state.json')
};

/* ---------- nạp logic từ chính file web ---------- */
function loadCore(){
  const htmlPath = resolve(ROOT, CFG.html);
  if(!existsSync(htmlPath)) throw new Error(`Không tìm thấy ${CFG.html} ở gốc repo`);
  const html = readFileSync(htmlPath, 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/) || html.match(/<script>([\s\S]*)<\/script>/);
  if(!m) throw new Error('Không bóc được khối <script> trong file HTML');
  const cut = m[1].indexOf('const SCAN={stop:false,running:false};');
  if(cut < 0) throw new Error('Không tìm thấy mốc cắt phần giao diện — file HTML có thể đã đổi cấu trúc');
  const core = m[1].slice(0, cut);
  const make = new Function(`
    const localStorage={getItem:()=>null,setItem:()=>{}};
    const document={querySelector:()=>null,querySelectorAll:()=>[]};
    const window={devicePixelRatio:1};
    ${core}
    return {enrich,candles,listSymbols,pool,nearBreakout,fmt,C};
  `);
  return make();
}

/* ---------- chống báo trùng ---------- */
function loadState(){
  try{ return JSON.parse(readFileSync(CFG.statePath,'utf8')); }catch(e){ return {seen:{}}; }
}
function saveState(st){
  const cutoff = Date.now() - 3*864e5;
  for(const k of Object.keys(st.seen)) if(st.seen[k] < cutoff) delete st.seen[k];
  mkdirSync(dirname(CFG.statePath), {recursive:true});
  writeFileSync(CFG.statePath, JSON.stringify(st));
}

async function telegram(text){
  if(DRY || !CFG.token || !CFG.chat){ console.log('\n--- (không gửi) ---\n'+text); return; }
  const r = await fetch(`https://api.telegram.org/bot${CFG.token}/sendMessage`, {
    method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({chat_id:CFG.chat, text, parse_mode:'HTML', disable_web_page_preview:true})
  });
  if(!r.ok) console.error('Telegram lỗi', r.status, (await r.text()).slice(0,200));
}

const esc = s => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

async function main(){
  const A = loadCore();
  const trigTf = CFG.trig === 'same' ? CFG.tf : CFG.trig;
  console.log(`Quét: cấu trúc ${CFG.tf} · kích hoạt ${trigTf} · vol ≥${CFG.volMin}× · phạm vi ${CFG.scope}`);

  const list = await A.listSymbols(CFG.scope);
  console.log(`${list.length} cặp`);
  const meta = new Map(list.map(x => [x.id, x]));

  const hits = await A.pool(list.map(x=>x.id), async sym => {
    const kr = await A.candles(sym, CFG.tf, 300);
    if(kr.c.length < 80) return null;
    const k = A.enrich(kr);
    let kt = k;
    if(trigTf !== CFG.tf){
      const tr = await A.candles(sym, trigTf, 200);
      if(tr.c.length < 40) return null;
      kt = A.enrich(tr);
    }
    let ev = A.nearBreakout(k, kt, {volMin: CFG.volMin});
    ev = ev.filter(e => CFG.tiers.includes(e.tier) && e.age <= CFG.maxAge);
    if(CFG.dir !== 'both') ev = ev.filter(e => e.dir === CFG.dir);
    if(!ev.length) return null;
    const m = meta.get(sym) || {};
    return {sym, price: k.c[k.c.length-1], ev, vol24: m.vol, ageDays: m.ageDays,
            lastT: kt.t[kt.t.length-1]};
  }, trigTf !== CFG.tf ? 4 : 6, null, {stop:false});

  console.log(`${hits.length} cặp có tín hiệu`);

  const st = loadState();
  const fresh = [];
  for(const h of hits){
    for(const e of h.ev){
      /* Một mức, một hướng, một cây nến kích hoạt = một lần báo duy nhất */
      const key = `${h.sym}|${e.dir}|${e.tier}|${e.lvl.toFixed(6)}|${h.lastT}`;
      if(st.seen[key]) continue;
      st.seen[key] = Date.now();
      fresh.push({h, e});
    }
  }
  if(!fresh.length){ console.log('Không có tín hiệu MỚI (đã báo trước đó hoặc nến chưa đóng).'); saveState(st); return; }

  fresh.sort((a,b) => (b.e.tier==='broken') - (a.e.tier==='broken') || b.e.vr - a.e.vr);
  const show = fresh.slice(0, CFG.maxMsg);

  const lines = [
    `<b>${show.some(x=>x.e.tier==='broken') ? '🔔' : '👀'} ${fresh.length} tín hiệu mới</b>`,
    `<i>cấu trúc ${CFG.tf} · nến kích hoạt ${trigTf} · vol ≥${CFG.volMin}×</i>`, ''
  ];
  for(const {h, e} of show){
    const nm = h.sym.replace('-USDT-SWAP','');
    const badge = e.tier === 'broken' ? '✅ ĐÃ PHÁ' : '⏳ SẮP PHÁ';
    const ar = e.dir === 'long' ? '▲ Tăng' : '▼ Giảm';
    const isNew = h.ageDays != null && h.ageDays <= 45 ? ` · 🆕 ${h.ageDays}d` : '';
    const thin  = h.vol24 != null && h.vol24 < 2e7 ? ' · ⚠️ thanh khoản mỏng' : '';
    lines.push(
      `${badge} <b>${esc(nm)}</b> ${ar}${isNew}${thin}`,
      `   giá ${A.fmt(h.price)} · mức ${A.fmt(e.lvl)} · vol ${e.vr.toFixed(1)}×`,
      `   ${esc(e.label)} · nén ${e.comp.toFixed(1)}×ATR`, ''
    );
  }
  if(fresh.length > show.length) lines.push(`<i>… và ${fresh.length - show.length} tín hiệu nữa</i>`);
  lines.push('', '<i>Đây là tín hiệu kỹ thuật tự động, không phải khuyến nghị giao dịch. Tự kiểm tra lại trước khi vào lệnh.</i>');

  await telegram(lines.join('\n'));
  saveState(st);
  console.log(`Đã gửi ${show.length}/${fresh.length} tín hiệu.`);
}

main().catch(e => { console.error('LỖI:', e.message); process.exit(1); });
