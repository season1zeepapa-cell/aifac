# DocStore 프로젝트 점검 보고서 v5

> 작성일: 2026-03-15
> 대상: workspace/docstore (PDF 문서 관리 + 법령 지식 RAG 시스템)
> 참조: ANALYSIS4.md (2026-03-14)
> 주제: ① 현재 구현 상태 점검·평가 ② 인프라 대안 아키텍처 ③ SPA 구조 개선 제안

---

## 목차

1. [현재 구현 상태 점검](#1-현재-구현-상태-점검)
2. [발견된 기술 부채 및 리스크](#2-발견된-기술-부채-및-리스크)
3. [인프라 대안 아키텍처 제안](#3-인프라-대안-아키텍처-제안)
4. [SPA 구조 개선 제안](#4-spa-구조-개선-제안)
5. [통합 로드맵](#5-통합-로드맵)

---

## 1. 현재 구현 상태 점검

### 1.1 코드베이스 규모 (2026-03-15 기준)

| 구성 요소 | 파일 수 | 코드량 | 비고 |
|-----------|---------|--------|------|
| 프론트엔드 | 1개 (index.html) | **11,122 라인** | Babel standalone 런타임 컴파일 |
| API 서버리스 함수 | 35개 (api/*.js, *.py) | 5,441 라인 | Vercel Functions |
| 비즈니스 로직 라이브러리 | 37개 (lib/*.js) | 12,902 라인 | 공유 로직 |
| E2E 테스트 | Playwright | 126개 테스트 | 96% 통과율 |
| DB 테이블 | - | 26개 | Supabase PostgreSQL + pgvector |
| 총 소스 코드 | ~75개 | ~29,465 라인 | - |

### 1.2 핵심 기능 구현 완성도 평가

#### ✅ 잘 구현된 부분

| 기능 | 평가 | 근거 |
|------|------|------|
| **하이브리드 RAG 검색 파이프라인** | 업계 최상위 | 벡터(pgvector HNSW) + BM25 FTS + RRF + Cohere Rerank + MMR 5단계 |
| **StateGraph 9노드 RAG** | 완성도 높음 | toolRouter → verify → correctiveRewrite 자기교정 루프 완전 구현 |
| **멀티 임베딩 모델** | 실용적 | OpenAI/Upstage/Cohere 3종 + 차원 자동 마이그레이션 |
| **지식 그래프** | 실용적 | 순수 JS Louvain/Leiden + D3 시각화, 외부 의존 없음 |
| **Graceful Degradation** | 프로덕션 수준 | 임베딩 API 장애 시 FTS 폴백 + API 키 상태 Context 전파 |
| **멀티 LLM 지원** | 유연함 | Gemini/GPT/Claude 자동 전환 + 비용 추적 |
| **E2E 테스트** | 높은 커버리지 | 126개 Playwright 테스트, 6개 탭 전체 검증 |

#### ⚠️ 부분 구현 또는 한계가 있는 부분

| 기능 | 현황 | 한계 |
|------|------|------|
| **URL 라우팅** | `activeTab` 상태변수 기반 탭 전환 | 브라우저 뒤로/앞으로 불가, URL 공유 불가 |
| **SearchTab/ChatTab DOM 처리** | `display:none` 방식으로 항상 DOM에 존재 | 불필요한 메모리 상주, 이벤트 리스너 누적 |
| **멀티홉 검색** | 1→2홉 고정 | 동적 홉 결정 미구현 |
| **대화 요약 메모리** | 20메시지 슬라이딩 윈도우 | 긴 대화 시 초반 컨텍스트 손실 |
| **형태소 분석** | Python 스크립트(`tokenize-ko.py`) 별도 | Vercel 서버리스에서 실행 지연 가능성 |

#### ❌ 미구현 또는 구조적 문제

| 항목 | 문제 |
|------|------|
| **런타임 JSX 컴파일** | `@babel/standalone` CDN 로드 후 11,122라인을 브라우저에서 실시간 컴파일 |
| **코드 스플리팅 없음** | 전체 11,122라인이 첫 로드 시 한 번에 파싱·실행 |
| **외부 CDN 단일 의존** | unpkg.com, cdn.tailwindcss.com 등 — CDN 장애 시 앱 전체 불동작 |
| **DB 커넥션 풀 max:2** | 서버리스 환경 최소화 설정이나, 동시 요청 多 시 큐잉 지연 |
| **Plan-and-Execute 미구현** | 복합 질의("A법과 B법 비교해서 정리해줘") 처리 불가 |

---

## 2. 발견된 기술 부채 및 리스크

### 2.1 인프라 리스크

#### Vercel 서버리스 한계

```
현재 maxDuration 설정:
  api/upload.js      → 300초  ← Vercel 무료: 10초, Pro: 300초
  api/rag.js         → 120초  ← SSE 스트리밍 도중 연결 강제 종료 가능
  api/law-import.js  → 300초  ← 대용량 법령 임포트 시 타임아웃 위험
  api/summary.js     → 300초

리스크:
  - Pro 플랜 필수 (무료: 함수당 10초 제한)
  - 서버리스 콜드 스타트: 첫 요청 300~800ms 지연
  - 함수 메모리 상한: 1GB (Vercel Pro 기준)
  - 동시 실행 제한: 무료 12개 / Pro 1000개
  - SSE 스트리밍 + 300초 함수 = Vercel 과금 폭증 위험
```

#### Supabase 한계

```
현재 사용 방식:
  - pg 패키지 직접 연결 (Supabase JS SDK 병행)
  - pgBouncer 커넥션 풀러 경유 (SSL: rejectUnauthorized: false)
  - pgvector HNSW 인덱스

리스크:
  - Supabase 무료: DB 500MB, 함수 2GB 전송/월
  - pgBouncer 세션 모드: max_client_conn 제한 (기본 100)
  - 벡터 차원이 4096(Upstage Solar)일 때 HNSW 인덱스 메모리 비용 급증
  - Supabase 서비스 장애 → 전체 앱 불동작 (단일 장애점)
```

### 2.2 프론트엔드 리스크

```
Babel standalone (CDN):
  - 파일 크기: ~1.5MB minified
  - 브라우저에서 11,122라인 JSX → JS 변환: 추가 200~500ms 블로킹
  - React 18 production 빌드 대신 development 빌드 사용 중
    (react.development.js ← 경고·검사 코드 포함, 더 느림)

단일 파일 11,122라인:
  - VSCode에서 편집 시 언어 서버 분석 느려짐
  - Git conflict 시 충돌 해결 범위가 너무 큼
  - 특정 탭 기능만 수정해도 전체 파일 배포
  - 테스트 단위 분리 불가 (컴포넌트 단위 유닛 테스트 없음)
```

---

## 3. 인프라 대안 아키텍처 제안

### 3.1 현재 구조 vs 대안 비교 개요

```
현재:
  Browser → Vercel CDN (index.html) → Vercel Serverless (api/*.js) → Supabase PostgreSQL

대안 목표:
  ① 콜드 스타트 제거 (RAG 300초 함수를 상시 실행 서버로)
  ② pgvector 직접 관리로 성능·비용 최적화
  ③ SSE 스트리밍 안정성 확보
  ④ 비용 절감 (Vercel Pro → 더 저렴한 옵션)
```

---

### 3.2 대안 A: Railway + Neon PostgreSQL (권장 — 즉시 적용 가능)

```
┌──────────────────────────────────────────────────────────┐
│  Browser                                                 │
└───────────────────┬──────────────────────────────────────┘
                    ↓ HTTPS
┌──────────────────────────────────────────────────────────┐
│  Railway.app (Node.js 컨테이너, Always-On)               │
│                                                          │
│  server.js (Express)                                     │
│  ├── /api/rag     ← SSE 스트리밍, 제한 없음              │
│  ├── /api/upload  ← 대용량 업로드, 메모리 최대 8GB       │
│  └── /api/* (32개 라우트 그대로 사용)                    │
│                                                          │
│  PM2 cluster mode (CPU 코어 수만큼 워커)                 │
└───────────────────┬──────────────────────────────────────┘
                    ↓ PostgreSQL (SSL)
┌──────────────────────────────────────────────────────────┐
│  Neon.tech (Serverless PostgreSQL + pgvector)            │
│  - 자동 스케일 (트래픽 없을 때 일시 정지로 비용 절약)     │
│  - 브랜치 기능: 개발/스테이징 DB 즉시 분기               │
│  - pgvector 0.7+ HNSW 지원                               │
└──────────────────────────────────────────────────────────┘
```

**변경 범위**: `vercel.json` 삭제 + `Procfile` 또는 `railway.json` 추가
현재 `server.js`가 Express로 모든 API를 통합하고 있으므로 **코드 변경 최소화**

| 항목 | Vercel + Supabase | Railway + Neon |
|------|-------------------|----------------|
| 콜드 스타트 | 300~800ms | **없음** (항상 실행) |
| RAG 300초 함수 | Pro 플랜 필수 | **제한 없음** |
| SSE 스트리밍 | 연결 강제 종료 위험 | **안정** |
| 월 비용 (소규모) | $20~40 | **$5~15** |
| DB 벡터 인덱스 | Supabase 관리형 | Neon (유사 관리형) |
| DB 브랜치 | 없음 | **있음** (개발/운영 분리) |
| 마이그레이션 난이도 | - | **낮음** (server.js 그대로) |

**설정 변경 예시**:
```json
// railway.json (신규)
{
  "build": { "builder": "NIXPACKS" },
  "deploy": {
    "startCommand": "node server.js",
    "healthcheckPath": "/api/settings"
  }
}
```

```
// 환경변수만 Railway 대시보드에 동일하게 설정:
DATABASE_URL=postgresql://... (Neon 연결 문자열로 교체)
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
```

---

### 3.3 대안 B: Hetzner VPS + Docker Compose (비용 최적화, 완전 자체 관리)

```
┌──────────────────────────────────────────────────────────┐
│  Hetzner CX22 (2 vCPU, 4GB RAM, €4.15/월)               │
│                                                          │
│  ┌─────────────────┐   ┌──────────────────────────┐     │
│  │  Caddy (HTTPS)  │   │  PostgreSQL 17 + pgvector │     │
│  │  자동 Let's Enc │   │  (컨테이너 볼륨에 영구 저장)│    │
│  └────────┬────────┘   └──────────────┬───────────┘     │
│           ↓                           ↓                  │
│  ┌────────────────────────────────────────────────┐      │
│  │  Node.js (PM2 cluster, docstore server.js)     │      │
│  └────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────┘
```

**docker-compose.yml 핵심 구조**:
```yaml
services:
  db:
    image: pgvector/pgvector:pg17
    volumes: [pgdata:/var/lib/postgresql/data]
    environment:
      POSTGRES_DB: docstore
      POSTGRES_PASSWORD: ${DB_PASSWORD}

  app:
    build: .
    command: npx pm2-runtime server.js -i max
    depends_on: [db]
    environment:
      DATABASE_URL: postgres://postgres:${DB_PASSWORD}@db:5432/docstore

  caddy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    volumes: [./Caddyfile:/etc/caddy/Caddyfile]
```

| 항목 | Vercel + Supabase | Hetzner VPS |
|------|-------------------|-------------|
| 월 비용 | $20~80 | **€4~10** |
| 데이터 소유권 | 외부 클라우드 | **자체 서버** |
| 벡터 인덱스 메모리 | Supabase 제한 | **서버 RAM 전부 활용** |
| 운영 부담 | 낮음 | 높음 (백업·패치 직접) |
| 가용성 SLA | 99.9% | 서버 단독 (단일 장애점) |

**적합한 상황**: 데이터 민감도가 높거나, 비용 절감이 최우선이거나, DB 튜닝을 직접 하고 싶을 때

---

### 3.4 대안 C: Cloudflare Workers + Neon (엣지 컴퓨팅, 글로벌 배포)

```
Browser → Cloudflare Edge (Workers) → Neon PostgreSQL (HTTP API)
           └─ 전 세계 300개 PoP      └─ 서버리스 Postgres
              콜드 스타트 < 5ms
```

**한계**: Workers는 실행 시간 30초 제한 (RAG 300초 불가), SSE 스트리밍 지원 제한적
**결론**: 현재 아키텍처(장시간 AI 작업)와 **맞지 않음**

---

### 3.5 대안 D: AWS ECS Fargate + RDS Aurora PostgreSQL (엔터프라이즈)

```
Browser → CloudFront (CDN) → ALB → ECS Fargate (컨테이너)
                                    └─ RDS Aurora PostgreSQL + pgvector
                                    └─ ElastiCache Redis (세션 캐시)
                                    └─ S3 (파일 저장)
```

| 항목 | 내용 |
|------|------|
| 가용성 | 99.99% (다중 AZ) |
| 자동 스케일 | ECS 태스크 수 자동 조절 |
| 월 비용 | $80~300 (소규모 기준) |
| 적합 시점 | 월 1만 명 이상 사용자, 기업 고객 SLA 필요 시 |

---

### 3.6 인프라 대안 종합 권장

```
현재 단계 (프로토타입/소규모):
  → Railway + Neon PostgreSQL  ★★★★★
    이유: 코드 변경 최소 + 콜드 스타트 해결 + Supabase 대비 저비용

비용 최우선:
  → Hetzner VPS + Docker Compose  ★★★★☆
    이유: €4/월, 데이터 자체 소유, 완전 제어

성장 후 (상용화):
  → AWS ECS + Aurora  ★★★★★
    이유: 엔터프라이즈 SLA, 자동 스케일, 보안 인증 대응
```

---

## 4. SPA 구조 개선 제안

### 4.1 현재 SPA 구조의 문제점 분석

#### 문제 1: 런타임 JSX 컴파일 (성능 블로킹)

```
현재 로딩 순서:
  1. index.html 파싱 시작
  2. @babel/standalone (~1.5MB) 다운로드 → 파싱
  3. React 18 development.js (~1.1MB) 다운로드
  4. Tailwind CDN 스크립트 실행
  5. 11,122라인 JSX → JS 변환 (브라우저 메인 스레드)
  6. React 렌더링 시작

문제:
  - 2~5번 과정이 순차적으로 블로킹 (Total Blocking Time 증가)
  - Babel standalone = 프로덕션에서 절대 사용하면 안 되는 패턴
  - React development 빌드 = 경고 코드 포함, 실제 사용에서 ~30% 느림
  - CDN unpkg.com 장애 → 앱 전체 불동작
```

#### 문제 2: 11,122라인 단일 파일 (유지보수 위험)

```
현재:
  index.html (11,122라인)
  ├── CSS (200라인)
  ├── 공통 유틸/훅 (580라인)
  ├── 공통 UI 컴포넌트 Button/Modal/Card 등 (250라인)
  ├── UploadTab (1,100라인)
  ├── CrawlingTab (560라인)
  ├── DocumentsTab (1,500라인)
  ├── SearchTab (1,400라인)
  ├── ChatTab (1,300라인)
  ├── SettingsTab (490라인)
  ├── TuningTab (760라인)
  └── App + 라우팅 (80라인)

문제:
  - 한 탭 버그 수정이 다른 탭 코드에 영향 (같은 파일)
  - Git blame 추적 어려움
  - 컴포넌트 단위 유닛 테스트 불가
```

#### 문제 3: URL 라우팅 없음

```
현재:
  탭 이동 = activeTab 상태 변수 변경만 (URL 변화 없음)
  → 새 탭 열기: 항상 '업로드' 탭으로 시작
  → 브라우저 뒤로가기: 동작 안 함
  → 특정 문서/검색 결과 URL 공유: 불가

예: 검색 결과에서 특정 문서 링크를 공유하고 싶어도
    /?tab=documents&docId=123 같은 URL이 없음
```

#### 문제 4: SearchTab/ChatTab 항상 DOM에 상주

```javascript
// 현재 코드 (index.html:11096)
<div style={{ display: activeTab === 'search' ? 'block' : 'none' }}>
  <SearchTab onNavigateToDoc={handleNavigateToDoc} />
</div>
<div style={{ display: activeTab === 'chat' ? 'block' : 'none' }}>
  <ChatTab onNavigateToDoc={handleNavigateToDoc} />
</div>

// 문제:
// SearchTab, ChatTab은 앱 시작 시 바로 마운트 → API 호출 발생
// display:none이어도 이벤트 리스너 살아있음
// 이 방식을 선택한 이유(상태 유지)는 이해하나,
// 메모리 상주 + 불필요한 초기 API 호출이 단점
```

---

### 4.2 개선 방안 (3가지 레벨)

---

#### 레벨 1: 빌드 도구 도입 (Vite + 파일 분리) — 권장

**현재 단일 파일을 모듈로 분리하고 Vite로 빌드**

```
개선 전:
  index.html (11,122라인) ← 전부 다운로드 후 Babel로 변환

개선 후:
  src/
  ├── main.jsx                    (앱 진입점)
  ├── components/
  │   ├── ui/                     Button, Modal, Card 등 공통 UI
  │   ├── Header.jsx
  │   └── BottomNav.jsx
  ├── tabs/
  │   ├── UploadTab.jsx           (lazy import)
  │   ├── CrawlingTab.jsx         (lazy import)
  │   ├── DocumentsTab.jsx        (lazy import)
  │   ├── SearchTab.jsx           (lazy import)
  │   ├── ChatTab.jsx             (lazy import)
  │   ├── SettingsTab.jsx         (lazy import)
  │   └── TuningTab.jsx           (lazy import)
  ├── hooks/
  │   ├── useAuth.js
  │   ├── useTheme.js
  │   └── useApiKeyStatus.js
  ├── lib/
  │   └── api.js                  (authFetch 등 공통 API 함수)
  └── App.jsx
```

**라우팅 추가 (React Router v6 + hash 방식)**:

```jsx
// App.jsx
import { HashRouter, Routes, Route } from 'react-router-dom';

const UploadTab   = lazy(() => import('./tabs/UploadTab'));
const SearchTab   = lazy(() => import('./tabs/SearchTab'));
const ChatTab     = lazy(() => import('./tabs/ChatTab'));
// ... 나머지 탭도 동일

function App() {
  return (
    <HashRouter>
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route path="/"          element={<UploadTab />} />
          <Route path="/documents" element={<DocumentsTab />} />
          <Route path="/documents/:id" element={<DocumentsTab />} />
          <Route path="/search"    element={<SearchTab />} />
          <Route path="/chat"      element={<ChatTab />} />
          <Route path="/settings"  element={<SettingsTab />} />
          <Route path="/tuning"    element={<TuningTab />} />
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
```

**Vite 설정**:
```javascript
// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-d3': ['d3'],
          'vendor-md': ['marked'],
        }
      }
    }
  }
});
```

**vercel.json 또는 Railway 정적 서빙 설정**:
```
빌드된 dist/ 폴더를 서버에서 정적 파일로 서빙
server.js에 express.static('dist') 추가 (또는 Vercel이 자동 처리)
```

**기대 효과**:

| 항목 | 현재 | 개선 후 | 효과 |
|------|------|---------|------|
| 첫 로드 JS 파싱 시간 | ~600ms (Babel + JSX 변환) | **~80ms** | **85% 단축** |
| 초기 다운로드 번들 크기 | ~3MB (CDN 합산) | **~200KB** (gzip, React+공통만) | **90% 감소** |
| 탭 전환 시 추가 다운로드 | 없음 (이미 전부 로드) | 탭 첫 방문 시 ~30KB | 초기 절약 후 온디맨드 |
| CDN 장애 영향 | 앱 전체 불동작 | **없음** (모두 번들에 포함) | 가용성 향상 |
| 컴포넌트 유닛 테스트 | 불가 | **가능** (Vitest) | 품질 향상 |
| VSCode 편집 성능 | 11,122라인 파일 버벅임 | 파일당 200~1,500라인 | 개발 생산성 향상 |
| URL 공유 | 불가 | **가능** (#/search?q=개인정보) | UX 향상 |
| 브라우저 뒤로가기 | 동작 안 함 | **정상 동작** | UX 향상 |

---

#### 레벨 2: Next.js App Router 마이그레이션 (중기)

**서버 컴포넌트 + 클라이언트 컴포넌트 혼합**

```
현재 아키텍처 문제:
  모든 데이터 패칭이 클라이언트에서 발생
  → 문서 목록, 설정 등은 서버에서 미리 렌더링하면 더 빠름

Next.js 14 App Router 적용:

app/
├── layout.tsx          (공통 레이아웃, 헤더, 인증 Provider)
├── page.tsx            (업로드 탭)
├── documents/
│   ├── page.tsx        (문서 목록 — RSC로 서버에서 데이터 패칭)
│   └── [id]/
│       └── page.tsx    (문서 상세 — RSC)
├── search/
│   └── page.tsx        ('use client' — 검색은 인터랙티브)
├── chat/
│   └── page.tsx        ('use client' — 채팅은 인터랙티브)
├── settings/
│   └── page.tsx        (설정)
└── api/                (기존 api/*.js를 Route Handlers로 이전)
    ├── rag/route.ts
    ├── search/route.ts
    └── ...
```

**기대 효과 (레벨 1 대비 추가)**:

| 항목 | 효과 |
|------|------|
| 문서 목록 LCP | RSC로 서버 렌더링 → **LCP 0.8~1.2초 단축** |
| SEO | 문서 메타데이터 서버 렌더링 → 검색엔진 인덱싱 가능 |
| API 통합 | Next.js Route Handlers로 api/*.js 통합 (파일 수 감소) |
| 인증 미들웨어 | Next.js Middleware로 JWT 검증 일원화 |

**단점**: 마이그레이션 공수 크고(2~3주), Next.js 학습 필요

---

#### 레벨 3: 현재 구조 유지 + 최소 개선 (단기 빠른 적용)

**Vite 없이 현재 CDN 방식을 유지하면서 즉시 적용 가능한 개선**

```html
<!-- 1. React development → production 빌드로 교체 -->
<!-- 변경 전 -->
<script src="https://unpkg.com/react@18/umd/react.development.js"></script>
<!-- 변경 후 -->
<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>

<!-- 2. Babel standalone 제거 → precompiled 접근 (제한적) -->
<!-- Babel standalone 없이는 JSX 문법 사용 불가이므로,
     React.createElement() 직접 사용하거나 htm 라이브러리 활용 -->
<!-- <script src="https://unpkg.com/htm@3/dist/htm.module.js"></script> -->

<!-- 3. URL 해시 라우팅 추가 -->
```

```javascript
// index.html 안에서 hash 기반 라우팅 추가 (App 컴포넌트 수정)
const [activeTab, setActiveTab] = useState(() => {
  const hash = window.location.hash.replace('#/', '') || 'upload';
  return ['upload','documents','search','chat','settings','tuning'].includes(hash)
    ? hash : 'upload';
});

// 탭 변경 시 URL hash 업데이트
const handleTabChange = useCallback((tab) => {
  setActiveTab(tab);
  window.location.hash = '/' + tab;
}, []);

// 뒤로가기 지원
useEffect(() => {
  const onHashChange = () => {
    const hash = window.location.hash.replace('#/', '') || 'upload';
    setActiveTab(hash);
  };
  window.addEventListener('hashchange', onHashChange);
  return () => window.removeEventListener('hashchange', onHashChange);
}, []);
```

**레벨 3 기대 효과**:

| 항목 | 현재 | 개선 후 |
|------|------|---------|
| React 렌더링 속도 | development 빌드 (느림) | **production 빌드 (~30% 빠름)** |
| URL 공유 | 불가 | `#/search`, `#/chat` 등 가능 |
| 브라우저 뒤로가기 | 동작 안 함 | **정상 동작** |
| 작업 공수 | - | **30분 이내** |

---

### 4.3 SPA 개선 방안 종합 비교

```
                 레벨 3        레벨 1         레벨 2
                 (즉시)       (Vite)         (Next.js)
              ─────────────────────────────────────────
초기 로드 개선    ★★☆☆☆       ★★★★★         ★★★★★
URL 라우팅        ★★★☆☆       ★★★★★         ★★★★★
코드 유지보수     ★★☆☆☆       ★★★★★         ★★★★★
SSR/SEO           ☆☆☆☆☆       ☆☆☆☆☆         ★★★★☆
마이그레이션 공수  ★★★★★       ★★★★☆         ★★☆☆☆
(별 많을수록 쉬움)
권장 대상        즉시 개선     일반 권장      상용화 목표 시
```

**권장**: 단기 → 레벨 3으로 URL 라우팅 즉시 추가 / 중기 → 레벨 1 Vite 마이그레이션

---

## 5. 통합 로드맵

### 5.1 단기 (1~2일, 즉시 실행)

| # | 작업 | 기대 효과 | 난이도 |
|---|------|-----------|--------|
| 1 | React dev → production 빌드 교체 | 렌더링 30% 빠름 | ★☆☆☆☆ |
| 2 | index.html 해시 라우팅 추가 | URL 공유·뒤로가기 가능 | ★★☆☆☆ |
| 3 | Railway 배포 전환 테스트 | 콜드 스타트 해결 | ★★☆☆☆ |

### 5.2 단기 (1~2주)

| # | 작업 | 기대 효과 | 난이도 |
|---|------|-----------|--------|
| 4 | Vite + React Router 마이그레이션 | 번들 90% 감소, 코드 분리 | ★★★☆☆ |
| 5 | Railway + Neon 정식 전환 | Vercel Pro 비용 절감 | ★★★☆☆ |
| 6 | React production 빌드 + CDN 캐싱 | LCP 개선 | ★★☆☆☆ |

### 5.3 중기 (1~2개월)

| # | 작업 | 기대 효과 | 난이도 |
|---|------|-----------|--------|
| 7 | Vitest 유닛 테스트 추가 | 컴포넌트 단위 검증 | ★★★☆☆ |
| 8 | Plan-and-Execute 에이전트 | 복합 질의 처리 | ★★★★☆ |
| 9 | 대화 요약 메모리 | 긴 대화 맥락 유지 | ★★★☆☆ |
| 10 | Next.js 마이그레이션 (선택) | SSR, SEO, 구조 개선 | ★★★★★ |

---

## 부록: 현재 vs 개선 후 아키텍처 다이어그램

### 현재

```
Browser
  ↓ (HTML + 3MB CDN 스크립트 순차 로드)
index.html
  → Babel standalone이 11,122라인 JSX 런타임 컴파일
  → React.render() 시작
  → API 호출 → Vercel Serverless (콜드 스타트 800ms)
                → Supabase pgBouncer → PostgreSQL
```

### 개선 후 (레벨 1 + Railway)

```
Browser
  ↓ (dist/index.html + 200KB 초기 번들, gzip)
React Router 해시 라우팅
  → 현재 탭 컴포넌트만 lazy import (~30KB 추가)
  → API 호출 → Railway (Always-On Express, 콜드 스타트 없음)
                → Neon PostgreSQL (pgvector, 브랜치 지원)
```

---

> 본 문서는 ANALYSIS4.md(2026-03-14)와 코드베이스 직접 점검을 기반으로 작성되었습니다.
> 다음 분석 보고서: ANALYSIS6.md (Vite 마이그레이션 완료 후 재평가 예정)
