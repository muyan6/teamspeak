@echo off
chcp 65001 >nul
echo ==========================================
echo ?? 开始更新 TS3 Monitor (Windows)...
echo ==========================================

if exist ".git" (
  echo ?? [1/3] 正在拉取 Git 最新代码...
  git pull
)

echo.
echo ?? [2/3] 编译后端 (Backend)...
cd backend
call npm install
call npm run build

echo.
echo ?? [3/3] 编译前端 (Frontend)...
cd ..\frontend
call npm install
call npm run build

cd ..
echo.
echo ==========================================
echo ?? TS3 Monitor 编译更新完成！
echo 提示：请重启您的后端服务进程以应用更新。
echo ==========================================
pause