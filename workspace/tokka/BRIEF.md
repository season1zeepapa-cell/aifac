# Brief: TOKKA - 카카오톡 스타일 채팅앱 MVP

> 핑크 테마의 카카오톡 스타일 실시간 채팅 웹앱 (1:1 + 그룹 채팅)

## Requirements
- [ ] 1. 이메일+비밀번호 회원가입/로그인 (bcrypt 해싱 + JWT 토큰 인증)
- [ ] 2. 친구 목록 탭 — 가입 유저 검색, 친구 추가/삭제/차단
- [ ] 3. 채팅 목록 탭 — 참여 중인 채팅방 목록, 최근 메시지 미리보기
- [ ] 4. 채팅방 — 1:1 및 그룹 채팅, Supabase Realtime(WebSocket) 실시간 메시지
- [ ] 5. 하단 탭 네비게이션 — 친구 / 채팅 / 설정(프로필)
- [ ] 6. 프로필 상세 — 프로필 사진, 상태 메시지 수정
- [ ] 7. 부가 기능 — 친구 차단/삭제, 채팅방 나가기
- [ ] 8. 반응형 모바일 우선 디자인, 데스크톱 호환

## Constraints
- 프론트엔드: CDN React + Tailwind (단일 index.html) — `react-single-file-dev` agent
- 백엔드: Express.js (server.js) — `server-specialist` agent
- DB: Supabase (PostgreSQL + Realtime WebSocket)
- 인증: 자체 구현 (Supabase Auth 미사용)
- 환경변수: `.env` 파일로 키 관리
- 핑크 색상 테마, 카카오톡 스타일 UI

## Non-goals
- 음성/영상 통화
- 파일 전송 (이미지 외)
- 푸시 알림
- 네이티브 모바일 앱 (웹앱만)

## Style
- 핑크 테마 (카카오톡의 노란색 → 핑크로 대체)
- 말풍선 UI, 하단 탭 바, 둥근 프로필 아바타
- 모바일 앱 느낌의 반응형 웹

## Key Concepts
- **Supabase Realtime**: DB 변경을 WebSocket으로 즉시 클라이언트에 전달하는 기능
- **JWT**: 로그인 후 서버가 발급하는 인증 토큰, 매 요청마다 본인 확인용
- **bcrypt**: 비밀번호를 안전하게 암호화하는 해싱 알고리즘

## Tech Stack
- **Frontend**: CDN React 18 + Tailwind CSS (단일 index.html)
- **Backend**: Node.js + Express.js (server.js)
- **Database**: Supabase PostgreSQL + Realtime (WebSocket)
- **Auth**: bcrypt + JWT (자체 구현)

## Supabase Config
- Project URL: `https://amhcwpehfuzuckuicaeb.supabase.co`
- 키 관리: `.env` 파일 사용
