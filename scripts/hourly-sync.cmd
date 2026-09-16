@echo off
chcp 65001 >nul
cd /d C:\dev\freepasserp4
set NODE_NO_WARNINGS=1
echo. >> tmp\hourly-sync-console.txt
echo ===== %date% %time% ===== >> tmp\hourly-sync-console.txt
REM ★★erp3 자동동기 «중지»(사장님 2026-09-11 「erp3 끄고 폐기」) — SSOT가 erp5(freepasserp5)로 이관됨.
REM   이 .cmd 가 매시간 erp3 데이터로 판매시트를 덮어써 erp5 발행과 충돌(대여료·보증금·대수 「안맞다」의 정체)이라 «발행을 멈춘다».
REM   되살리려면(erp3로 되돌리려면) 이 REM 블록을 지우고 아래 원래 줄을 살린다:
REM     call npx tsx scripts/hourly-sync.mts --apply >> tmp\hourly-sync-console.txt 2>&1
REM   앞으로: 자동화를 erp5 워크트리(C:\dev\freepasserp4-rtdb-current)의 발행체인으로 옮겨 단다.
echo [중지] erp3 자동동기 폐기 — erp5 로 이관. 발행 안 함. >> tmp\hourly-sync-console.txt
exit /b 0
