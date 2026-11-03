@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20 or newer, then try again.
  pause
  exit /b 1
)

node -e "require('express'); require('better-sqlite3')" >nul 2>nul
if errorlevel 1 (
  echo Installing MediCore dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

start "MediCore Server" /min cmd /c "node server.js"
powershell -NoProfile -Command "$deadline = (Get-Date).AddSeconds(30); $ready = $false; while ((Get-Date) -lt $deadline) { try { Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/api/status' -TimeoutSec 2 | Out-Null; $ready = $true; break } catch { Start-Sleep -Milliseconds 500 } }; if ($ready) { Start-Process 'http://localhost:3000' } else { exit 1 }"
if errorlevel 1 (
  echo MediCore did not start. Check the MediCore Server window for details.
  pause
  exit /b 1
)
echo MediCore is running. Close the minimized MediCore Server window to stop it.
pause
