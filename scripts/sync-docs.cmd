@echo off
chcp 65001 >nul
cd /d C:\dev\freepasserp4
set NODE_NO_WARNINGS=1
call node scripts/sync-docs.mjs
exit /b %errorlevel%
