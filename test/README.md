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
| `phan.cjs` | Tấm **Phân tích**: bảng Stoch M15/H1/H4, kháng cự hỗ trợ H1 và H4. |
| `bop.cjs` | Khung biểu đồ bị **lề an toàn bóp thấp** như iPhone ở chế độ app màn hình chính, và xoay màn hình. |
| `thangGia.cjs` | **Thang giá bị khoá** ở khoảng của đồng cũ nên nến đồng mới nằm ngoài màn hình theo chiều dọc. |
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

## Lỗi thứ ba: không có đỉnh đáy nào khi hai nến cao bằng nhau

`phan.cjs` bắt được: bảng kháng cự hỗ trợ ra **rỗng hoàn toàn**. Lần ngược lại thì `swings()`
trả về 0 đỉnh, 0 đáy trên 300 nến.

`swings()` đòi nến đỉnh phải cao hơn **hẳn** cả hai bên (`>=` là loại). Khi hai nến cạnh nhau
cao bằng nhau — chuyện rất thường ở coin thanh khoản thấp, hoặc khi sàn làm tròn giá — thì cả
hai cùng bị loại, nên một đỉnh bằng phẳng biến mất sạch. Nhiều đỉnh phẳng thì không còn mức nào.

Sửa: bên trái cho phép bằng, bên phải bắt buộc thấp hơn. Một vùng bằng phẳng cho đúng **một**
đỉnh. Trên cùng bộ dữ liệu: 0 đỉnh → 8 đỉnh, 0 đáy → 10 đáy, 0 mức → 4 mức chạm từ 2 lần.

Lỗi này ảnh hưởng cả **đường kháng cự hỗ trợ vẽ trên biểu đồ**, không riêng tấm phân tích.

## Tự soi sau khi vẽ

Mọi phép kiểm gián tiếp đều có thể nói "ổn" trong khi màn hình trống trơn, nên sau mỗi lần mở
đồng app **đếm điểm ảnh sáng trên canvas**. Dưới 400 thì tự đo lại khung và kéo khung nhìn về
một lần; vẫn rỗng thì hiện bảng chẩn đoán ghi số nến, thang giá, kích thước khung thật và khung
bị ép, kích thước màn, khoảng đang nhìn, số điểm sáng. Chụp bảng đó là đủ để biết hỏng ở đâu.

`autoSize` của thư viện đã bị bỏ: nó đo khung qua ResizeObserver, chạy lệch nhịp với lúc mở màn
biểu đồ. Giờ tự đo, tự đặt kích thước, và ép một chiều cao dùng được nếu khung đo ra quá thấp.

## Lỗi thứ tư — chính là lỗi người dùng gặp: thang giá bị khoá

Người dùng chụp bảng chẩn đoán gửi về, trong đó có `nhìn -242…300 · sáng 0` và thang giá hiện
**5.500–8.000** trong khi NEAR chỉ chạy **2.547–3.556**. Nến nằm ngoài màn hình theo **chiều dọc**.

Nguyên nhân: `handleScroll.vertTouchDrag` đang bật. Mỗi cú vuốt dọc đều kéo thang giá, mà kéo
thang giá thì thư viện **tắt luôn tự co giãn** và giữ nguyên khoảng giá đó. Trên điện thoại không
ai vuốt ngang tuyệt đối, nên chỉ vài thao tác là thang giá khoá ở khoảng của đồng cũ. Sang đồng
có giá khác hẳn là trống trơn.

Vì sao ba lần trước không bắt được: `coNen()` chỉ xét **chiều ngang**, nên nó vẫn báo "ổn" trong
khi màn hình trống. Bài kiểm cũng chỉ kéo ngang bằng toạ độ chính xác, không bao giờ kéo lệch dọc.

Sửa:

- `vertTouchDrag: false` — vuốt dọc không còn kéo thang giá.
- Bật lại `autoScale: true` ở ba chỗ: lúc dựng, mỗi lần nạp nến, và trong `fit()`.
- `coNen()` xét **cả hai chiều**: lấy khoảng giá của phần nến đang trong tầm nhìn rồi xem nó có
  rơi vào vùng vẽ được không.
- Thêm bộ canh chừng chạy mỗi 1,5 giây. Thư viện chỉ báo khi khung nhìn đổi theo chiều ngang;
  thang giá trôi thì không có sự kiện nào, nên phải tự hỏi.
