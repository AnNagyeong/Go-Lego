@echo off
echo ================================
echo   AccessNav 실행 중...
echo ================================

docker build -t accessnav .
docker run --env-file .env -p 3000:3000 accessnav

pause
