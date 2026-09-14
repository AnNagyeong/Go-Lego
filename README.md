# AccessNav Flutter

AccessNav 웹 UI와 API를 Flutter WebView에 연결한 Android 모바일 프로젝트입니다.

## 새 환경 설정

1. Flutter, Android SDK Platform Tools, Node.js를 설치합니다.
2. `web_backend/.env.example`을 `web_backend/.env`로 복사합니다.
3. `.env`에 개인 API 키, DB 접속 정보, MapService 경로를 입력합니다.
4. MySQL과 MapService 서버를 실행합니다.
5. USB 디버깅을 허용한 Android 기기를 연결합니다.


## 모바일 실행

프로젝트 루트에서 다음 파일을 실행합니다.

```powershell
.\run_mobile.bat
```

스크립트는 다음 작업을 자동으로 수행합니다.

- 현재 프로젝트 폴더 사용
- Node 및 Flutter 의존성 설치·확인
- 연결된 USB Android 기기 자동 선택
- 백엔드 실행 및 ADB 포트 연결
- Flutter 디버그 앱 실행

기기가 여러 대라면 실행 전에 `ACCESSNAV_DEVICE_ID`를 지정할 수 있습니다.

```powershell
$env:ACCESSNAV_DEVICE_ID="adb-device-id"
.\run_mobile.bat
```

## 주요 기능

- 카카오 지도와 장소 검색
- Google 장소 사진 및 Google 로그인
- 현재 위치, 방향 센서, GPS 신뢰성 검사
- 출입구·경로 스냅 및 개발용 경로 시뮬레이션
- 이동 유형별 DB POI·그래프 경로와 ORS 보완 경로
- 위험 구간 제보, 사진 촬영·앨범 첨부, 즐겨찾기와 마이페이지
