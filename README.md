# Bot Trade — báo phá vỡ trendline H1

Bot quét **top 67 đồng crypto theo vốn hoá** (CoinGecko, cập nhật mỗi giờ; đồng nào không có hợp đồng USDT vĩnh cửu
trên OKX, stablecoin hay token bọc thì lấy đồng vốn hoá kế tiếp) **cùng vàng (XAU) và dầu WTI (CL)**,
tìm các **đường xu hướng trên khung H1 và H4** (tối đa 1000 nến mỗi khung) và báo về iPhone khi có:

- **Phá** — nến **đóng cửa** ra ngoài đường (râu không tính) bằng cây phá đẹp, rồi **giữ được qua cây M30 đầu tiên của giờ sau**
  (luật M30); cây phá chưa đẹp thì chờ cây sau phá tiếp. Phá kháng cự → LONG, phá hỗ trợ → SHORT.
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
Cách kẻ đường theo đúng các ca chủ repo chỉ (CL, HBAR, ALGO, VVV, kênh BTC tháng 7–8/2026 — có trong `bot/test-core.mjs`)
và tài liệu kẻ trendline chuẩn: nối các đỉnh/đáy rõ ràng, 2 điểm là đường tiềm năng, điểm thứ 3 xác nhận; râu ngoại lệ bỏ qua;
phá vỡ phải là giá đóng cửa dứt khoát; khung nhỏ nhiều nhiễu thì xem đường ở khung lớn hơn.

| | |
|---|---|
| Khung | **H1 và H4**. H1 nhiều râu thì đường rõ nằm ở H4 — bot kẻ và báo cả hai |
| Cửa sổ | tối đa **1000 nến** mỗi khung (H1 ≈ 42 ngày, H4 ≈ 166 ngày); mô hình dài **≥ 45 nến** |
| Hướng | downtrend → **kháng cự giảm** nối các đỉnh thấp dần; uptrend → **hỗ trợ tăng** nối các đáy cao dần; sideway → kháng cự / hỗ trợ **ngang**. Không kẻ kháng cự tăng, hỗ trợ giảm |
| Điểm neo, điểm chạm | phải là **đỉnh/đáy đẹp, rõ ràng**: không phải **cây rút râu** (râu dài hơn 2 lần cây nến bình thường, hoặc chọc ra khỏi 3 nến mỗi bên hơn 1,2 lần cây bình thường); là cao/thấp nhất trong một khoảng đủ rộng; giữa hai lần chạm giá lùi khỏi đường ≥ 1,5 ATR và ≥ 30% bề rộng mô hình |
| Số chạm | ≥ 3; hoặc 2 nếu cả hai là đỉnh/đáy lớn (cao/thấp nhất ±24 nến, đã được nến thật xác nhận) |
| Đường sạch | từ điểm neo đầu tới cây phá: không thân nến nào vượt đường; râu chỉ được chạm — quá 2 râu xuyên đường (> 0,35 ATR) là đường kẻ sai, bỏ |
| Đỉnh/đáy thật | điểm neo đầu là đỉnh cao nhất / đáy thấp nhất của vùng phía trước (bỏ qua cây bất thường như cây giật ALGO 08/10) |
| Một đỉnh nhiều đường | một đỉnh/đáy được làm điểm neo cho nhiều đường; app chỉ vẽ đường rõ nhất mỗi vùng giá (2 đường cùng phía cách nhau ≤ 3 ATR) |
| Kênh giá | đường song song qua đáy thấp nhất (kênh giảm) / đỉnh cao nhất (kênh tăng) trong mô hình, khi biên đó cũng được chạm ≥ 2 lần — app vẽ biên kênh + đường giữa đứt |
| Phá | cây nến **đóng cửa** ngoài đường (râu không tính) |
| Cây phá đẹp | phá lên **nến xanh**, phá xuống **nến đỏ**, **thân dài hơn cả hai râu**, đóng xa đường ≥ 0,15 ATR |
| H1 phá đẹp → **luật M30** | chờ cây M30 đầu tiên của giờ sau (phút :30). LONG: M30 chạm về ≤ đáy cây phá → không báo, trừ khi M30 đóng xanh. SHORT: ngược lại |
| Cây phá chưa đẹp | sai màu / râu dài hơn thân / đóng sát đường → **không xét M30**, chờ cây kế tiếp: đóng tiếp ngoài đường và đúng màu thì báo; quay lại trong đường là phá giả, đường vẫn còn |
| H4 | phá đẹp → báo ngay khi cây H4 đóng (03, 07, 11, 15, 19, 23 giờ VN); chưa đẹp → chờ cây H4 sau |
| Xác nhận, Retest | gãy cấu trúc / quay về chạm đường rồi giữ — báo ngay khi nến đóng |
| Đúng lúc | chỉ báo tín hiệu của cây nến **vừa đóng**, không báo bù tín hiệu cũ |
| Thông báo | mỗi cú phá một tin, không giới hạn; chỉ gộp khi cùng đồng, cùng chiều, cùng cây nến, cùng khung |

**Biểu đồ trong app:** kháng cự đỏ, hỗ trợ xanh dương; nét liền + nhãn **KC/HT** = còn hiệu lực, nét đứt = vừa bị phá;
đường H4 dày hơn, nhãn **H4**; kênh giá: biên đối diện + đường giữa đứt. Có thêm khung **30m** để xem cây M30.

**Lịch chạy mỗi giờ** (`.github/workflows/scan.yml`): phút :58 bot bắt đầu, chờ nến H1 đóng → báo Retest/Xác nhận ngay,
cú Phá đẹp ghi “chờ M30”, cú phá chưa đẹp ghi “chờ cây sau” → bot ở lại tới phút :30 → xét cây M30 → báo hoặc bỏ (app ghi lý do).
Giờ nào cây H4 cũng đóng thì bot xét thêm khung H4.

Đo trên nến thật 30 ngày (11 đồng top, tới 27/10/2026), quy ra 69 mã: khoảng **65 thông báo/ngày**
(phá H1 ~31 — trong đó ~8 là cây phá chưa đẹp nhưng cây sau phá tiếp; xác nhận ~13; retest ~13; H4 ~9).
Khoảng 37% cây phá là cây chưa đẹp, phải chờ cây sau. Muốn bớt: đặt `MIN_SPAN_ALERT` hoặc bỏ `CONFIRM`/`RETEST` khỏi `ALERTS`.

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
