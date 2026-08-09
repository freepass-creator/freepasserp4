@echo off
REM Daily RTDB backup (called by Task Scheduler).
REM Keep this file ASCII only - Korean comments break cmd.exe under the OEM codepage.
REM Log goes to D so the repo stays clean.
cd /d C:\dev\freepasserp4
call npm run backup:export >> D:\backup\freepasserp4-rtdb\_daily.log 2>&1
