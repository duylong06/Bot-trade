# Quét tín hiệu OKX

Trang web một file, phân tích futures OKX **ngay trong trình duyệt** — không server, không bot chạy nền, không thông báo.

Mở: <https://duylong06.github.io/Bot-trade/>

## Bốn tab

| Tab | Làm gì |
|---|---|
| **Phá vỡ** | Coin đang phá đường xu hướng, phá vùng tích luỹ, hoặc vừa hoàn tất mô hình giá. Trên cùng là **bảng xu hướng chung** |
| **Sắp phá** | Coin nén sát một mức chưa bị phá, kèm một cây volume mạnh ép vào mức đó |
| **Theo dõi** | Theo dõi **liên tục** một đồng: sổ lệnh, tường thật hay giả, dòng tiền chủ động, OI, và kết luận **Kèo Pro** trên M30 + H1 |
| **Cài đặt** | Số coin quét, ngưỡng lọc, ngưỡng kết luận xu hướng |

Mỗi thẻ có biểu đồ nến, các mức quan trọng, và giải thích bằng tiếng Việt.

## Bảng xu hướng chung (độ rộng thị trường)

Mỗi lần quét khung **H1**, app đếm xem bao nhiêu coin vừa phá **cả đường ngắn hạn (8–35 nến) lẫn đường trung hạn (36–120 nến)** cùng một chiều, trong 2 nến gần nhất. Đường chỉ 8–10 nến vẫn tính là trendline. Phá = nến **đóng cửa** vượt qua đường; râu đâm qua không tính; đường chưa từng bị nến nào đóng cửa xuyên qua.

Từ **5 coin** trở lên (đổi được trong Cài đặt) thì app kết luận thị trường đang nghiêng về một phía. App **không liệt kê coin nào phá** — bạn tự xem danh sách bên dưới và chọn.

Đo trên 3 năm, 23 coin top: ngưỡng 5 chưa có lợi thế rõ, từ 8 trở lên mới thấy lợi thế nhưng chỉ khoảng 3 lần mỗi tháng. Khi rất nhiều coin cùng phá **lên** thì mua đuổi lại hay thua — đó thường là lúc đứng ngoài.

## Chỉ coin

App bỏ vàng, bạc, dầu, chỉ số chứng khoán và mọi hợp đồng không phải tiền mã hoá, lọc theo phân loại của OKX.

## Thời gian thực

Bấm Quét là lấy giá ngay lúc đó, **tính cả nến H1 đang chạy**. Cú phá trên nến chưa đóng được ghi rõ "nến đang chạy" — giá vẫn có thể rút về trước khi hết giờ.

## Chạy

Không cần cài gì. Mở `index.html` bằng trình duyệt, hoặc vào đường dẫn GitHub Pages ở trên. Dữ liệu lấy thẳng từ API công khai của OKX.

Thêm vào màn hình chính iPhone: mở bằng Safari → Chia sẻ → Thêm vào MH chính.

## Lịch sử

Repo này từng là bot báo phá vỡ trendline chạy trên GitHub Actions, đẩy thông báo về iPhone. Bản đó đã gỡ (11/2026) để quay lại bản quét chạy thẳng trên máy. Toàn bộ code bot và app cũ vẫn còn trong lịch sử git, tại commit `172e0a3`.

## Bot thông báo Kèo Pro

`bot/keo.mjs` chạy trên GitHub Actions — **tự động, không cần mở app hay bấm quét**. Quét **BTC, ETH, SOL, BNB** trên khung **M30, H1 và H4** bằng `core/keopro.js` — bản JavaScript của chỉ báo TradingView "Bot Kèo Pro" gói 100.

Đẩy thông báo cho kèo hạng **A+** (điểm đồng thuận chỉ số ≥ 5/7) và **A** (≥ 3/7), không dính cờ loại. Đổi bằng biến `GRADES` (mặc định `A+,A`; đặt `A+` nếu chỉ muốn kèo mạnh nhất). Mỗi (đồng, khung) giữ **một kèo cùng lúc**, giống luật của chỉ báo; kèo đang chạy được theo dõi và báo tiếp khi chạm TP1, TP2, SL hoặc hết hạn.

Phong cách lấy theo khung chart đúng như bản Pine: **M30 và H1 = intraday** (khung lớn 4H, SL tối thiểu 0,8%, hạn 60 giờ) · **H4 = swing** (khung lớn 1D, SL tối thiểu 1,5%, hạn 240 giờ).

Mỗi tin kèm luôn phân tích: vì sao vào, điểm từng chỉ số, Entry/SL/TP1/TP2, R:R sau phí, volume, OI, mốc gần, xu hướng khung 4H.

### Lịch chạy — và vì sao phải bù

GitHub **bỏ gần hết lịch**: repo này đặt 2 lượt mỗi giờ mà thực tế chỉ chạy **1 trong 17 lượt**. Nên:

- Lịch đặt **4 lượt mỗi giờ** (phút :01 :16 :31 :46) cho tăng cơ hội.
- Mỗi lượt chạy được thì **soi lại vài nến đã đóng** chứ không chỉ nến cuối (M30 lùi 5 nến, H1 lùi 4, H4 lùi 2). Kèo ở nến cũ chỉ được báo nếu giá **chưa chạm SL và chưa chạm TP1** — đúng luật chờ ở vùng của chỉ báo. Tin nhắn ghi rõ nến xác nhận đóng lúc nào và trễ mấy nến.

Muốn đúng giờ thì cho **cron-job.org** gọi thẳng:

- URL: `https://api.github.com/repos/duylong06/Bot-trade/actions/workflows/keo.yml/dispatches`
- Lịch: mỗi 15 phút, hoặc phút :01 và :31
- Method **POST** · Headers: `Authorization: Bearer <token>` · `Accept: application/vnd.github+json` · `X-GitHub-Api-Version: 2022-11-28`
- Body: `{"ref":"main"}` · Test run thấy **204** là xong

Token không bao giờ nằm trong repo này.

### Chạy tay

Tab Actions → `mode`: `scan` · `test-push` (gửi tin thử) · `dry-run` (quét, in ra, không gửi, không ghi trạng thái) · `reset-open` (xoá kèo đang giữ). Ô `grades` chọn `A+,A` hoặc chỉ `A+`.

Khoá thông báo nằm trong GitHub Secret `PUSH_CONFIG`, không bao giờ nằm trong code.

**Lưu ý:** bản JS không khớp 100% với chỉ báo trên TradingView — khác nguồn dữ liệu (OKX với Binance) và vùng OB/FVG là bản rút gọn.
