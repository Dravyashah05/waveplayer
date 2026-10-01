@echo off
REM Wave Player - start backend (8001) + frontend (3001)
REM Double-click this file, or run: dev-all.bat
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH. Install Node 24+ first.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [INFO] node_modules missing, running npm install...
  call npm install
)

echo Starting YTMusic API on http://localhost:8001 ...
start "wave-player-api-8001" cmd /k "npx tsx server/ytmusic.ts"

REM Give backend time to init so Vite proxy doesn't ECONNREFUSED on first load
timeout /t 3 /nobreak >nul

echo Starting Vite on http://localhost:3001 ...
start "wave-player-vite-3001" cmd /k "npx vite --port=3001 --host=0.0.0.0"

echo.
echo Both servers launched. Keep both windows open.
echo  - API: http://localhost:8001/api/ytmusic/health
echo  - App: http://localhost:3001
pause
