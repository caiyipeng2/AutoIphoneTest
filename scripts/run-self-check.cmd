@echo off
setlocal
set "ROOT=%~dp0.."
set "NODE=%ROOT%\tools\node\22.23.1\node.exe"

"%NODE%" "%ROOT%\node_modules\typescript\bin\tsc" --build "%ROOT%\tsconfig.json" --pretty false
if errorlevel 1 exit /b 10

"%NODE%" "%ROOT%\apps\server\dist\cli\self-check.js" %*
exit /b %errorlevel%
