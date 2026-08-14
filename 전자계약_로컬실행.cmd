@echo off
chcp 65001 > nul
title 프리패스 전자계약 로컬 실행
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-esign-local.ps1"
if errorlevel 1 (
  echo.
  echo 전자계약 서버를 시작하지 못했습니다. 위 오류 내용을 확인해 주세요.
  pause
)
