#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "?? 开始更新 TS3 Monitor..."
echo "=========================================="

if [ -d ".git" ]; then
  echo "?? [1/3] 正在拉取 Git 最新代码..."
  git pull || {
    echo "?? Git 拉取遇到冲突或错误，继续使用当前文件构建..."
  }
fi

echo ""
echo "?? [2/3] 编译后端 (Backend)..."
cd "$SCRIPT_DIR/backend"
if [ -f "package-lock.json" ]; then
  npm ci || npm install
else
  npm install
fi
npm run build

echo ""
echo "?? [3/3] 编译前端 (Frontend)..."
cd "$SCRIPT_DIR/frontend"
if [ -f "package-lock.json" ]; then
  npm ci || npm install
else
  npm install
fi
npm run build

echo ""
echo "?? 重启服务..."
cd "$SCRIPT_DIR/backend"
if command -v pm2 &> /dev/null; then
  if pm2 describe ts3-monitor &> /dev/null; then
    pm2 restart ts3-monitor
    echo "? PM2 进程 (ts3-monitor) 已成功重启！"
  else
    pm2 restart all
    echo "? PM2 进程已重启！"
  fi
else
  echo "?? 未检测到全局 PM2，如果使用 systemd 或 screen 请重启对应服务。"
fi

echo ""
echo "=========================================="
echo "?? TS3 Monitor 更新构建完成！"
echo "=========================================="