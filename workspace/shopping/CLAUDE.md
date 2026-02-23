# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

KICKS — 아디다스 스타일의 신발 전문 쇼핑몰. CDN React 단일 HTML + Express 서버리스 백엔드 구조.

## 실행 명령어

```bash
npm install              # 의존성 설치
node setup-db.js         # DB 테이블 생성 + 시드 데이터 (최초 1회)
npm start                # 서버 실행 (http://localhost:3000)
vercel --prod            # Vercel 프로덕션 배포
```

환경 변수: `.env` 파일에 `DATABASE_URL` 필요 (`.env.example` 참고)

## 아키텍처

**3파일 구조 (빌드 도구 없음):**
- `index.html` — 전체 프론트엔드 (React 18 CDN + Babel + Tailwind CSS CDN)
- `server.js` — Express 백엔드 + Supabase PostgreSQL 연결 + Vercel 서버리스 호환
- `setup-db.js` — DB 초기화 스크립트 (1회성)

**프론트엔드 라우팅:** App 컴포넌트의 `currentPage` state로 페이지 전환 (React Router 미사용). `authFetch()` 래퍼로 모든 API 호출 + 401 시 자동 로그아웃.

**백엔드 인증:** express-session 세션 기반. `/api/*` 경로에 인증 미들웨어 적용. 공개 경로: `/login`, `/signup`, `/payments/confirm`.

**결제:** 토스페이먼츠 SDK v2 위젯 (`test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm`). 결제 승인은 서버에서 처리 (`/api/payments/confirm`).

## DB 컨벤션

모든 테이블에 `shopping_` prefix 사용:
- `shopping_users`, `shopping_products`, `shopping_cart_items`, `shopping_orders`, `shopping_order_items`

SQL은 Parameterized Queries 필수 (`$1`, `$2`).

## 스타일 컨벤션

- 색상: 검정 배경 + 흰색 텍스트 (아디다스 스타일)
- 폰트: 제목 `Bebas Neue` / 본문 `Noto Sans KR`
- Tailwind 유틸리티 클래스만 사용 (커스텀 CSS 최소화)
- 반응형: 모바일 우선 (`md:`, `lg:`, `xl:` 브레이크포인트)

## API 경로

| 메서드 | 경로 | 설명 |
|-------|------|------|
| POST | `/api/signup` | 회원가입 |
| POST | `/api/login` | 로그인 |
| POST | `/api/logout` | 로그아웃 |
| GET | `/api/me` | 내 정보 |
| PUT | `/api/me/password` | 비밀번호 변경 |
| GET | `/api/products` | 상품 목록 |
| GET | `/api/products/:id` | 상품 상세 |
| GET/POST/PUT/DELETE | `/api/cart` | 장바구니 CRUD |
| GET/POST | `/api/orders` | 주문 목록/생성 |
| POST | `/api/payments/confirm` | 결제 승인 |

## 배포

Vercel 서버리스 배포. `vercel.json`에서 모든 경로를 `server.js`로 라우팅. `server.js`는 `process.env.VERCEL` 존재 시 `app.listen()` 생략 + `module.exports = app` 처리.

## 주의사항

- 비밀번호 평문 저장 (테스트용, 프로덕션 시 bcrypt 필요)
- 세션 메모리 스토어 (서버리스 환경에서 세션 유지 불가 — JWT 또는 Redis 필요)
- 포트 3000 충돌 시: `lsof -ti:3000 | xargs kill -9` 후 재시작
