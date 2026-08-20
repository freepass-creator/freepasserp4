@echo off
chcp 65001 >nul
cd /d C:\dev\freepasserp4
set NODE_NO_WARNINGS=1
echo. >> tmp\hourly-sync-console.txt
echo ===== %date% %time% ===== >> tmp\hourly-sync-console.txt
call npx tsx scripts/hourly-sync.mts --apply >> tmp\hourly-sync-console.txt 2>&1
exit /b %errorlevel%
