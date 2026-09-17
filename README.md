# AccessNav Flutter

AccessNav 웹 UI와 API를 Flutter WebView에 연결한 Android 모바일 프로젝트입니다.

## 모바일 실행

Flutter, Node.js, Android SDK를 설치하고 `web_backend/.env`를 설정합니다.
USB 디버깅을 허용한 Android 기기를 연결한 후 프로젝트 폴더에서 실행합니다.

```powershell
.\run_mobile.bat
```

실행 스크립트는 의존성을 확인하고 백엔드를 시작한 뒤 ADB 포트 연결과 Flutter 실행을 수행합니다.
여러 기기가 연결되어 있으면 `ACCESSNAV_DEVICE_ID` 환경 변수로 기기를 선택합니다.
기존 3000번 포트 프로세스를 강제 종료하지 않습니다.

## PC 브라우저 실행

```powershell
cd web_backend
node server.js
```

http://localhost:3000 에 접속합니다. Flutter Chrome 미리보기도 지원합니다.
DB와 MapService 관련 기능에는 해당 서비스도 실행되어 있어야 합니다.

`.env`, 계정 데이터, 인증서와 개인 키는 Git에 추가하지 마세요.

## Chrome에서 모바일 디자인 작업

터미널 1: `cd web_backend` → `npm ci` → `node server.js`

터미널 2 (프로젝트 루트): `flutter pub get` → `flutter run -d chrome --web-port 5100`

VS Code에서는 Chrome 모바일 디자인 실행 구성을 선택해 F5를 누르세요.

375/390/430px 폭으로 HTML 화면을 미리 볼 수 있습니다. 수정할 파일은 web_backend/index.html, style.css, script.js입니다. 저장 후 미리보기 상단 새로고침 버튼을 누르세요. assets/web 사본은 이 미리보기의 소스가 아닙니다.

백엔드 주소 변경: `flutter run -d chrome --web-port 5100 --dart-define=ACCESSNAV_WEB_URL=http://localhost:3000/index.html?app=1`

지도/API 키와 DB는 web_backend/.env에 설정하세요. 기존 3000 서버가 다른 프로젝트라면 그 서버를 정리한 후 이 프로젝트의 백엔드를 실행해야 합니다. 브라우저 미리보기는 iOS 네이티브 앱 테스트를 대체하지 않습니다. 실제 iPhone 앱 빌드는 macOS/Xcode 및 iOS 프로젝트 설정이 별도로 필요합니다. Google OAuth가 iframe을 제한하면 웹 화면을 직접 열어 로그인하세요.
