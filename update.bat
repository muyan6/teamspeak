@echo off
chcp 65001 >nul
setlocal
echo ==========================================
echo 正在更新 TS3 Monitor (Windows)...
echo ==========================================

if exist ".git" (
  echo [1/4] 获取 Git 最新代码...
  git pull
)

echo.
echo [2/4] 构建后端 (Backend)...
cd backend
rem 与 update.sh 保持一致：有 lockfile 时用 npm ci 保证可复现安装。
if exist "package-lock.json" (
  call npm ci
) else (
  call npm install
)
call npm run build

echo.
echo [3/4] 构建前端 (Frontend)...
cd ..\frontend
if exist "package-lock.json" (
  call npm ci
) else (
  call npm install
)
call npm run build

cd ..
echo.
echo [4/4] 尝试重启 PM2 进程 ts3-monitor...
where pm2 >nul 2>nul
if errorlevel 1 (
  echo 警告: 未安装 PM2，请手动重启后端服务。
) else (
  call pm2 describe ts3-monitor >nul 2>nul
  if errorlevel 1 (
    echo 警告: 未找到 PM2 进程 ts3-monitor，请手动启动后端服务。
  ) else (
    call pm2 restart ts3-monitor --update-env
  )
)

echo.
echo ==========================================
echo TS3 Monitor 更新完成！
echo ==========================================
pause