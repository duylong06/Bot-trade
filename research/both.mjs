// Lấy nến/OI/funding rồi ghi sổ lệnh một lượt, cho cùng một đồng.
import { execSync } from 'node:child_process';
execSync('node research/uni.mjs', { stdio: 'inherit' });
execSync('node research/book.mjs', { stdio: 'inherit', env: { ...process.env, SECS: '170', STEP: '1200' } });
