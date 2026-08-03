@echo off
setlocal

if /I "%~1"=="stdout-stderr" (
  <nul set /p =stdout:%~2
  >&2 <nul set /p =stderr:%~3
  exit /b 0
)

exit /b 64
