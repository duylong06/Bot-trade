# Bài kiểm chạy trong trình duyệt thật

Chạy Chromium thật với dữ liệu OKX giả lập, để bắt lỗi mà đọc code không thấy.

```bash
cd ..                               # thư mục gốc repo
python3 -m http.server 8799 &
cd test
npm i -D playwright && npx playwright install chromium   # lần đầu
node gocloi.cjs                     # chạy từng bài
```

| Bài | Kiểm gì |
| --- | --- |
| `gocloi.cjs` | **Giá đồng mới ghi đè nến đồng cũ.** Bài này từng đỏ, xem phần dưới. |
| `app.cjs` | Danh sách coin, mở biểu đồ, kẻ đường bằng dấu thập, nam châm, lưu mốc, các tab. |
| `doi.cjs` | Đổi qua lại nhiều đồng, nến cũ, bấm nhanh. |
| `chua.cjs` | Khung nhìn trôi ra chỗ trống thì tự kéo về; OKX lỗi thì báo rõ và Thử lại được. |
| `rac.cjs` | **Nến rác của sàn**: ô trống, chữ, giá 0, giá âm, râu vọt 300 lần, chuỗi ngắn. |
| `botve.cjs` | Mở biểu đồ **từ tab Bot vẽ**, đọc kèo thật trên nhánh `moc-data`. Màn hình iPhone 3x, chạm ngón. |

## Lỗi "ấn đồng khác là mất biểu đồ" — gốc ở đâu

Tìm ra ngày 26/11/2026 sau bốn lần thử hỏng. `gocloi.cjs` dựng lại được:

1. `candles()` giữ kết quả trong bộ đệm 15 giây và **trả thẳng mảng trong đệm ra**.
2. Biểu đồ **sửa chính mảng đó** mỗi nhịp 4 giây, cho cây nến cuối chạy theo giá.
3. Bấm sang đồng khác thì `CV.sym` đổi ngay, nhưng `view.bars` vẫn là nến đồng cũ
   cho tới khi mạng trả về. Nhịp giá rơi đúng lúc đó sẽ ghi **giá đồng mới vào nến đồng cũ**.
4. Quay lại đồng cũ trong 15 giây là lấy phải mảng đã hỏng. Thang giá phải kéo từ
   1650 tới 60657 nên nến thật bị bẹp thành một vạch — nhìn như mất biểu đồ.

Số đo: 7264 điểm sáng lúc lành → **1922** lúc hỏng.

Ba lớp chặn, mỗi lớp đủ sức tự chặn:

- `candles()` luôn trả **bản sao**, bộ đệm không ai sửa được.
- `tick(last, sym)` chỉ nhận giá **đúng đồng đang vẽ**.
- `tick()` bỏ qua giá lệch quá 1,5 lần so với cây nến hiện tại.

## Lỗi thứ hai, cùng triệu chứng: nến rác của sàn

Tìm ra ngay sau đó, bằng `rac.cjs`. Dữ liệu thật của OKX có lúc lẫn nến hỏng, mà dữ liệu giả
"đẹp" của mấy bài trước không bao giờ có. Chỉ **một** cây là đủ làm bẹp cả biểu đồ:

| Kiểu nến rác | Tỉ lệ cao/thấp | Điểm sáng |
| --- | --- | --- |
| lành | 1,1 | 6709 |
| một cây giá 0 | 102 000 tỉ | **1560** |
| một giá âm | 109 000 tỉ | 6709 (thang hỏng) |
| râu vọt 300 lần | 319 | 6709 (thang hỏng) |
| ô chữ / NaN | — | 4 ô hỏng |

Thang giá phải kéo từ 0 tới 60000 nên nến thật co lại thành một vạch. `loc()` trong
`app/okx.js` bỏ cây hỏng và cắt râu dài quá 3 lần thân, giữ nguyên thân để hình nến vẫn thật.
Còn dưới 20 cây dùng được thì báo lỗi hẳn thay vì vẽ bừa.
