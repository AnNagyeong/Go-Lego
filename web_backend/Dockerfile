# Node 환경
FROM node:20

# 작업 폴더
WORKDIR /app

# 패키지 먼저 복사 (캐시 최적화)
COPY package*.json ./

# 의존성 설치
RUN npm install

# 전체 파일 복사
COPY . .

# 포트 (server.js에서 쓰는 포트로 맞춰)
EXPOSE 3000

# 서버 실행
CMD ["node", "server.js"]
