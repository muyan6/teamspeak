@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0" || exit /b 1
echo ==========================================
echo 正在更新 TS3 Monitor (Windows)...
echo ==========================================

if exist ".git" (
  echo [1/4] 获取 Git 最新代码...
  git pull --ff-only
  if errorlevel 1 goto :failed
)

echo.
echo [2/4] 构建后端 (Backend)...
cd backend || goto :failed
rem 与 update.sh 保持一致：有 lockfile 时用 npm ci 保证可复现安装。
if exist "package-lock.json" (
  call npm ci
) else (
  call npm install
)
if errorlevel 1 goto :failed
call npm run build
if errorlevel 1 goto :failed

echo.
echo [3/4] 构建前端 (Frontend)...
cd ..\frontend || goto :failed
if exist "package-lock.json" (
  call npm ci
) else (
  call npm install
)
if errorlevel 1 goto :failed
call npm run build
if errorlevel 1 goto :failed

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
    if errorlevel 1 goto :failed
  )
)

echo.
echo ==========================================
echo TS3 Monitor 更新完成！
echo ==========================================
pause
exit /b 0

:failed
echo 更新失败：已停止后续构建和重启，请修正错误后重试。
exit /b 1
