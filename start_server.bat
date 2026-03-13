@echo off
echo Starting Local Web Server...
echo.
echo This window must stay open for the website to work.
echo To stop the server, close this window.
echo.
if "%NO_AUTO_OPEN%"=="1" (
echo Browser auto-open skipped [NO_AUTO_OPEN=1].
) else (
echo Opening http://localhost:8001 in your browser...
start http://localhost:8001
)
node scripts/project-api-server.mjs
pause
