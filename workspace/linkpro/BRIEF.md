# Brief: LinkPro - Linktree 클론 MVP

> Linktree 스타일의 링크 공유 서비스 MVP. 회원은 프로필과 링크를 관리하고, 누구나 공개 페이지를 조회할 수 있다.

## Requirements
- [ ] 1. 이메일+비밀번호 회원가입/로그인 (bcrypt + JWT)
- [ ] 2. 프로필 섹션: 프로필 이미지(URL), 닉네임, 자기소개 편집
- [ ] 3. 링크 CRUD: 추가, 수정, 삭제, 순서 변경
- [ ] 4. 프리셋 테마 5~6개 중 선택 가능
- [ ] 5. 공개 페이지: `/username` 경로로 비로그인 사용자도 조회 가능
- [ ] 6. 페이지 공유: URL 복사 버튼 + SNS 공유 링크
- [ ] 7. 푸터: "Powered by LinkPro" 등 브랜딩
- [ ] 8. 반응형 디자인 (모바일/태블릿/데스크탑)

## Constraints
- MVP 범위만 구현
- 단일 index.html + server.js + vercel.json 구조
- Supabase DB (connection string은 .env로 관리, 하드코딩 금지)
- 모든 테이블에 `linkpro_` 접두사 사용
- 에이전트 활용: react-single-file-dev, server-specialist, vercel-deploy-optimizer

## Non-goals
- 소셜 로그인 (Google, GitHub 등)
- 애널리틱스/클릭 통계
- 커스텀 도메인 연결
- 사용자 간 팔로우/소셜 기능
- 이미지 파일 직접 업로드 (URL 입력만 지원)

## Style
- Linktree와 유사한 깔끔한 UI
- 프리셋 테마로 다양한 비주얼 제공
- 한국어 UI 기본

## Key Concepts
- **공개 페이지**: `/username`으로 접근하는 비로그인 조회 페이지
- **관리 페이지**: 로그인 후 프로필/링크를 편집하는 대시보드
- **프리셋 테마**: 미리 정의된 색상/배경 조합 세트
- **linkpro_ 접두사**: DB 테이블 충돌 방지를 위한 네이밍 규칙

## DB Tables
- `linkpro_users`: id, email, password_hash, username, created_at
- `linkpro_profiles`: id, user_id, display_name, bio, avatar_url, theme
- `linkpro_links`: id, user_id, title, url, sort_order, is_active, created_at
