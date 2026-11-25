# Bot-trade

Biểu đồ futures OKX chạy thẳng trong trình duyệt, cộng một con bot trên GitHub Actions canh giúp
những đường bạn tự kẻ.

**App:** https://duylong06.github.io/Bot-trade/
Thêm vào màn hình chính iPhone: mở bằng Safari → Chia sẻ → Thêm vào MH chính.

## Bốn tab

| Tab | Làm gì |
| --- | --- |
| **Biểu đồ** | Top đồng OKX theo khối lượng, giá chạy mỗi 4 giây. Chạm vào một đồng để mở biểu đồ đầy màn hình. |
| **Bot vẽ** | Những đồng bot tự tìm thấy đang áp sát một đường xu hướng. Tham khảo, không phải lệnh. |
| **Mốc của tôi** | Các đường bạn đã kẻ và đang nhờ bot canh. |
| **Cài đặt** | Hộp thư giữa app và bot. |

## Biểu đồ

Dùng **Lightweight Charts v5.2.1** — thư viện mã nguồn mở của chính TradingView, để trong `vendor/`
nên không phụ thuộc mạng ngoài. Kéo ngang, phóng to thu nhỏ, crosshair giống hệt bên TradingView.

- Khung trên: nến, **EMA 200**, volume.
- Khung dưới: hai đường **Stoch** đúng bộ đang dùng — **32·13·5 vàng** dài hạn, **10·5·5 đỏ** ngắn hạn.
  Nét đậm %K, nét mờ %D, thang đo khoá cứng 0–100 với mốc 80 và 20.
- Khung nến: 15m · 30m · 1H · 4H · 1D.
- Bật tắt được: kháng cự/hỗ trợ, đường bot vẽ, EMA200.

## Kẻ đường và nhờ bot canh

1. Mở một đồng, bấm **Kẻ đường**.
2. Một **dấu thập ngắm** hiện ra giữa khung. **Rê** ngón ở bất cứ đâu — dấu thập đi đúng bằng quãng
   ngón đi, nên ngón đặt xa điểm cần ngắm cũng được, không che mất. Ngắm trúng thì **chạm một cái** để
   chốt điểm thứ nhất. Rê tiếp, đường kéo theo dấu thập, chạm thêm một cái là xong điểm thứ hai.
   Giá và giờ chỗ đang ngắm hiện ở thẻ vàng bên phải và dưới đáy.
   Muốn kẻ **ra xa khỏi giá hiện tại**: rê dấu thập tới sát mép phải rồi **giữ nguyên ngón** —
   biểu đồ tự chạy ra tương lai. Nó dừng khi khoảng trống chiếm 60% bề ngang, để nến không bị
   đẩy hết ra ngoài; muốn với xa hơn nữa thì **chụm hai ngón thu nhỏ** rồi làm lại, vì giới hạn
   tính theo số nến đang nhìn thấy. Mép trái cũng vậy. Chỗ sau cây nến cuối không có nến nên
   nam châm không bám.
4. **Kẻ xong vẫn kéo và phóng biểu đồ được như thường.** Chỉ cú chạm rơi sát ngay đầu neo mới
   bị giữ lại để chỉnh đường; chạm chỗ khác là biểu đồ nhận.
3. **Nam châm** bật sẵn: ngón ở nửa trên cây nến thì bám râu trên hoặc mép thân trên, nửa dưới thì bám
   râu dưới hoặc mép thân dưới — râu được ưu tiên. Tắt được bằng nút Nam châm trên thanh công cụ.
5. Vừa ý thì bấm **Xong**.
6. Chọn **phá xuống** hay **phá lên**, và lúc nào thì báo:
   - **Nến M30 đóng ngoài đường** — chắc hơn, râu quét qua rồi thụt lại thì không báo.
   - **Giá chạm đường** — nhanh hơn, nhiễu hơn.
7. Bấm **Lưu mốc**.

Bot nối dài đường theo đúng độ dốc hai điểm neo, kiểm mỗi lượt quét trên nến M30 **đã đóng**.
Đúng điều kiện thì đẩy thông báo về iPhone rồi **tắt mốc đó**, không báo lặp.

Tắt máy vẫn báo được, vì việc canh do bot trên GitHub làm chứ không phải app.

### Mốc đi từ app sang bot bằng đường nào

App chạy trên trang công khai nên **không được giữ khoá ghi vào repo** — ai xem mã nguồn cũng thấy.
Nên đường đi là:

```
app  --(gửi lệnh)-->  ntfy.sh  --(bot rút mỗi lượt)-->  moc.json trên nhánh moc-data
app  <--(đọc trạng thái)------------------------------  moc.json trên nhánh moc-data
```

Chiều đọc đi qua `raw.githubusercontent.com`, **không** qua `api.github.com`: API không đăng nhập
chỉ cho 60 lượt mỗi giờ, mà mỗi lần mở một đồng đã tốn 2 lượt — dùng một lúc là bị chặn và tab Bot vẽ
trống trơn. Kết quả còn được giữ lại 45 giây để mở liên tiếp mấy đồng không phải gọi lại.

`ntfy.sh` là hộp thư công khai, không cần đăng nhập, cho gửi thẳng từ trình duyệt. Tin ở đó tự hết
hạn sau 12 giờ — nó chỉ là **đường đi**, nơi lưu thật là nhánh `moc-data` do bot ghi. Bot rút hộp thư
mỗi 30 phút nên không kịp mất tin.

Đổi hộp thư thì phải đổi **cả hai chỗ**: ô trong tab Cài đặt của app, và biến `NTFY_TOPIC` ở
Settings → Secrets and variables → Actions → Variables.

Đã thử (25/11/2026): ntfy.sh gửi và đọc lại được từ GitHub Actions, CORS mở cho trình duyệt, thân tin
9 KB vẫn nhận. `jsonblob.com` thì **không dùng được** — Cloudflare chặn IP của GitHub Actions (403).

## Hai bot chạy riêng

| Bot | Workflow | Nhánh ghi ra | Việc |
| --- | --- | --- | --- |
| Mốc | `moc.yml` | `moc-data` | Canh đường bạn kẻ, tìm đồng sắp phá |
| Kèo Pro | `keo.yml` | `data` | Kèo A+ / A cho BTC, ETH, SOL, BNB |

Tách riêng vì job chạy liên tục gần 6 tiếng: gộp chung thì mốc vừa kẻ phải đợi job kia hết hạn mới
được canh, có khi 5 tiếng. Và job nào chết cũng không kéo job kia chết theo. Mỗi bot đẩy ra một nhánh
riêng — cùng một nhánh thì hai bên ép đẩy đè mất file của nhau.

## Bot tự tìm đồng sắp phá

`bot/moc.mjs` quét top đồng OKX trên khung H1 và H4 bằng `core/breakout.js` — đúng bộ dò trendline đã
dùng từ trước. Giữ hai loại, chạm từ 2 lần trở lên:

- **sắp phá** — đường còn sống, giá cách dưới 1,5%;
- **vừa phá** — đường bị phá trong vòng 10 nến, có ghi đã xác nhận gãy cấu trúc hay đã retest chưa.

Phải có cả loại thứ hai: thử lúc 17:55 ngày 25/11 trên 30 đồng ra **0 kết quả**, vì cả thị trường vừa
phá xuống sáng đó nên mọi đường hỗ trợ đều đã gãy. Chỉ lấy đường còn sống thì tab trống trơn đúng lúc
có nhiều việc nhất.

Mỗi (đồng, khung) giữ một đường, lấy tối đa 25, ghi ra `sap-pha.json`. Chạm vào một dòng là mở biểu đồ
đồng đó với đường bot vẽ hiện sẵn (màu tím), để bạn tự xem rồi kẻ lại theo ý mình.

## Bot thông báo Kèo Pro

`bot/keo.mjs` chạy cùng lượt, quét **BTC, ETH, SOL, BNB** trên **M30, H1, H4** bằng `core/keopro.js` —
bản JavaScript của chỉ báo TradingView "Bot Kèo Pro" gói 100. Đẩy kèo hạng **A+** (điểm ≥ 5/7) và **A**
(≥ 3/7). Mỗi (đồng, khung) giữ một kèo cùng lúc, có theo dõi TP1 / TP2 / SL.

Phong cách theo khung: **M30 và H1 = intraday** (khung lớn 4H, SL tối thiểu 0,8%, hạn 60 giờ) ·
**H4 = swing** (khung lớn 1D, SL tối thiểu 1,5%, hạn 240 giờ).

## Vì sao job chạy liên tục

GitHub **bỏ gần hết lịch**: repo này đặt 2 lượt mỗi giờ mà thực tế chỉ chạy **1 trong 17 lượt**. Nên:

- Một job **chạy liên tục ~5 giờ 40**, mỗi nhịp ngủ tới đúng lúc nến M30 / H1 / H4 đóng (phút :00 và
  :30, cộng 20 giây cho sàn chốt nến) rồi quét ngay. Tin tới **trong vòng một phút** sau khi nến đóng.
- Lịch `*/15` chỉ còn việc khởi động lại job khi hết hạn. Các dòng **cancelled** trong tab Actions là
  lượt chờ bị thay thế — bình thường, không phải lỗi.
- Repo công khai nên Actions **không tính phút**.
- Trạng thái đẩy lên nhánh `data` sau **mỗi** lượt, nên job chết giữa đường thì lượt sau vẫn biết.

## Chạy tay

Tab Actions, chọn workflow rồi Run workflow.

- **Mốc**: `loop` (mặc định) · `scan` (một lượt) · `test-push` (gửi tin thử về iPhone) · `dry-run` (quét, in ra, không gửi không ghi).
- **Kèo Pro**: thêm `test-push` (gửi tin thử) · `reset-open` (xoá kèo đang giữ).

Kiểm tại máy, không cần mạng: `node /tmp/.../bot-local.mjs` dựng sẵn mạng giả lập rồi chạy
`bot/moc.mjs` thật — bắt được loại lỗi mà `node --check` không thấy.

## Khoá

Khoá thông báo nằm trong GitHub Secret `PUSH_CONFIG`, **không bao giờ** nằm trong code.

## Biết trước mấy điều này

- Dữ liệu là của **OKX**. Nếu bạn đánh bên Binance thì giá lệch khoảng 0,01–0,04% — nhỏ hơn phí, nhưng
  không phải bằng không.
- Bản JS của Kèo Pro **không khớp 100%** với chỉ báo trên TradingView: khác nguồn dữ liệu, vùng OB/FVG
  là bản rút gọn.
- Danh sách "sắp phá" là **tham khảo**. Đo trên dữ liệu cũ cho thấy chưa có cách đặt SL nào có lợi
  nhuận dương sau phí ở kiểu vào lệnh đã thử.
- Mốc đã lưu chỉ **xoá** được từ tab Mốc của tôi; muốn đổi thì xoá rồi kẻ lại.
- Khung nhìn mà trôi ra chỗ không có nến thì app **tự kéo về** sau nửa giây, và lúc nào cũng có nút
  **Về nến** trên thanh công cụ. Không tải được nến thì hiện bảng báo rõ kèm nút Thử lại, không để
  màn hình trống không nói gì.
- Đang ngắm thì hai ngón không phóng to được ngay — nhả tay ra một nhịp rồi mới chụm.

## Lịch sử

Repo này từng có các tab Phá vỡ, Sắp phá, Theo dõi. Gỡ ngày 25/11/2026 để app gọn lại quanh biểu đồ.
Code cũ vẫn còn trong lịch sử git, bản đầy đủ ở commit `b1b91f7`.
