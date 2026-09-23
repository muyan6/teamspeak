@echo off
chcp 65001 >nul
echo ==========================================
echo 正在更新 TS3 Monitor (Windows)...
echo ==========================================

if exist ".git" (
  echo [1/3] 获取 Git 最新代码...
  git pull
)

echo.
echo [2/3] 构建后端 (Backend)...
cd backend
call npm install
call npm run build

echo.
echo [3/3] 构建前端 (Frontend)...
cd ..\frontend
call npm install
call npm run build

cd ..
echo.
echo ==========================================
echo TS3 Monitor 更新完成！
echo 请重启后端服务以应用更新。
echo ==========================================
pause