@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo   WeChat DevTools - Manus MCP Bridge
echo ========================================
echo.

if not exist "%~dp0wechat-devtools-bridge\start-bridge.ps1" (
  echo ERROR: start-bridge.ps1 was not found.
  echo Expected: %~dp0wechat-devtools-bridge\start-bridge.ps1
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0wechat-devtools-bridge\start-bridge.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo Bridge startup failed with exit code %EXIT_CODE%.
  echo Check logs under:
  echo   %~dp0wechat-devtools-bridge\.runtime
  pause
  exit /b %EXIT_CODE%
)

echo Bridge startup succeeded.
echo Send this file to Manus:
echo   %~dp0wechat-devtools-bridge\.runtime\manus-connection.txt
echo.
pause
