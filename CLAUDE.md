# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Monorepo of small full-stack web apps under `workspace/`. Each app is independently deployable to Vercel.

## Project Structure

- **`workspace/error/`** - 영상정보관리사 오답노트 앱 (주력 프로젝트, Vercel 배포: error-liart.vercel.app)
  - SPA (`index.html`) + Express backend (`server.js`) + Vercel serverless functions (`api/`)
  - DB: Supabase PostgreSQL (`api/db.js` 커넥션 풀)
  - AI API 프록시: Gemini (`api/gemini.js`), OpenAI (`api/openai.js`) - SSE 스트리밍 지원
  - 인증: 하드코딩 계정 + HMAC JWT (`api/auth.js`, `api/login.js`, `api/signup.js`)
  - 문제 관리: `api/questions.js` (CRUD), `api/explanations.js` (해설), `api/memos.js` (메모), `api/memo-files.js` (첨부파일)
  - 문제 이미지: `qNNN.png` (q001~q230), pool 폴더로 신규 문제 임포트
  - 환경변수: `GEMINI_API_KEY`, `OPENAI_API_KEY`, `LAW_API_OC`, `DATABASE_URL`
- **`workspace/docstore/`** - PDF 텍스트 추출 & 문서 관리 시스템 (Vercel 배포)
  - SPA (`index.html`) + Express backend (`server.js`) + Vercel serverless functions (`api/`)
  - DB: Supabase PostgreSQL, 임베딩 기반 RAG 검색 (`api/rag.js`, `api/search.js`)
  - AI: Claude SDK (`@anthropic-ai/sdk`) + OpenAI 임베딩, OCR (`api/ocr.js`), 요약 (`api/summary.js`)
  - 문서 업로드: PDF/DOCX/CSV/XLSX 파싱 (`api/upload.js`, `api/url-import.js`)
  - 법령 조회: 국가법령정보 API 연동 (`api/law.js`, `api/law-import.js`, `api/law-graph.js`)
  - 교차 참조 매트릭스 (`api/cross-references.js`), 비식별화 (`api/deidentify.js`)
  - 환경변수: `DATABASE_URL`, `AUTH_TOKEN_SECRET`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `LAW_API_OC`
  - E2E 테스트: Playwright (`tests/`)
- **`workspace/linkpro/`** - 링크 관리 앱 (Node.js + Express)
- **`workspace/tokka/`** - Node.js + Express 앱 (DB setup: `npm run setup-db`)
- **`workspace/shopping/`** - 쇼핑 앱 (Node.js + Express, `setup-db.js`)
- **`workspace/todo_app_01/`** - Todo 앱 (Node.js + Express)
- **`workspace/recipe/`** - 레시피 콘텐츠 및 이미지 생성 스크립트 (Python)
- **`workspace/auditor/`** - 기획 단계 (BRIEF만 존재)

## Development Commands

각 앱 디렉토리 안에서 실행:
```bash
cd workspace/<app>
npm install
npm run dev        # nodemon 개발 서버 (linkpro, tokka, todo_app_01, error)
npm start          # node server.js
```

## Testing

```bash
# docstore E2E 테스트 (Playwright)
cd workspace/docstore && npx playwright test
```

## Deployment

- `workspace/error` 배포: `cd workspace/error && npx vercel --prod --yes`
- `workspace/docstore` 배포: `cd workspace/docstore && npx vercel --prod --yes`
- git push만으로는 하위 디렉토리 앱이 자동 배포되지 않음 (monorepo 구조)
- 각 앱에 `.vercel/project.json`이 개별 Vercel 프로젝트 연결

## Architecture Patterns

### 공통 앱 구조 (error, docstore)
- 로컬 개발: `server.js`에서 Express로 모든 API 라우트 마운트
- Vercel 배포: `api/*.js` 각 파일이 독립 서버리스 함수로 동작
- `vercel.json`에서 함수별 `maxDuration` 설정 (AI 프록시 300초 등)
- 프론트엔드: 단일 SPA (`index.html`), 빌드 도구 없음
- DB: Supabase PostgreSQL (`pg` 패키지 직접 사용)
- 인증: 하드코딩 계정 + JWT/HMAC 토큰

### DB 테이블 구조 (workspace/error)
- `questions` - 문제 (body, choices, answer, explanation, image_url)
- `exams` / `subjects` - 시험회차 / 과목 메타데이터
- `question_memos` - 문제별 메모 (question_id → questions.id)
- `memo_files` - 메모 첨부파일 (memo_id → question_memos.id, base64 데이터 저장)
- `question_explanations` - AI 해설 저장
- 마이그레이션 스크립트: `create-memos-table.js`, `create-memo-files-table.js`, `create-explanations-table.js`

### AI 해설 기능 (workspace/error)
- SSE 스트리밍 실패 시 일반 모드(`stream:false`) 자동 재시도 fallback
- AI 설정은 메모리에만 저장 (localStorage 미사용), 새로고침 시 `DEFAULT_SETTINGS`로 리셋
- `onModelChange(keepValues)` 패턴: 모달 열 때는 `true`(값 유지), 사용자 변경 시 `false`(기본값 리셋)

### UI 패턴
- `setSelectValue()` 헬퍼로 select 값 세팅 (`option.selected` 직접 지정 + `.value` 이중 세팅)
- 다크모드 기본 지원, 모바일 퍼스트 반응형
- 카드 지연 로드: 카드 펼칠 때만 메모/해설 API 호출 (성능 최적화)

## Commit Convention

Conventional Commit (한국어):
```
feat(error): DB 문제풀이 기능 추가
fix(linkpro): 토큰 바이패스 차단
```

커밋 시 `git_commit_writer_ko` 스킬 사용.

## Coding Style

- 2-space 인덴트, 세미콜론 사용
- 파일명: `server.js`, `setup-db.js`, `index.html`
- API 라우트: `/api/auth/login`, `/api/questions` 등 도메인별 그룹화
- 주석/문서/커밋 메시지: 한국어
- 변수명/함수명: 영어
