@echo off
REM Spyro Studio launcher (Windows).
setlocal
set "DIR=%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Spyro Studio: Node.js 18+ is required and was not found.
  echo   Install it from https://nodejs.org/ and re-run this file.
  pause
  exit /b 1
)

node "%DIR%launcher\launcher.js" %*
endlocal
