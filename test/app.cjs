// Kiểm app trong Chromium thật, dữ liệu OKX giả lập.
const { chromium } = require('playwright');

const COINS = ['BTC', 'ETH', 'SOL', 'WLD', 'PUMP', 'FIL', 'DOGE', 'XRP', 'LINK', 'AVAX'];
const H = 36e5;

function mkCandles(seed, bar) {
  const step = bar === '15m' ? 9e5 : bar === '30m' ? 18e5 : bar === '4H' ? 144e5 : bar === '1Dutc' ? 864e5 : H;
  const now = Math.floor(Date.now() / step) * step;
  const rows = [];
  let p = 100 + seed * 7;
  let r = seed * 1234567 + 89;
  const rnd = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff; };
  for (let i = 299; i >= 0; i--) {
    const t = now - i * step;
    const drift = Math.sin((300 - i) / 24 + seed) * 0.6 + (rnd() - 0.5) * 1.4;
    const o = p, c = Math.max(0.5, p + drift);
    const hi = Math.max(o, c) + rnd() * 0.5, lo = Math.min(o, c) - rnd() * 0.5;
    rows.push([String(t), o.toFixed(4), hi.toFixed(4), lo.toFixed(4), c.toFixed(4),
      (1000 + rnd() * 5000).toFixed(2), '0', '0', i === 0 ? '0' : '1']);
    p = c;
  }
  return rows.reverse();          // OKX trả mới → cũ
}

(async () => {
  const errs = [], warns = [];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2 });
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

  await page.route('**www.okx.com/**', route => {
    const u = new URL(route.request().url());
    const p = u.pathname;
    let data = [];
    if (p.endsWith('/market/tickers')) {
      data = COINS.map((b, i) => ({
        instId: `${b}-USDT-SWAP`, last: String(100 + i * 7 + (Date.now() / 5000 % 3)),
        open24h: String(100 + i * 7), volCcy24h: String(1e7 / (i + 1)),
      }));
    } else if (p.endsWith('/public/instruments')) {
      data = COINS.map(b => ({ instId: `${b}-USDT-SWAP`, listTime: '1600000000000', state: 'live', instCategory: '1', tickSz: '0.0001' }));
    } else if (p.endsWith('/market/candles')) {
      const inst = u.searchParams.get('instId') || 'BTC-USDT-SWAP';
      const bar = u.searchParams.get('bar') || '1H';
      data = mkCandles(COINS.indexOf(inst.split('-')[0]) + 1, bar);
    }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data }) });
  });

  // kho mốc: trả rỗng
  await page.route('**raw.githubusercontent.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ marks: [], ts: Date.now(), items: [] }) }));
  let sent = [];
  await page.route('**ntfy.sh/**', route => {
    sent.push(route.request().postData());
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  const say = (ok, msg) => { console.log((ok ? '  OK   ' : '  SAI  ') + msg); if (!ok) warns.push(msg); };

  await page.goto('http://127.0.0.1:8799/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  console.log('\n1. Danh sách coin');
  const rows = await page.locator('.tp-r').count();
  say(rows === 10, `có ${rows} dòng coin`);
  const px1 = await page.locator('[data-px]').first().textContent();
  await page.waitForTimeout(4500);
  const px2 = await page.locator('[data-px]').first().textContent();
  say(px1 !== px2, `giá chạy: ${px1} → ${px2}`);

  console.log('\n2. Mở biểu đồ');
  await page.locator('.tp-r').nth(3).click();
  await page.waitForTimeout(2000);
  say(await page.locator('#cv.on').count() === 1, 'màn biểu đồ mở');
  say((await page.locator('#cvTtl').textContent()).includes('WLD'), 'đúng đồng WLD');
  const cvs = await page.locator('#chart canvas').count();
  say(cvs >= 2, `${cvs} lớp canvas (nến + khung Stoch)`);
  const leg = await page.locator('#cvLeg').textContent();
  say(/Stoch 32/.test(leg) && /Stoch 10/.test(leg), 'chú thích có cả hai Stoch: ' + leg.replace(/\s+/g, ' ').trim().slice(0, 90));

  // biểu đồ có vẽ thật không: đếm điểm ảnh khác nền
  const painted = await page.evaluate(() => {
    const c = document.querySelector('#chart canvas');
    const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, Math.min(400, c.height)).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) n++;
    return n;
  });
  say(painted > 3000, `biểu đồ có ${painted} điểm ảnh sáng (không phải khung trống)`);

  console.log('\n3. Kéo và phóng to thu nhỏ');
  const before = await page.evaluate(() => window.__cv.chart.timeScale().getVisibleLogicalRange());
  await page.mouse.move(200, 300); await page.mouse.down(); await page.mouse.move(80, 300, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.__cv.chart.timeScale().getVisibleLogicalRange());
  say(Math.abs(after.from - before.from) > 1, `kéo ngang đổi khung nhìn: ${before.from.toFixed(1)} → ${after.from.toFixed(1)}`);
  await page.mouse.move(200, 300); await page.mouse.wheel(0, -300);
  await page.waitForTimeout(300);
  const zoom = await page.evaluate(() => window.__cv.chart.timeScale().getVisibleLogicalRange());
  say((zoom.to - zoom.from) < (after.to - after.from), `cuộn chuột phóng to: ${(after.to - after.from).toFixed(0)} → ${(zoom.to - zoom.from).toFixed(0)} nến`);

  console.log('\n4. Đổi khung');
  await page.locator('[data-tf="4H"]').click();
  await page.waitForTimeout(1200);
  say((await page.locator('#cvLeg').textContent()).includes('4H'), 'đổi sang 4H');
  await page.locator('[data-tf="1H"]').click();
  await page.waitForTimeout(1200);

  console.log('\n5. Kẻ bằng dấu thập ngắm');
  await page.locator('#cvDraw').click();
  await page.waitForTimeout(250);
  say(await page.locator('#cvCancel:visible').count() === 1, 'vào chế độ kẻ');
  const cross0 = await page.evaluate(() => window.__cv.cross && { t: window.__cv.cross.t, p: window.__cv.cross.p });
  say(!!cross0, 'dấu thập hiện sẵn giữa khung nhìn');
  const h0 = await page.locator('#cvHint').textContent();
  say(/\d/.test(h0), 'đáy hiện giá và giờ chỗ đang ngắm: ' + h0.trim().slice(0, 60));

  const box = await page.locator('#chart').boundingBox();
  // RÊ: ngón đi một quãng, dấu thập phải đi đúng quãng đó (ngón không cần đè lên điểm)
  await page.mouse.move(box.x + 300, box.y + 400);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 330, { steps: 8 });
  await page.waitForTimeout(150);
  const cross1 = await page.evaluate(() => ({ ...window.__cv.cross }));
  const dich = await page.evaluate(c0 => {
    const v = window.__cv;
    return { dx: v.xOf(v.cross.t) - v.xOf(c0.t), dy: v.candle.priceToCoordinate(v.cross.p) - v.candle.priceToCoordinate(c0.p) };
  }, cross0);
  say(Math.abs(dich.dx - (-80)) < 14, `dấu thập đi ngang đúng quãng ngón: ${dich.dx.toFixed(0)}px (ngón −80px)`);
  say(dich.dy < -20, `và đi dọc theo ngón: ${dich.dy.toFixed(0)}px`);
  say(await page.evaluate(() => window.__cv.pending1 === null), 'rê thôi thì chưa chốt điểm nào');
  await page.mouse.up();
  await page.waitForTimeout(200);
  say(await page.evaluate(() => window.__cv.pending1 === null), 'nhả tay sau khi rê cũng chưa chốt');

  // CHẠM: một cái chốt điểm thứ nhất
  await page.mouse.move(box.x + 120, box.y + 500);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(250);
  const p1 = await page.evaluate(() => window.__cv.pending1 && { ...window.__cv.pending1 });
  say(!!p1, 'chạm một cái chốt điểm thứ nhất');
  say(p1 && Math.abs(p1.t - cross1.t) < 1 && Math.abs(p1.p - cross1.p) < 1e-9,
    'chốt đúng chỗ dấu thập đang đứng, không phải chỗ ngón chạm');

  // rê tiếp rồi chạm chốt điểm hai
  await page.mouse.move(box.x + 300, box.y + 450);
  await page.mouse.down();
  await page.mouse.move(box.x + 360, box.y + 380, { steps: 6 });
  await page.waitForTimeout(150);
  say(await page.evaluate(() => !!window.__cv.draft), 'đang rê thì đường kéo theo dấu thập');
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(400);
  say(await page.locator('#cvDone:visible').count() === 1, 'chạm cái nữa là xong đường, hiện nút Xong');
  say(await page.locator('#cvRedo:visible').count() === 1, 'và nút Vẽ lại');
  say(await page.evaluate(() => window.__cv.cross === null), 'dấu thập tắt sau khi xong');
  say(await page.locator('#sheet.on').count() === 0, 'chưa mở tấm lưu vội, còn chỉnh được');

  console.log('\n5a. Kẻ vượt qua giá hiện tại');
  const tuongLai = await page.evaluate(() => {
    const v = window.__cv, cuoi = v.bars.t.at(-1);
    const k = v.khungVe();
    // ngắm sát mép phải khung — chỗ trống phía sau cây nến cuối
    const d = v.diem(k.w - 6, k.h / 2);
    return { t: d.t, cuoi, nenSau: Math.round((d.t - cuoi) / v.step), x: v.xOf(d.t), rong: k.w };
  });
  say(tuongLai.nenSau > 0, `ngắm được ra sau cây nến cuối ${tuongLai.nenSau} nến`);
  say(tuongLai.x != null && tuongLai.x <= tuongLai.rong, 'điểm đó vẫn nằm trong khung nhìn');
  const quaGia = await page.evaluate(() => {
    const v = window.__cv, b = v.bars, cuoi = b.t.at(-1);
    window.__giu = { ...v.draft };                    // giữ lại đường thật để phần sau dùng tiếp
    // dựng đường có điểm neo thứ hai nằm ở tương lai rồi xem vẽ ra được không
    v.draft = { id: 'thu', ta: b.t.at(-60), pa: b.l.at(-60), tb: cuoi + 10 * v.step, pb: b.h.at(-1) };
    v.ov.update();
    return { xa: v.xOf(v.draft.ta), xb: v.xOf(v.draft.tb), sauCuoi: v.draft.tb > cuoi };
  });
  say(quaGia.sauCuoi && quaGia.xb != null && quaGia.xb > quaGia.xa,
    'đường có neo ở tương lai vẫn vẽ được, nằm bên phải neo đầu');
  await page.evaluate(() => { window.__cv.draft = window.__giu; window.__cv.ov.update(); });

  console.log('\n5d. Giữ ở mép thì biểu đồ tự chạy ra tương lai');
  await page.locator('#cvCancel').click();
  await page.waitForTimeout(200);
  await page.locator('#cvDraw').click();
  await page.waitForTimeout(250);
  const truocCuon = await page.evaluate(() => {
    const v = window.__cv;
    return { pos: v.chart.timeScale().scrollPosition(), cuoi: v.bars.t.at(-1), crossT: v.cross.t };
  });
  const k2 = await page.evaluate(() => window.__cv.khungVe());
  // rê dấu thập tới sát mép phải rồi GIỮ NGUYÊN ngón ở đó
  await page.mouse.move(box.x + 80, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 80 + k2.w, box.y + 300, { steps: 10 });
  await page.waitForTimeout(1400);                       // giữ ở mép 1,4 giây
  const dangCuon = await page.evaluate(() => {
    const v = window.__cv;
    return { pos: v.chart.timeScale().scrollPosition(), crossT: v.cross.t, cuoi: v.bars.t.at(-1), step: v.step };
  });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const sauCuon = await page.evaluate(() => window.__cv.chart.timeScale().scrollPosition());
  const nenVuot = Math.round((dangCuon.crossT - dangCuon.cuoi) / dangCuon.step);
  say(dangCuon.pos > truocCuon.pos + 5, `giữ ở mép thì biểu đồ chạy: vị trí ${truocCuon.pos.toFixed(0)} → ${dangCuon.pos.toFixed(0)}`);
  say(nenVuot > 20, `dấu thập ra được ${nenVuot} nến sau cây cuối — kẻ xa hơn giá hiện tại thoải mái`);
  say(Math.abs(sauCuon - dangCuon.pos) < 4, 'nhả tay thì ngừng chạy, không trôi tiếp');
  await page.locator('#cvCancel').click();
  await page.waitForTimeout(200);

  console.log('\n5b. Kéo lại một đầu neo');
  await page.evaluate(() => {
    const v = window.__cv, b = v.bars;
    v.fit();
    v.draft = { id: 'lai', ta: b.t.at(-50), pa: b.l.at(-50), tb: b.t.at(-12), pb: b.h.at(-12) };
    v.mode = 'sua'; v.setPad(); v.ov.update();
    window.__CV.nutVe('xong');
  });
  await page.waitForTimeout(400);
  const truoc = await page.evaluate(() => ({ ...window.__cv.draft }));
  const chuanDoan = await page.evaluate(() => {
    const v = window.__cv, k = v.khungVe();
    return { mode: v.mode, pad: v.pad.style.display, pos: v.chart.timeScale().scrollPosition(),
      xb: v.xOf(v.draft.tb), yb: v.candle.priceToCoordinate(v.draft.pb), w: k.w, h: k.h };
  });
  console.log('     chẩn đoán 5b:', JSON.stringify(chuanDoan));
  const hx = await page.evaluate(() => {
    const v = window.__cv, r = document.querySelector('#chart').getBoundingClientRect();
    return { x: r.x + v.xOf(v.draft.tb), y: r.y + v.candle.priceToCoordinate(v.draft.pb) };
  });
  await page.mouse.move(hx.x, hx.y);
  await page.mouse.down();
  await page.mouse.move(hx.x - 60, hx.y + 40, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const sau = await page.evaluate(() => ({ ...window.__cv.draft }));
  say(sau.tb !== truoc.tb || sau.pb !== truoc.pb, 'kéo đầu neo đổi được vị trí');
  say(sau.ta <= sau.tb, `hai đầu vẫn đúng thứ tự sau khi kéo (${new Date(sau.ta).toISOString().slice(5,16)} → ${new Date(sau.tb).toISOString().slice(5,16)})`);
  if (sau.ta === sau.tb) {
    // kéo chồng lên nhau → tách ra rồi mới lưu được
    await page.evaluate(() => { const v = window.__cv; v.draft.tb = v.draft.ta + 8 * v.step; v.ov.update(); });
    console.log('     (hai đầu trùng nến, bài kiểm tách ra để kiểm tiếp phần lưu)');
  }

  console.log('\n5c. Nam châm');
  const nc = await page.evaluate(() => {
    const v = window.__cv, out = {};
    // chọn cây nến cao nhất trong khung nhìn để thử cho rõ
    let best = -1, bi = 0;
    for (let i = v.bars.c.length - 60; i < v.bars.c.length - 2; i++) {
      const h = v.candle.priceToCoordinate(v.bars.l[i]) - v.candle.priceToCoordinate(v.bars.h[i]);
      if (h > best) { best = h; bi = i; }
    }
    const t = v.bars.t[bi], x = v.xOf(t);
    const yH = v.candle.priceToCoordinate(v.bars.h[bi]);
    const yL = v.candle.priceToCoordinate(v.bars.l[bi]);
    out.caoPx = +(yL - yH).toFixed(1);
    const nhich = Math.min(3, (yL - yH) / 5);
    out.tren = v.diem(x, yH + nhich);          // ngắm nửa trên
    out.duoi = v.diem(x, yL - nhich);          // ngắm nửa dưới
    out.xa = v.diem(x, (yH + yL) / 2);         // giữa thân, cách cả hai râu
    out.h = v.bars.h[bi]; out.l = v.bars.l[bi];
    v.toggle('magnet', false);
    out.tat = v.diem(x, yH + nhich);           // tắt nam châm
    v.toggle('magnet', true);
    return out;
  });
  say(nc.tren.bam === 'râu trên' && Math.abs(nc.tren.p - nc.h) < 1e-9,
    `ngắm nửa trên cây nến cao ${nc.caoPx}px → bám ${nc.tren.bam}`);
  say(nc.duoi.bam === 'râu dưới' && Math.abs(nc.duoi.p - nc.l) < 1e-9,
    `ngắm nửa dưới → bám ${nc.duoi.bam}`);
  say(nc.tat.bam === null, 'tắt nam châm thì giữ đúng chỗ ngón đặt');

  console.log('\n6. Lưu mốc');
  await page.locator('#cvDone').click();
  await page.waitForTimeout(400);
  say(await page.locator('#sheet.on').count() === 1, 'bấm Xong mới mở tấm lưu mốc');
  const info = await page.locator('#shInfo').textContent();
  say(/WLD/.test(info) && /→/.test(info), 'tấm ghi đúng hai điểm neo: ' + info.slice(0, 70));
  await page.locator('#shMode button[data-v="close"]').click();
  await page.locator('#shSave').click();
  await page.waitForTimeout(900);
  say(sent.length === 1, `gửi ${sent.length} lệnh lên hộp thư`);
  if (sent[0]) {
    const j = JSON.parse(sent[0]);
    say(j.act === 'add' && j.mark && j.mark.sym === 'WLD-USDT-SWAP', 'lệnh đúng dạng: act=' + j.act + ' sym=' + (j.mark || {}).sym);
    say(j.mark.mode === 'close' && j.mark.dir === 'down', `điều kiện: ${j.mark.dir}/${j.mark.mode}`);
    say(j.mark.ta < j.mark.tb, 'hai điểm neo theo thứ tự thời gian');
  }
  say(await page.locator('#sheet.on').count() === 0, 'tấm đóng lại sau khi lưu');
  say(await page.locator('#cvDraw:visible').count() === 1, 'nút Kẻ đường quay lại');

  console.log('\n7. Các tab còn lại');
  await page.locator('#cvBack').click();
  await page.waitForTimeout(300);
  for (const [t, sel] of [['moc', '#mocList'], ['bot', '#botList'], ['cfg', '#topic']]) {
    await page.locator(`nav button[data-t="${t}"]`).click();
    await page.waitForTimeout(700);
    say(await page.locator(sel).count() === 1, `tab ${t} mở được`);
  }
  say((await page.locator('#topic').inputValue()).length > 5, 'ô hộp thư có sẵn giá trị');

  await page.locator('nav button[data-t="top"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/tmp/claude-0/-home-claude/bba7b130-ecf1-5848-9e21-06830697e5bd/scratchpad/t/list.png' });
  await page.locator('.tp-r').nth(0).click();
  await page.waitForTimeout(2200);
  await page.screenshot({ path: '/tmp/claude-0/-home-claude/bba7b130-ecf1-5848-9e21-06830697e5bd/scratchpad/t/chart.png' });

  console.log('\n8. Lỗi JS');
  const real = errs.filter(e => !/favicon|manifest|icon-/.test(e));
  say(real.length === 0, real.length ? 'có lỗi:\n     ' + real.slice(0, 6).join('\n     ') : 'không có lỗi');

  await browser.close();
  console.log(warns.length ? `\n==> ${warns.length} mục chưa đạt` : '\n==> Tất cả đạt');
  process.exit(warns.length ? 1 : 0);
})();
