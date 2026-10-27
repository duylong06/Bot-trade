#!/usr/bin/env bash
# Đẩy thư mục out/ lên nhánh "data" (app đọc tín hiệu, trạng thái, top 67 từ đây).
set -u
cd "${1:-out}"
rm -rf .git
git init -q -b data
git add -A
git -c user.name="bot-trade" -c user.email="bot-trade@users.noreply.github.com" \
  commit -qm "data $(date -u +%Y-%m-%dT%H:%M:%SZ)" || true
for i in 1 2 3; do
  git push -qf "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" data && exit 0
  sleep 3
done
exit 1
