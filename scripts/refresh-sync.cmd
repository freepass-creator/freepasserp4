@echo off
chcp 65001 >nul
cd /d C:\dev\freepasserp4
set NODE_NO_WARNINGS=1
echo. >> tmp\refresh-sync-console.txt
echo ===== %date% %time% ===== >> tmp\refresh-sync-console.txt
call npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/refresh-sync.mts --apply >> tmp\refresh-sync-console.txt 2>&1
exit /b %errorlevel%
