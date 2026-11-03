# Bot Trade — báo phá vỡ trendline M30 / H1 / H4, kèm điểm /100

Bot quét **top 67 đồng crypto theo vốn hoá** (CoinGecko, cập nhật mỗi giờ; đồng nào không có hợp đồng USDT vĩnh cửu
trên OKX, stablecoin hay token bọc thì lấy đồng vốn hoá kế tiếp) **+ top 36 đồng có khối lượng giao dịch 24h lớn nhất
trên OKX** (gộp, không trùng) **cùng vàng (XAU) và dầu WTI (CL)**,
tìm các **đường xu hướng trên khung M30, H1 và H4** và báo về iPhone khi có:

- **Phá** — nến **đóng cửa** ra ngoài đường (râu không tính) bằng cây phá đẹp, rồi **giữ được qua cây M30 đầu tiên của giờ sau**
  (luật M30); cây phá chưa đẹp thì chờ cây sau phá tiếp. Phá kháng cự → LONG, phá hỗ trợ → SHORT.
- **Xác nhận** — đóng cửa vượt đỉnh/đáy cuối cùng nằm trên đường (gãy cấu trúc).
- **Retest** — giá chạy ra xa rồi quay về chạm lại đường vừa phá và giữ được.

Mỗi tín hiệu được **chấm điểm /100** theo prompt V8.0 (đa khung, Dual Stoch, trendline + Hộp Tím, SMC, dòng tiền phái sinh,
on-chain & vĩ mô), có **hạng S++/S+/A/B/C**, **cờ đỏ**, **Entry / SL / TP1 / TP2 / R:R**; kèo S+/S++ được theo dõi tiếp
(+0,6R, TP1, TP2, nhắc cắt sớm, hết hạn). Thêm báo cáo dòng tiền 07:00 · 15:00 · 23:00. Xem mục **Lớp chấm điểm** bên dưới.

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
Cách kẻ đường theo đúng các ca chủ repo chỉ (CL, HBAR, ALGO, VVV, kênh BTC tháng 7–8/2026, và DASH, APT, ETC, STX, PI,
POL, XRP ngày 29/10 — có trong `bot/test-core.mjs`) và tài liệu kẻ trendline chuẩn: nối các đỉnh/đáy của các con sóng rõ ràng,
2 điểm là đường tiềm năng, điểm thứ 3 xác nhận; râu ngoại lệ bỏ qua; phá vỡ phải là giá đóng cửa dứt khoát;
khung nhỏ nhiều nhiễu thì xem đường ở khung lớn hơn.

| | |
|---|---|
| Khung | **M30, H1 và H4** (`core/config.js` → `TF_RULES`) |
| Độ dài | mô hình dài **≥ 45 nến** và tối đa theo khung (prompt V8.0): **M30 ≤ 60**, **H1 ≤ 96**, **H4 ≤ 120 nến** — quá thì đường hết hạn. Hai điểm neo cách nhau ≥ 5 / 6 / 8 nến |
| Hướng (chặt) | **hỗ trợ tăng** nối đáy thấp → đáy **cao hơn** (bị phá xuống → SHORT); **kháng cự giảm** nối đỉnh cao → đỉnh **thấp hơn** (bị phá lên → LONG); so cả râu. Đáy thấp dần, đỉnh cao dần, đường gần như nằm ngang **không phải trendline** → bỏ |
| Đáy/đỉnh đầu tiên | kẻ ở **đầu râu**; nến đẹp (không phải **cây rút râu**: râu dài hơn 2 lần cây nến bình thường, hoặc chọc ra khỏi 3 nến mỗi bên hơn 1,2 lần cây bình thường); là **đáy/đỉnh thật của cả xu hướng**: không có râu nào thấp hơn/cao hơn từ đó tới cây phá, và phía trước (≥ nửa chiều dài mô hình, tối đa 120 nến) không có đáy thấp hơn/đỉnh cao hơn (bỏ qua cây rút râu, cây giật ở xa như ALGO 08/10) |
| Từ đáy/đỉnh thứ hai | đường thử cả hai cách: **đầu râu ↔ đầu râu** (kẻ chạm râu, không cắt thân — luật prompt) và đầu râu ↔ **thân** cụm nến sau. Cây râu dài chọc ra một mình chạm đường mà thân còn xa **không tính** |
| Hai con sóng | mỗi lần chạm là đáy/đỉnh của **một con sóng riêng**: giữa hai lần chạm giá chạy ra xa đường ≥ 1,5 ATR và ≥ 30% bề rộng mô hình, sóng hồi về sâu ≥ 25% sóng trước |
| Đẹp, không thiếu | đường được xoay từ điểm neo đầu tới khi chạm thân các đáy/đỉnh sau; chọn đường **chạm nhiều đáy/đỉnh nhất**, không bỏ sót đáy/đỉnh nào nằm trên đường; đáy/đỉnh không thẳng hàng thì đường đi giữa thân và râu |
| Số chạm | **2 điểm neo là đường hợp lệ**; đủ 3 chạm được cộng điểm cấu trúc |
| Đường sạch | từ điểm neo đầu tới cây phá: không thân nến nào vượt đường; râu của nến khác (ngoài cụm nến các lần chạm) xuyên đường > 0,35 ATR quá 2 cây là kẻ bừa → bỏ |
| Biên sideway | giá đi ngang giữa **kháng cự ngang** và **hỗ trợ ngang** của cùng một vùng (mỗi biên ≥ 2 lần chạm, cao 1,5–8 ATR). Chỉ báo khi cây nến **phá biên với khối lượng ≥ 2 lần trung bình 20 nến** — phá mà volume nhỏ thì không báo |
| Một đỉnh nhiều đường | một đỉnh/đáy được làm điểm neo cho nhiều đường (mỗi đáy/đỉnh thứ hai một đường); app chỉ vẽ đường rõ nhất mỗi vùng giá (2 đường cùng phía cách nhau ≤ 3 ATR) |
| Vùng nhiều râu ngắn | đỉnh/đáy đầu là vùng đi ngang nhiều râu ngắn (≥ 4 cây trong ±4 nến) → kẻ qua **trung bình các đầu râu**, không thấp hơn thân nến cao nhất (kháng cự) / không cao hơn thân thấp nhất (hỗ trợ) |
| Kênh giá | chỉ khi **phía bên kia cũng có một trendline thật** (đủ luật) gần song song (hai biên lệch nhau ≤ 25% bề rộng kênh), cùng cỡ mô hình. Không tự kẻ song song qua một đỉnh/đáy lẻ. App vẽ tối đa 1 kênh: biên kênh + đường giữa đứt |
| Phá | cây nến **đóng cửa** ngoài đường (râu không tính) |
| Cây phá đẹp | phá lên **nến xanh**, phá xuống **nến đỏ**, **thân dài hơn cả hai râu**, đóng xa đường ≥ 0,15 ATR. Tin báo ghi khối lượng cây phá so với trung bình 20 nến |
| H1 phá đẹp → **luật M30** | chờ cây M30 đầu tiên của giờ sau (phút :30). LONG: M30 chạm về ≤ đáy cây phá → không báo, trừ khi M30 đóng xanh. SHORT: ngược lại |
| Cây phá chưa đẹp | sai màu / râu dài hơn thân / đóng sát đường → **không xét M30**, chờ cây kế tiếp: đóng tiếp ngoài đường và đúng màu thì báo; quay lại trong đường là phá giả, đường vẫn còn |
| H4 | phá đẹp → báo ngay khi cây H4 đóng (03, 07, 11, 15, 19, 23 giờ VN); chưa đẹp → chờ cây H4 sau |
| M30 | **không vào ở nến phá**: chờ nến M30 thứ 2 đóng tiếp ngoài đường, đúng màu rồi mới báo. Xét lúc :00 (bước H1) và :30 (bước M30) |
| Xác nhận, Retest | gãy cấu trúc / quay về chạm đường rồi giữ — báo ngay khi nến đóng |
| Đúng lúc | chỉ báo tín hiệu của cây nến **vừa đóng**, không báo bù tín hiệu cũ |
| Thông báo | mỗi cú phá một tin, không giới hạn; chỉ gộp khi cùng đồng, cùng chiều, cùng cây nến, cùng khung (hoặc hai đường gần trùng nhau thủng cách nhau ≤ 3 nến) |

**Biểu đồ trong app:** kháng cự đỏ, hỗ trợ xanh dương; nét liền + nhãn **KC/HT** = còn hiệu lực, nét đứt = vừa bị phá;
đường H4 dày hơn, nhãn **H4**; kênh giá: biên đối diện + đường giữa đứt; biên sideway: nhãn **đỉnh biên / đáy biên**.
Có thêm khung **30m** để xem cây M30.

**Lịch chạy mỗi giờ** (`.github/workflows/scan.yml`): phút :58 bot bắt đầu, chờ nến H1 đóng → báo Retest/Xác nhận ngay,
cú Phá đẹp ghi “chờ M30”, cú phá chưa đẹp ghi “chờ cây sau” → bot ở lại tới phút :30 → xét cây M30 → báo hoặc bỏ (app ghi lý do).
Giờ nào cây H4 cũng đóng thì bot xét thêm khung H4.

Mô phỏng 48 giờ (27–29/10/2026) trên 69 mã: ~95 sự kiện H1/ngày trước luật M30 (phá ~55, trong đó phá biên sideway
có volume ~8; xác nhận ~21; retest ~18), tương đương bản trước. Thêm top 36 khối lượng thì nhiều mã hơn, số tin tăng theo.
Muốn bớt: đặt `MIN_SPAN_ALERT` hoặc bỏ `CONFIRM`/`RETEST` khỏi `ALERTS`.

## Lớp chấm điểm (prompt V8.0)

`core/score.js` (chấm điểm), `core/ta.js` (chỉ báo), `core/liqmap.js` (bản đồ thanh lý), `bot/context.mjs` (dữ liệu),
`bot/trades.mjs` (theo dõi kèo). Chấm ngay trước khi báo, trên nến đã đóng.

| Lớp | Điểm | Nội dung |
|---|---|---|
| 1 Đa khung | 20 | EMA21/55/144 xếp tầng + giá so EMA200 ở khung xu hướng (Scalp 1H · Intraday 4H · Swing 1D); nhịp ngắn 1M–1W–1D–4H–1H và khung xác nhận; ADX ≥ 22 |
| 2 Dual Stoch | 20 | 32/13/5 đúng vị thế; 10/5/5 cắt từ vùng cực trị với góc 35°–68° |
| 3 Trendline | 20 | số chạm; Hộp Tím / ổ thanh khoản tại điểm phá; nến 2 xác nhận (nến M30 sau H1, nến 2 của M30, retest). H1 45–90 nến, ≥ 3 chạm, phá cùng EMA200 → 20/20 |
| 4 SMC & nến | 15 | giá vào trong OTE 0,618–0,79 / Order Block / FVG; mẫu nến đảo chiều / phân kỳ; không có nến nước rút |
| 5 Phái sinh | 15 | volume ≥ 1,3× + CVD (taker OKX); ma trận Giá × OI; vừa quét cụm thanh lý / nam châm thanh lý |
| 6 On-chain & vĩ mô | 10 | ví sàn (Binance 14 "28c", TDqSq, ví BTC Binance/Bitfinex), Whale Alert; ma trận BTC.D × USDT.D; tin Đỏ FED ±45 phút |

Hạng: **S++ ≥ 92** · **S+ 88–91** · A ≥ 80 · B ≥ 70 · C. Ngược khung xác nhận hoặc ADX < 20 → hạ 1 hạng.
**6 cờ đỏ** (R:R tới TP1 < 1,5 · ngược xu hướng chưa đủ chuỗi Sweep → CHoCH → Climax Volume → Phân kỳ · RISK-OFF ·
cá voi xả / kênh on-chain báo xả · vào trễ · SL rộng hoặc tường lệnh trước TP1) và **khoá Stoch** (ghim đỉnh/đáy, lờ đờ giữa,
lao thẳng đứng, nước rút, Giá × OI cấm đuổi, giờ tin Đỏ) → **Đứng ngoài**. Bot vẫn báo mọi cú phá, kèm điểm và lý do.

TP/SL: SL ngoài cây phá (xác nhận: ngoài đỉnh/đáy cũ) + đệm 0,3 / 0,4 / 0,5 ATR; TP1 = cản gần nhất phía trước
(đỉnh/đáy swing chưa bị vượt, ổ thanh khoản, đỉnh/đáy ngày–tuần trước); TP2 = +2,2R.

Không làm được trên GitHub Actions (cần máy chủ chạy liên tục): WebSocket từng tick, độ trễ < 5 ms, CVD từng lệnh.
**Không có hệ thống nào thắng 100%** — điểm chỉ là bộ lọc, chưa được kiểm chứng trên lịch sử (thiếu lịch sử OI, dòng tiền).

## Chỉnh nhanh — `core/config.js`

| Biến | Ý nghĩa |
|---|---|
| `TOP_N` | số đồng crypto theo dõi theo vốn hoá (mặc định 67) |
| `TOP_VOL` | cộng thêm top N đồng khối lượng giao dịch 24h lớn nhất trên OKX (mặc định 36; đồng đã có thì không tính lại) |
| `PINNED` | mã luôn theo dõi ngoài top: `XAU-USDT-SWAP` (vàng), `CL-USDT-SWAP` (dầu WTI); thêm `BZ-USDT-SWAP` (dầu Brent), `XAG-USDT-SWAP` (bạc) nếu muốn |
| `CATEGORIES` | loại được xếp hạng vào top: `['1']` chỉ crypto · `'3'` cổ phiếu |
| `ALERTS` | bỏ loại nào khỏi `['BREAK','CONFIRM','RETEST']` là thôi báo loại đó |
| `MIN_SPAN_ALERT` | chỉ báo mô hình từ N nến trở lên (0 = theo luật lõi, tức ≥ 30 nến) |
| `TUNE` | ghi đè ngưỡng trong `core/breakout.js`, ví dụ `{ MIN_PATTERN: 40 }` |
| `TF_RULES` | luật riêng từng khung: độ dài tối đa, khoảng cách hai điểm neo, số chạm, kẻ chạm râu |
| `NTFY` | kênh app gửi đăng ký thông báo cho bot |

## Thư mục

```
index.html, manifest.webmanifest, sw.js   app (GitHub Pages)
app/                                       giao diện, chart, WebSocket OKX, bật thông báo
core/breakout.js                           lõi phát hiện phá vỡ — dùng chung
core/score.js, core/ta.js, core/liqmap.js  chấm điểm /100, chỉ báo, bản đồ thanh lý
bot/context.mjs, bot/trades.mjs            dữ liệu chấm điểm (OKX, CoinGecko, on-chain, Telegram), theo dõi kèo S+/S++
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

Bot lưu tín hiệu, trạng thái, danh sách đồng theo dõi (`top.json`) và bộ nhớ chống trùng ở nhánh `data` (app đọc từ đây).
Bản cũ (`quet-tin-hieu.html` + bot Telegram) vẫn còn nguyên ở nhánh `legacy`.

## Thêm mô hình mới

1. Thêm cách phát hiện vào `core/breakout.js` (trả về sự kiện cùng dạng `{ type, dir, t, line, … }`).
2. `npm test`.
3. Đẩy lên một nhánh thử, workflow tự chạy chế độ `dry-run` trên giá thật và lưu nến vào nhánh `data`.
4. `git fetch origin data && git show FETCH_HEAD:dryrun-candles.json > out/dryrun-candles.json && node bot/replay.mjs`
   để xem mô hình mới sinh ra bao nhiêu thông báo/ngày trước khi đưa vào `main`.
