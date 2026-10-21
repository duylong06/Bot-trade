// core/config.js — cấu hình chung cho bot và app. Sửa ở đây là cả hai cùng đổi.

export const REPO = 'duylong06/Bot-trade';
export const PAGES_URL = 'https://duylong06.github.io/Bot-trade/';

// Số đồng theo dõi: top N hợp đồng USDT-SWAP trên OKX có khối lượng 24h lớn nhất, cập nhật mỗi lần quét.
export const TOP_N = 50;

// Loại thông báo được gửi. Xoá loại nào khỏi danh sách là bot thôi báo loại đó.
//   BREAK   — nến H1 đóng cửa phá đường (báo sớm)
//   CONFIRM — đóng cửa vượt đỉnh/đáy cuối nằm trên đường (gãy cấu trúc, báo chắc)
//   RETEST  — giá quay về chạm lại đường vừa phá và giữ được
export const ALERTS = ['BREAK', 'CONFIRM', 'RETEST'];

// Chỉ gửi thông báo cho mô hình dài từ bấy nhiêu nến H1 trở lên (0 = mọi cỡ, kể cả mô hình nhỏ).
// App vẫn vẽ mọi đường; số này chỉ lọc thông báo đẩy về điện thoại.
export const MIN_SPAN_ALERT = 0;

// Ghi đè ngưỡng trong core/breakout.js (CFG). Ví dụ: { MIN_SPAN: 20, BUF: 0.6 }
export const TUNE = {};

// Loại tài sản (trường instCategory của OKX): '1' crypto · '3' cổ phiếu · '4' hàng hoá (vàng, bạc, dầu…).
// Mặc định chỉ crypto. Muốn thêm vàng/dầu thì đổi thành ['1', '4'].
export const CATEGORIES = ['1'];

// Không theo dõi các đồng ổn định giá.
export const EXCLUDE = ['USDC', 'FDUSD', 'DAI', 'TUSD', 'USDE', 'PYUSD', 'USDG', 'USD1'];

// Bot ghi tín hiệu và trạng thái vào nhánh "data" của repo; app đọc từ đây.
export const DATA_RAW = `https://raw.githubusercontent.com/${REPO}/data/`;
export const DATA_API = `https://api.github.com/repos/${REPO}/contents/`;
