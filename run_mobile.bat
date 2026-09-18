@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_mobile.ps1"
exit /b %errorlevel%
