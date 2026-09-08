# AccessNav Web Backend

## 설정

`.env.example`을 `.env`로 복사한 뒤 실제 API 키와 DB 정보를 입력합니다.
`.env`는 Git에서 제외되며 절대 커밋하지 않습니다.

```powershell
npm ci
node server.js
```

Docker를 사용할 때는 `run.bat`이 로컬 `.env`를 컨테이너 실행 시 전달합니다.
