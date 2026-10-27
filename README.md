# Bot Trade — báo phá vỡ trendline H1

Bot quét **top 67 đồng crypto theo vốn hoá** (CoinGecko, cập nhật mỗi giờ; đồng nào không có hợp đồng USDT vĩnh cửu
trên OKX, stablecoin hay token bọc thì lấy đồng vốn hoá kế tiếp) **cùng vàng (XAU) và dầu WTI (CL)**,
tìm các **đường xu hướng trong 1000 nến H1 gần nhất** (≈ 42 ngày) và báo về iPhone khi có:

- **Phá** — nến H1 **đóng cửa** ra ngoài đường (râu không tính), rồi **giữ được qua cây M30 đầu tiên của giờ sau**
  (luật M30, xem dưới). Phá kháng cự → LONG, phá hỗ trợ → SHORT.
- **Xác nhận** — đóng cửa vượt đỉnh/đáy cuối cùng nằm trên đường (gãy cấu trúc).
- **Retest** — giá chạy ra xa rồi quay về chạm lại đường vừa phá và giữ được.

Kèm app xem chart kiểu OKX/TradingView: nến cập nhật trực tiếp, EMA200, Stoch 32/13/5 và 10/5/5,
đường kháng cự (đỏ) / hỗ trợ (xanh) bot đang theo dõi, danh sách tín hiệu. Bấm vào thông báo là mở đúng chart, đúng đường vừa phá.

**App:** https://duylong06.github.io/Bot-trade/

Không cần máy tính bật 24/7: bot chạy trên GitHub Actions, app chạy trên GitHub Pages, thông báo đi thẳng qua Apple.

---

## Cài đặt (làm một lần)

### 1. Cài app lên iPhone
Mở **Safari** → vào https://duylong06.github.io/Bot-trade/ → nút **Chia sẻ** → **Thêm vào MH chính**.
Từ giờ mở app bằng biểu tượng **Bot Trade** trên màn hình chính (iPhone chỉ cho nhận thông báo theo cách này, iOS 16.4+).

### 2. Bật thông báo
Trong app: tab **Cài đặt** → **Bật thông báo** → cho phép.

**Lần đầu tiên** (bot chưa có khoá): app hiện một đoạn mã. Chép đoạn đó, rồi trên GitHub
**Settings → Secrets and variables → Actions → New repository secret** — Name: `PUSH_CONFIG`, Secret: dán đoạn mã.
Lần quét kế tiếp bot gửi “Bot Trade đã nhận máy này ✓”.

**Từ đó về sau không phải dán mã nữa.** Mỗi lần mở app, app tự kiểm tra đăng ký thông báo của máy:
- iPhone huỷ đăng ký / bot báo đăng ký đã chết → app tự đăng ký lại bằng khoá của bot và gửi cho bot qua kênh
  ntfy (`core/config.js` → `NTFY`); bot nhận ở lần quét kế tiếp.
- iOS không cho tự đăng ký khi chưa chạm → app hiện **thanh đỏ “Thông báo đang tắt — chạm để bật lại”** ở trên cùng.
  Chạm một lần là xong.

Thông báo gửi dạng *Declarative Web Push*: iPhone iOS 18.4+ tự hiện thông báo mà không cần chạy code của app,
nên iOS không coi là “push im lặng” để tự tắt — đây là nguyên nhân hay gặp khiến thông báo mất sau vài giờ.

> Đoạn mã có khoá riêng của bot, được tạo ngay trên iPhone. Chỉ dán vào GitHub Secret, đừng gửi ai.
> Đăng ký gửi qua ntfy không phải bí mật: không có khoá riêng (chỉ nằm trong GitHub Secret) thì không ai gửi được tới máy bạn.

### 3. Cho bot chạy đúng giờ (nên làm)
Lịch chạy có sẵn của GitHub **rất thất thường** — repo này từng đặt chạy mỗi giờ mà thực tế chỉ chạy ~5 lần/ngày,
lệch tới cả tiếng. Để bot chạy ở phút 58, chờ nến H1 đóng rồi báo trong vài giây:

1. Tạo token GitHub: https://github.com/settings/personal-access-tokens/new
   - Repository access: **Only select repositories** → `Bot-trade`
   - Repository permissions → **Actions: Read and write**
2. Tạo tài khoản https://cron-job.org → **Create cronjob**:
   - URL: `https://api.github.com/repos/duylong06/Bot-trade/actions/workflows/scan.yml/dispatches`
   - Lịch: mỗi giờ, phút **58**
   - Advanced → Method **POST**
   - Headers: `Authorization: Bearer <token>` · `Accept: application/vnd.github+json` · `X-GitHub-Api-Version: 2022-11-28`
   - Body: `{"ref":"main"}`
3. **Test run** → thấy `204` là xong.

Không cài bước này bot vẫn chạy theo lịch GitHub, chỉ là trễ và không đều.

---

## Luật phát hiện

Toàn bộ nằm trong `core/breakout.js` và `core/confirm.js` (bot và app dùng chung, nên đường bot báo và đường app vẽ luôn khớp).

| | |
|---|---|
| Cửa sổ | 1000 nến H1 gần nhất (≈ 42 ngày). Đo trên 400 ngày nến thật 11 đồng top: đường dài 500–1000 nến phá khoảng 1,2 lần/đồng/tháng, hơn nửa số đó cửa sổ 500 nến bỏ lỡ, và sau khi phá giá chạy theo chiều phá tốt hơn đường ngắn (chưa thật chắc chắn về thống kê) |
| Độ dài mô hình | **≥ 30 nến H1** (từ điểm neo đầu tới cây phá). Rút ra từ 1 năm nến thật top 10 vốn hoá: mô hình ngắn hơn cho nhiều cú phá giả |
| Hướng | chỉ đường **thuận chiều phá**: kháng cự giảm/ngang (phá lên → LONG), hỗ trợ tăng/ngang (phá xuống → SHORT) |
| Điểm neo | râu nến (đỉnh/đáy); neo đầu phải là **đáy/đỉnh thật** — phía trước nó không có đáy thấp hơn / đỉnh cao hơn |
| Râu kim | không neo vào cây râu kim (râu ≥ 2 lần thân và thò ra ≥ 1,5 ATR so với râu các cây ±5 bên cạnh) |
| Chạm | ≥ 3 lần; giữa hai lần chạm giá phải bật ra ≥ 1,5 ATR |
| Phá | cây nến H1 **đầu tiên đóng cửa** ra ngoài đường, râu không tính. Cây phá là cây giật râu (râu theo chiều phá ≥ 1 ATR và ≥ 2 lần thân) → không báo |
| **Luật M30** | phá xong **chưa báo**. Chờ cây M30 đầu tiên của giờ sau đóng (phút :30). LONG: M30 chạm về ≤ đáy cây phá → không báo, **trừ khi M30 đóng xanh** (rút râu). SHORT: M30 chạm ≥ đỉnh cây phá → không báo, trừ khi đóng đỏ. M30 đứng giá mà có chạm → không báo |
| Xác nhận | đóng cửa vượt đỉnh/đáy cuối cùng nằm trên đường — báo ngay khi nến H1 đóng |
| Retest | sau khi phá, chạy xa ≥ 2 ATR rồi quay về chạm đường, đóng cửa giữ được — báo ngay khi nến H1 đóng |
| Thông báo | mỗi cú phá một tin, không giới hạn; chỉ gộp khi cùng đồng, cùng chiều, cùng cây nến |

**Biểu đồ trong app:** kháng cự màu đỏ, hỗ trợ màu xanh dương, nét liền + nhãn **KC/HT** ở trục giá = còn hiệu lực;
nét đứt = vừa bị phá (trong 48 giờ, mỗi phía một đường). Mỗi phía vẽ tối đa 2 đường gần giá; hai đường cùng phía cách nhau
dưới 1,5 ATR là một vùng, chỉ vẽ đường rõ nhất. Dấu Phá / XN / Retest chỉ hiện trên đường đang vẽ. Đường đang xem từ thông báo: màu vàng.

**Lịch chạy mỗi giờ** (`.github/workflows/scan.yml`): phút :58 bot bắt đầu, chờ nến H1 đóng → báo Retest/Xác nhận ngay,
cú Phá thì ghi “chờ M30” (app hiện “⏳ chờ nến M30 · báo lúc HH:30”) → bot ở lại tới phút :30 → xét cây M30 → báo hoặc bỏ
(app ghi lý do). Bot không kịp xét M30 trong 90 phút thì thôi không báo cú đó.

Đo trên nến thật 30 ngày (tới 28/10/2026), quy ra 69 mã: khoảng **85–100 thông báo/ngày**
(khoảng một nửa là Phá đã qua M30, còn lại Xác nhận và Retest); luật M30 bỏ khoảng 8% cú phá, cây giật râu ~1%.
Nới cửa sổ từ 500 lên 1000 nến thêm khoảng 5 thông báo/ngày.
Muốn bớt: đặt `MIN_SPAN_ALERT` (ví dụ 60) hoặc bỏ `CONFIRM`/`RETEST` khỏi `ALERTS`.

## Chỉnh nhanh — `core/config.js`

| Biến | Ý nghĩa |
|---|---|
| `TOP_N` | số đồng crypto theo dõi theo vốn hoá (mặc định 67) |
| `PINNED` | mã luôn theo dõi ngoài top: `XAU-USDT-SWAP` (vàng), `CL-USDT-SWAP` (dầu WTI); thêm `BZ-USDT-SWAP` (dầu Brent), `XAG-USDT-SWAP` (bạc) nếu muốn |
| `CATEGORIES` | loại được xếp hạng vào top: `['1']` chỉ crypto · `'3'` cổ phiếu |
| `ALERTS` | bỏ loại nào khỏi `['BREAK','CONFIRM','RETEST']` là thôi báo loại đó |
| `MIN_SPAN_ALERT` | chỉ báo mô hình từ N nến trở lên (0 = theo luật lõi, tức ≥ 30 nến) |
| `TUNE` | ghi đè ngưỡng trong `core/breakout.js`, ví dụ `{ MIN_PATTERN: 40 }` |
| `NTFY` | kênh app gửi đăng ký thông báo cho bot |

## Thư mục

```
index.html, manifest.webmanifest, sw.js   app (GitHub Pages)
app/                                       giao diện, chart, WebSocket OKX, bật thông báo
core/breakout.js                           lõi phát hiện phá vỡ — dùng chung
core/confirm.js                            luật M30
core/okx.js, core/format.js, core/config.js
bot/scan.mjs                               bot quét + gửi thông báo (GitHub Actions), bước h1 và bước m30
bot/mcap.mjs                               xếp hạng vốn hoá (CoinGecko, dự phòng CoinPaprika)
bot/plan.mjs                               soạn nội dung và gộp thông báo
bot/save-data.sh                           đẩy dữ liệu lên nhánh data
bot/test-core.mjs, bot/fixtures/           kiểm thử lõi (có nến thật OKX các ca đã gặp):  npm test
bot/replay.mjs                             phát lại bot trên nến thật để đếm số thông báo
.github/workflows/scan.yml                 lịch chạy
```

Bot lưu tín hiệu, trạng thái, danh sách top 67 (`top.json`) và bộ nhớ chống trùng ở nhánh `data` (app đọc từ đây).
Bản cũ (`quet-tin-hieu.html` + bot Telegram) vẫn còn nguyên ở nhánh `legacy`.

## Thêm mô hình mới

1. Thêm cách phát hiện vào `core/breakout.js` (trả về sự kiện cùng dạng `{ type, dir, t, line, … }`).
2. `npm test`.
3. Đẩy lên một nhánh thử, workflow tự chạy chế độ `dry-run` trên giá thật và lưu nến vào nhánh `data`.
4. `git fetch origin data && git show FETCH_HEAD:dryrun-candles.json > out/dryrun-candles.json && node bot/replay.mjs`
   để xem mô hình mới sinh ra bao nhiêu thông báo/ngày trước khi đưa vào `main`.
