@echo off
chcp 65001 >nul

echo [RETIRED] freepasserp4 hourly sync is now owned by GitHub Actions.
echo This local scheduler entry intentionally does not write Sheets or ERP.
echo Use .github\workflows\sales-erp-hourly.yml or manual workflow_dispatch instead.

exit /b 0
