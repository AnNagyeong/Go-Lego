@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "GRADLE_USER_HOME=%USERPROFILE%\.gradle"
set "ANDROID_USER_HOME=%USERPROFILE%\.android"

where flutter >nul 2>&1
if errorlevel 1 (
  echo [AccessNav] Flutter was not found in PATH.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo [AccessNav] Node.js was not found in PATH.
  pause
  exit /b 1
)

if not exist "web_backend\.env" (
  echo [AccessNav] web_backend\.env is missing.
  echo Copy .env.example to .env and enter your private configuration values.
  pause
  exit /b 1
)

if not exist "web_backend\node_modules" (
  pushd "web_backend"
  call npm ci
  if errorlevel 1 (
    popd
    pause
    exit /b 1
  )
  popd
)

call flutter pub get
if errorlevel 1 (
  pause
  exit /b 1
)

set "ADB_EXE=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
if not exist "%ADB_EXE%" (
  for /f "delims=" %%A in ('where adb 2^>nul') do if not defined ADB_FOUND set "ADB_FOUND=%%A"
  set "ADB_EXE=!ADB_FOUND!"
)
if not defined ADB_EXE (
  echo [AccessNav] adb was not found. Install Android SDK Platform Tools.
  pause
  exit /b 1
)

set "DEVICE_ID=%ACCESSNAV_DEVICE_ID%"
if not defined DEVICE_ID (
  set "DEVICE_LIST_FILE=%TEMP%\accessnav-adb-devices-%RANDOM%.txt"
  "%ADB_EXE%" devices > "%DEVICE_LIST_FILE%"
  for /f "usebackq skip=1 tokens=1,2" %%A in ("%DEVICE_LIST_FILE%") do if "%%B"=="device" if not defined DEVICE_ID set "DEVICE_ID=%%A"
  del /q "%DEVICE_LIST_FILE%" >nul 2>&1
)
if not defined DEVICE_ID (
  echo [AccessNav] No authorized Android device was found.
  echo Connect a device, enable USB debugging, and approve this computer.
  pause
  exit /b 1
)

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do taskkill /PID %%P /F >nul 2>&1
start "AccessNav Backend" /min cmd /c "cd /d ""%~dp0web_backend"" && node server.js"
timeout /t 2 /nobreak >nul

powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing 'http://localhost:3000/index.html' -TimeoutSec 5; if ($r.Content -notmatch '20260908-gps-simulator') { exit 1 } } catch { exit 1 }"
if errorlevel 1 (
  echo [AccessNav] The backend could not be started on port 3000.
  pause
  exit /b 1
)

"%ADB_EXE%" -s "%DEVICE_ID%" reverse tcp:3000 tcp:3000
if errorlevel 1 (
  echo [AccessNav] USB debugging connection failed for %DEVICE_ID%.
  pause
  exit /b 1
)

call flutter run -d "%DEVICE_ID%"
endlocal
