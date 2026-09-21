@echo off
cd /d "%~dp0"
git add .
git commit -m "Update Zoptavi Tab %date% %time%"
git push origin main
echo ========================================
echo   Done. Press any key to close.
echo ========================================
pause >nul
