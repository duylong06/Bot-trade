# Bot Trade — báo phá vỡ trendline H1

Bot quét **top 50 đồng crypto** (hợp đồng USDT vĩnh cửu trên OKX, xếp theo khối lượng 24h, cập nhật mỗi giờ),
tìm các **đường xu hướng trong 500 nến H1 gần nhất** và báo về iPhone khi có:

- **Phá** — nến H1 **đóng cửa** ra ngoài đường (râu không tính). Phá kháng cự → LONG, phá hỗ trợ → SHORT.
- **Xác nhận** — đóng cửa vượt đỉnh/đáy cuối cùng nằm trên đường (gãy cấu trúc).
- **Retest** — giá chạy ra xa rồi quay về chạm lại đường vừa phá và giữ được.

Kèm app xem chart kiểu OKX/TradingView: nến cập nhật trực tiếp, EMA200, Stoch 32/13/5 và 10/5/5,
các đường bot đang theo dõi, danh sách tín hiệu. Bấm vào thông báo là mở đúng chart, đúng đường vừa phá.

**App:** https://duylong06.github.io/Bot-trade/

Không cần máy tính bật 24/7: bot chạy trên GitHub Actions, app chạy trên GitHub Pages, thông báo đi thẳng qua Apple.

---

## Cài đặt (làm một lần)

### 1. Cài app lên iPhone
Mở **Safari** → vào https://duylong06.github.io/Bot-trade/ → nút **Chia sẻ** → **Thêm vào MH chính**.
Từ giờ mở app bằng biểu tượng **Bot Trade** trên màn hình chính (iPhone chỉ cho nhận thông báo theo cách này, iOS 16.4+).

### 2. Bật thông báo
Trong app: tab **Cài đặt** → **Bật thông báo trên máy này** → cho phép.
App tạo một đoạn mã riêng cho máy bạn. Chép đoạn đó, rồi trên GitHub:

**Settings → Secrets and variables → Actions → New repository secret**
- Name: `PUSH_CONFIG`
- Secret: dán đoạn mã

Lần quét kế tiếp bot gửi “Bot Trade đã nhận máy này ✓”. Muốn thử ngay: tab **Actions** → **Quét phá vỡ** →
**Run workflow** → chọn `test-push`.

> Đoạn mã có khoá riêng của máy bạn, được tạo ngay trên iPhone. Chỉ dán vào GitHub Secret, đừng gửi ai.
> Có nhiều máy: dán mỗi đoạn mã một dòng trong cùng secret `PUSH_CONFIG`.

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

Toàn bộ nằm trong `core/breakout.js` (bot và app dùng chung một file, nên đường bot báo và đường app vẽ luôn khớp).

| | |
|---|---|
| Cửa sổ | 500 nến H1 gần nhất; mô hình nhỏ hay lớn đều xét |
| Điểm neo | râu nến (đỉnh/đáy); đường càng dài càng phải nối đỉnh/đáy lớn |
| Chạm | ≥ 3 lần; giữa hai lần chạm giá phải bật ra ≥ 1,5 ATR |
| Phá | nến H1 **đóng cửa** ngoài đường ≥ 0,5 ATR, thân nến ≥ 0,5 ATR; giá trôi ngang qua đường bằng nến nhỏ không tính |
| Xác nhận | đóng cửa vượt đỉnh/đáy cuối cùng nằm trên đường |
| Retest | sau khi phá, chạy xa ≥ 2 ATR rồi quay về chạm đường, đóng cửa giữ được |
| Chống ồn | cùng đồng cùng chiều gộp một tin; giờ nào > 3 tín hiệu thì gửi 2 tin lớn nhất + 1 tin tóm tắt; không báo phá cùng chiều 2 lần trong 3 nến |

Đo trên giá thật 48 giờ (ngày 21/10/2026): khoảng **70–80 tín hiệu/ngày**, điện thoại rung khoảng **40 lần/ngày**, tối đa 3 lần mỗi giờ.

## Chỉnh nhanh — `core/config.js`

| Biến | Ý nghĩa |
|---|---|
| `TOP_N` | số đồng theo dõi (mặc định 50) |
| `CATEGORIES` | `['1']` chỉ crypto · thêm `'4'` để có vàng, bạc, dầu · `'3'` cổ phiếu |
| `ALERTS` | bỏ loại nào khỏi `['BREAK','CONFIRM','RETEST']` là thôi báo loại đó |
| `MIN_SPAN_ALERT` | chỉ báo mô hình từ N nến trở lên (0 = mọi cỡ). Ví dụ 60 → còn khoảng 45 tín hiệu/ngày, 100 → khoảng 28 |
| `TUNE` | ghi đè ngưỡng trong `core/breakout.js`, ví dụ `{ MIN_SPAN: 20, BUF: 0.6 }` |

## Thư mục

```
index.html, manifest.webmanifest, sw.js   app (GitHub Pages)
app/                                       giao diện, chart, WebSocket OKX, bật thông báo
core/breakout.js                           lõi phát hiện phá vỡ — dùng chung
core/okx.js, core/format.js, core/config.js
bot/scan.mjs                               bot quét + gửi thông báo (GitHub Actions)
bot/plan.mjs                               soạn nội dung và gộp thông báo
bot/test-core.mjs                          kiểm thử lõi:  npm test
bot/replay.mjs                             phát lại bot trên nến thật để đếm số thông báo
.github/workflows/scan.yml                 lịch chạy
```

Bot lưu tín hiệu, trạng thái và bộ nhớ chống trùng ở nhánh `data` (app đọc từ đây).
Bản cũ (`quet-tin-hieu.html` + bot Telegram) vẫn còn nguyên ở nhánh `legacy`.

## Thêm mô hình mới

1. Thêm cách phát hiện vào `core/breakout.js` (trả về sự kiện cùng dạng `{ type, dir, t, line, … }`).
2. `npm test`.
3. Đẩy lên một nhánh thử, workflow tự chạy chế độ `dry-run` trên giá thật và lưu nến vào nhánh `data`.
4. `git fetch origin data && git show FETCH_HEAD:dryrun-candles.json > out/dryrun-candles.json && node bot/replay.mjs`
   để xem mô hình mới sinh ra bao nhiêu thông báo/ngày trước khi đưa vào `main`.
