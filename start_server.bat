@echo off
set "SERVER_PORT=%PORT%"
if "%SERVER_PORT%"=="" set "SERVER_PORT=8001"
set "APP_URL=http://localhost:%SERVER_PORT%/?devBackend=local"

echo Starting Local Web Server...
echo.
echo This window must stay open for the website to work.
echo To stop the server, close this window.
echo.
if "%NO_AUTO_OPEN%"=="1" (
echo Browser auto-open skipped [NO_AUTO_OPEN=1].
) else (
echo Opening %APP_URL% in your browser...
start "" "%APP_URL%"
)
node scripts/project-api-server.mjs
pause
