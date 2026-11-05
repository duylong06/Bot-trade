# Quét tín hiệu OKX

Trang web một file, phân tích futures OKX **ngay trong trình duyệt** — không server, không bot chạy nền, không thông báo.

Mở: <https://duylong06.github.io/Bot-trade/>

## Sáu tab

| Tab | Làm gì |
|---|---|
| **Quét** | Chấm điểm setup hàng loạt coin theo khung thời gian (1H/4H, 15m/4H, 4H/1D, 1D/1W), lọc Long / Short / cả hai |
| **Một cặp** | Soi riêng một đồng, bỏ qua ngưỡng lọc, hiện điểm **cả hai chiều** để thấy vì sao chọn hướng đó |
| **Phá vỡ** | Coin đang phá đường xu hướng chéo, phá vùng tích luỹ, hoặc vừa hoàn tất mô hình giá (vai đầu vai, hai đỉnh/hai đáy, tam giác, nêm, cờ) |
| **Sắp phá** | Coin nén sát một mức chưa bị phá, kèm một cây volume mạnh ép vào mức đó. Tách **Đã phá** và **Sắp phá** |
| **Hỏi** | Hỏi đáp về đồng vừa xem, trả lời ngay trên máy |
| **Cài đặt** | Số coin quét, ngưỡng lọc, tốc độ gọi API |

Mỗi kết quả có: điểm từng mặt (khung lớn, cấu trúc, động lượng, khối lượng, dòng tiền, thanh khoản), biểu đồ nến, kế hoạch lệnh nhiều tầng (Entry 1-2-3, SL, TP1-2-3, R:R, đòn bẩy), luận điểm và rủi ro viết bằng tiếng Việt.

## Chạy

Không cần cài gì. Mở `index.html` bằng trình duyệt, hoặc vào đường dẫn GitHub Pages ở trên. Dữ liệu lấy thẳng từ API công khai của OKX.

Thêm vào màn hình chính iPhone: mở bằng Safari → Chia sẻ → Thêm vào MH chính.

## Lịch sử

Repo này từng là bot báo phá vỡ trendline chạy trên GitHub Actions, đẩy thông báo về iPhone. Bản đó đã gỡ (11/2026) để quay lại bản quét chạy thẳng trên máy. Toàn bộ code bot và app cũ vẫn còn trong lịch sử git, tại commit `172e0a3`.
