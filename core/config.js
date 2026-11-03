// core/config.js — cấu hình chung cho bot và app. Sửa ở đây là cả hai cùng đổi.

export const REPO = 'duylong06/Bot-trade';
export const PAGES_URL = 'https://duylong06.github.io/Bot-trade/';

// Số đồng theo dõi: top N đồng theo VỐN HOÁ THỊ TRƯỜNG (CoinGecko, cập nhật mỗi lần quét).
// Đồng nào không có hợp đồng USDT vĩnh cửu trên OKX (hoặc là stablecoin, token bọc) thì lấy đồng kế tiếp.
export const TOP_N = 67;

// Cộng thêm top N đồng có KHỐI LƯỢNG GIAO DỊCH 24h lớn nhất trên OKX (hợp đồng USDT vĩnh cửu), gộp với danh sách
// vốn hoá ở trên (đồng nào đã có thì không tính lại).
export const TOP_VOL = 36;

// Luôn theo dõi thêm các mã này, ngoài top N: vàng, dầu WTI.
// Thêm 'BZ-USDT-SWAP' (dầu Brent) hoặc 'XAG-USDT-SWAP' (bạc) nếu muốn.
export const PINNED = ['XAU-USDT-SWAP', 'CL-USDT-SWAP'];

// Tên tiếng Việt hiện trong app và thông báo.
export const NAMES = { XAU: 'Vàng', XAG: 'Bạc', CL: 'Dầu WTI', BZ: 'Dầu Brent' };

// Loại thông báo được gửi. Xoá loại nào khỏi danh sách là bot thôi báo loại đó.
//   BREAK   — nến H1 đóng cửa phá đường (báo sớm)
//   CONFIRM — đóng cửa vượt đỉnh/đáy cuối nằm trên đường (gãy cấu trúc, báo chắc)
//   RETEST  — giá quay về chạm lại đường vừa phá và giữ được
export const ALERTS = ['BREAK', 'CONFIRM', 'RETEST'];

// Chỉ gửi thông báo cho mô hình dài từ bấy nhiêu nến H1 trở lên (0 = mọi cỡ, kể cả mô hình nhỏ).
// App vẫn vẽ mọi đường; số này chỉ lọc thông báo đẩy về điện thoại.
export const MIN_SPAN_ALERT = 0;

// Ghi đè ngưỡng trong core/breakout.js (CFG). Ví dụ: { MIN_SPAN: 20, LEFT: 0.4 }
export const TUNE = {};

// Luật trendline riêng từng khung (theo prompt V8.0, mục 5.1):
//   MAX_PATTERN  tổng chiều dài đường (từ điểm neo đầu tới cây phá / tới hiện tại) tối đa — quá thì đường hết hạn
//   MIN_SPAN     hai điểm neo cách nhau tối thiểu
//   MIN_TOUCH 2  đường hai điểm neo là đường hợp lệ (đủ 3 chạm thì được cộng điểm cấu trúc)
//   ANCHOR_GAP 0 điểm neo thứ hai chỉ cần cách điểm neo đầu MIN_SPAN nến
//   WICK_SLOPE   thử cả đường nối đầu râu ↔ đầu râu (kẻ chạm râu, không cắt thân)
// Mô hình vẫn dài tối thiểu MIN_PATTERN = 45 nến như cũ.
export const TF_RULES = {
  '30m': { MAX_PATTERN: 60, MIN_SPAN: 5, MIN_TOUCH: 2, ANCHOR_GAP: 0, WICK_SLOPE: true },
  '1H': { MAX_PATTERN: 96, MIN_SPAN: 6, MIN_TOUCH: 2, ANCHOR_GAP: 0, WICK_SLOPE: true },
  '4H': { MAX_PATTERN: 120, MIN_SPAN: 8, MIN_TOUCH: 2, ANCHOR_GAP: 0, WICK_SLOPE: true },
};

// Loại tài sản được xếp hạng vào top N (trường instCategory của OKX): '1' crypto · '3' cổ phiếu · '4' hàng hoá.
// Vàng, dầu không cần xếp hạng vì đã nằm trong PINNED.
export const CATEGORIES = ['1'];

// Không theo dõi các đồng ổn định giá.
export const EXCLUDE = ['USDC', 'FDUSD', 'DAI', 'TUSD', 'USDE', 'PYUSD', 'USDG', 'USD1'];

// App gửi đăng ký thông báo cho bot qua kênh ntfy.sh này (không cần dán mã vào GitHub mỗi lần đăng ký lại).
// Đăng ký thông báo không phải bí mật: chỉ bot (có khoá riêng trong GitHub Secret) mới gửi được tới máy.
export const NTFY = 'https://ntfy.sh/bottrade-duylong06-7f3k9q2m';

// Bot ghi tín hiệu và trạng thái vào nhánh "data" của repo; app đọc từ đây.
export const DATA_RAW = `https://raw.githubusercontent.com/${REPO}/data/`;
export const DATA_API = `https://api.github.com/repos/${REPO}/contents/`;
