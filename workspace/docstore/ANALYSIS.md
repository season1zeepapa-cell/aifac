# DocStore 현황 분석 및 확장 제안

> 작성일: 2026-03-10
> 역할: PDF 문서 관리 → 지식 벡터화 파이프라인

## 현재 기능 요약

| 파이프라인 | 입력 | 처리 | 출력 |
|-----------|------|------|------|
| 멀티포맷 업로드 | PDF/TXT/MD/DOCX/XLSX/CSV/JSON/이미지 | 형식별 텍스트 추출 → 섹션 분할 → 임베딩 | DB 저장 + 벡터 검색 |
| 객관식 파싱 | 기출 PDF | GPT-4o 분할 파싱 (10문제씩) | 문제/보기/정답 구조화 |
| 법령 임포트 | 법령명 검색 | 법제처 API → 조문 파싱 → 계층 라벨링 → 참조 관계 | 조문별 DB + 벡터 |
| 웹 크롤링 | URL | HTML → 텍스트 추출 → 단락 분할 → 임베딩 | DB 저장 + 벡터 검색 |
| 검색 | 키워드/질문 | 텍스트 ILIKE / 벡터 cosine / RAG(Gemini) | 관련 문서 + AI 답변 |
| AI 요약 | 섹션/문서 | Gemini 1-2줄 요약 생성 → 캐싱 | 요약 텍스트 |

## 파일 구조

```
workspace/docstore/
├── server.js                    # Express 메인 서버
├── index.html                   # SPA 프론트엔드 (React + Tailwind)
├── vercel.json                  # Vercel 배포 설정
├── api/
│   ├── db.js                    # PostgreSQL 커넥션 풀
│   ├── documents.js             # 문서 CRUD
│   ├── upload.js                # PDF 업로드 + 추출
│   ├── search.js                # 텍스트/벡터 검색
│   ├── law.js                   # 법령 검색/상세 프록시
│   ├── law-import.js            # 법령 임포트 (참조 관계 포함)
│   ├── summary.js               # 조문/섹션 AI 요약 (Gemini)
│   ├── url-import.js            # 웹 URL 크롤링 → DB
│   └── rag.js                   # RAG 질의응답
├── lib/
│   ├── pdf-extractor.js         # PDF 추출 (텍스트 + OCR + 문제 파싱)
│   ├── embeddings.js            # 청크 분할 + OpenAI 임베딩
│   ├── law-fetcher.js           # 법제처 API 클라이언트
│   └── text-extractor.js       # 멀티포맷 텍스트 추출 (TXT/MD/DOCX/XLSX/CSV/JSON/이미지)
└── scripts/
    ├── create-tables.js         # DB 스키마 생성
    ├── generate-embeddings.js   # 기존 문서 임베딩 생성
    └── import-pdf.js            # CLI PDF 임포트
```

## DB 테이블

- **documents** — id, title, file_type('pdf'|'law'), category, upload_date, metadata(JSONB)
- **document_sections** — id, document_id(FK), section_type, section_index, raw_text, metadata(JSONB)
- **document_chunks** — id, section_id(FK), chunk_text, embedding(vector 1536), chunk_index

---

## 확장 로드맵

### 1단계: 즉시 적용 (인프라/보안)

- [x] pgvector HNSW 인덱스 추가 (검색 성능)
- [x] 관리자 인증 추가 (JWT + requireAdmin, workspace/error users 공유)
- [x] 임베딩 생성 상태 표시 (UI)

### 2단계: 활용도 확장 (검색/필터)

- [x] 장/절 단위 필터 검색
- [x] 검색 결과에서 계층 라벨 표시
- [x] 문서 상세에서 장/절 접기/펼치기

### 3단계: 파이프라인 확장

- [x] 웹 URL 크롤링 소스 추가
- [x] 조문/섹션별 AI 요약 생성
- [x] 조문 간 참조 관계 파싱

### 최종: RAG 질의응답

- [x] 사용자 질문 → 벡터 검색 → 관련 조문 추출 → AI 답변 생성
- [x] 근거 조문 인용 표시
- [x] 검색 탭에 "AI 질의" 모드 추가

---

## 확장 로드맵 v2 (멀티포맷 지식 DB)

> 작성일: 2026-03-10

### 지원 파일 형식

| 형식 | 확장자 | 추출 방법 | 물어볼 옵션 |
|------|--------|----------|------------|
| PDF | .pdf | pdf-parse + Claude OCR (기존) | 추출 단위(페이지/전체/문제/구분자) |
| 텍스트 | .txt | 그대로 읽기 | 구분 방식(줄단위/구분자/전체) |
| 마크다운 | .md | 그대로 읽기 | 구분 방식(헤딩 기준/전체) |
| Word | .docx | mammoth 라이브러리 | 구분 방식(단락/헤딩/전체) |
| Excel/CSV | .xlsx, .csv | xlsx/csv-parse | 어떤 열이 본문인지, 행 범위 |
| 이미지 | .jpg, .png | OCR 플러그인 (Gemini/CLOVA/Vision/Claude/Textract/OCR.space) | 내용 유형(일반/표/문제) |
| JSON | .json | 필드 파싱 | 어떤 필드를 추출할지 |

### 업로드 UX 흐름

```
파일 드래그/선택
    ↓
메타 정보 자동 감지 (이름, 크기, 형식, 아이콘)
    ↓
파일 형식에 맞는 옵션 카드 자동 표시
    ↓
제목 + 카테고리 입력 (제목은 파일명에서 자동 추출)
    ↓
업로드 → 추출 → 섹션 분할 → 임베딩 → DB 저장
```

### 구현 단계

#### 1단계: 멀티포맷 업로드 확장
- [x] 프론트 드롭존 다양한 파일 형식 허용
- [x] 파일 메타 감지 → 형식별 옵션 UI 자동 표시
- [x] `lib/text-extractor.js` 신규 (TXT/MD/DOCX/CSV/XLSX/JSON/이미지)
- [x] `api/upload.js` 멀티포맷 대응
- [x] 패키지 추가: mammoth, xlsx, csv-parse

#### 2단계: 문서 상세 개선 + 검색 필터 UI
- [x] 장/절 접기/펼치기 (chapter 기준 그룹핑)
- [x] 전체 펼치기/접기 토글
- [x] 검색 탭에 문서/장 필터 드롭다운
- [x] 검색 결과 → 문서 상세 이동

#### 3단계: 조문 참조 관계 파싱
- [x] 법령 임포트 시 `제N조(의N)` 패턴 정규식 추출
- [x] metadata.references 배열 저장
- [x] 문서 상세 UI에서 참조 클릭 → 해당 조문 스크롤
- [x] 역참조 표시 ("이 조문을 참조하는 조문")

#### 4단계: 조문별 AI 요약
- [x] `api/summary.js` 신규 (Gemini 1-2줄 요약)
- [x] 요약 결과 metadata.summary 캐싱
- [x] 문서 상세 모달에 요약 표시/생성 버튼
- [x] 전체 요약 일괄 생성 옵션

#### 5단계: 웹 URL 크롤링 + RAG 개선
- [x] `api/url-import.js` 신규 (HTML → 텍스트 추출)
- [x] 업로드 탭 URL 모드 추가
- [x] RAG 답변 마크다운 렌더링 (marked.js CDN)
- [ ] RAG 대화 컨텍스트 (후속 질문) — 추후 구현

### 추가 패키지

```
mammoth    → DOCX 텍스트 추출
xlsx       → Excel 파싱
csv-parse  → CSV 파싱
marked     → RAG 답변 마크다운 렌더링 (CDN)
```

---

## 구현 완료 요약 (2026-03-10)

### 1단계: 멀티포맷 업로드 확장 ✅
- 드롭존이 PDF, TXT, MD, DOCX, XLSX, CSV, JSON, 이미지 모두 지원
- 파일 선택 시 형식 자동 감지 → 아이콘/뱃지 표시
- 형식별 옵션 UI 자동 표시 (CSV 열 선택, JSON 필드 선택, 이미지 OCR 유형 등)
- `lib/text-extractor.js` 신규 (mammoth, xlsx, csv-parse 패키지 추가)

### 2단계: 문서 상세 개선 + 검색 필터 ✅
- 법령 조문을 장(chapter) 기준 그룹핑 → 접기/펼치기
- 전체 펼치기/접기 토글 버튼
- 검색 탭에 문서 범위 / 장 필터 드롭다운 (API 기존 지원 활용)
- 검색 결과 카드 클릭 → 문서 상세 모달로 이동

### 3단계: 조문 참조 관계 파싱 ✅
- `제N조(의N)` 정규식 추출 → `metadata.references` 저장
- 역참조 계산 → `metadata.referencedBy` 저장
- UI에서 참조(파란색)/역참조(노란색) 링크 클릭 → 해당 조문 스크롤

### 4단계: 조문별 AI 요약 ✅
- `api/summary.js` 신규 (Gemini 2.5 Flash, 1-2줄 요약)
- 단일 섹션 요약 + 문서 전체 일괄 요약
- `metadata.summary`에 캐싱 (중복 호출 방지)
- 각 섹션에 "AI 요약" 버튼 + "전체 AI 요약" 버튼

### 5단계: 웹 URL 크롤링 + RAG 개선 ✅
- `api/url-import.js` 신규 (HTML → 텍스트 추출 → 단락 분할)
- 업로드 탭에 URL 크롤링 모드 추가 (파일/법령/URL 3가지)
- RAG 답변에 marked.js CDN 마크다운 렌더링

### 미구현 (추후)
- RAG 대화 컨텍스트 (후속 질문 지원)

---

## 코드베이스 점검 보고서 (2026-03-10)

### 보안 취약점

| 등급 | 항목 | 상태 | 설명 |
|------|------|------|------|
| 🔴 긴급 | 인증 없음 | ✅ 해결 | 관리자 JWT 인증 추가 (`api/auth.js`, 모든 API에 `requireAdmin()` 적용) |
| 🔴 긴급 | CORS 전체 허용 | 미조치 | `rag.js`, `summary.js`, `law-import.js` 등에서 `Access-Control-Allow-Origin: *` |
| 🟡 주의 | RegExp 인젝션 | 미조치 | `pdf-extractor.js` 사용자 정의 구분자를 `new RegExp()`에 직접 전달 → ReDoS 가능 |
| 🟡 주의 | 에러 메시지 노출 | 미조치 | `err.message`를 클라이언트에 그대로 반환 → 내부 정보 유출 가능 |
| 🟢 양호 | SQL Injection | 안전 | 모든 쿼리가 파라미터 바인딩 사용 |

### API 비용 분석

| API | 사용처 | 모델 | 예상 비용 | 위험도 |
|-----|--------|------|-----------|--------|
| OpenAI Embeddings | `lib/embeddings.js` | text-embedding-3-small | ~$0.02/1M 토큰 | 🟡 중간 |
| OpenAI GPT-4o | `lib/pdf-extractor.js` (quiz 파싱) | gpt-4o | ~$5/1M 입력 토큰 | 🔴 높음 |
| Anthropic Claude | `lib/pdf-extractor.js` (OCR), `lib/text-extractor.js` (이미지) | claude-opus-4-6 / claude-sonnet-4-6 | ~$15/1M 토큰 (Opus) | 🔴 매우 높음 |
| Google Gemini | `api/rag.js`, `api/summary.js` | gemini-2.5-flash | 무료~저가 | 🟢 낮음 |

#### 비용 폭탄 시나리오

- 이미지 PDF 50페이지 업로드 → 50 × Claude Opus OCR = 약 $3~10 (1회)
- 악의적 사용자 RAG 반복 호출 → 임베딩 + Gemini 무한 과금
- 전체 AI 요약으로 100개 섹션 일괄 → 무료 티어 초과

#### 비용 관리 방안

1. **일일 API 호출 한도 설정** — 메모리/DB에 일별 카운터, 한도 초과 시 차단
   - 임베딩: 일 500회 / OCR(Claude): 일 20회 / RAG(Gemini): 일 100회 / 요약(Gemini): 일 200회
2. **인증 추가** — 인증된 사용자만 AI 기능 사용 가능
3. **OCR 모델 다운그레이드** — `pdf-extractor.js`의 `claude-opus-4-6` → `claude-sonnet-4-6` (비용 80% 절감)
4. **임베딩 배치 최적화** — 섹션별 개별 호출 → 전체 배치 1회 호출
5. **요약 캐싱** — 이미 `metadata.summary` 캐싱 구현됨 (양호)

### 리팩토링 필요 사항

| 항목 | 현재 상태 | 개선 방안 |
|------|-----------|-----------|
| `callGemini()` 중복 | `rag.js`와 `summary.js`에 동일 함수 복사 | `lib/gemini.js`로 분리 |
| 임베딩 생성 로직 중복 | `upload.js`, `law-import.js`, `url-import.js` 3곳 반복 | `lib/embeddings.js`에 `generateAndSaveEmbeddings(documentId)` 통합 |
| CORS 설정 중복 | 5개 API 파일에서 수동 설정 | `server.js`에서 미들웨어로 통합 |
| OCR 모델 과잉 | `pdf-extractor.js`에서 Opus 사용 | Sonnet으로 변경 (OCR 정확도 차이 미미) |

### 기능 개선 제안

#### 단기 (즉시 적용)

- [x] 관리자 인증 추가 (JWT + requireAdmin 미들웨어)
- [ ] API 호출 횟수 제한 (일일 한도)
- [x] OCR 플러그인 아키텍처 구현 (6개 엔진, 우선순위 폴백)
- [ ] `callGemini` 공통 모듈 분리
- [ ] 에러 메시지 클라이언트 노출 최소화

#### 중기 (활용도 향상)

- [ ] 문서 수정/제목 변경 기능 (현재 삭제 후 재업로드만 가능)
- [ ] 임베딩 재생성 버튼 (실패한 임베딩 수동 재시도)
- [ ] 검색 결과 하이라이팅 (검색어 위치 시각적 표시)
- [x] API 사용량 대시보드 (일/월별 호출 현황, OCR 설정 통합)

#### 장기 (확장)

- [ ] RAG 대화 컨텍스트 (후속 질문 지원)
- [ ] 문서 간 비교 기능 (법령 개정 전후 비교)
- [ ] 원본 파일 Supabase Storage 이전 (DB BYTEA → 스토리지 분리)

### 우선 실행 순서

```
1순위: ✅ 인증 추가 (관리자 JWT 완료)
2순위: ✅ OCR 플러그인 아키텍처 (6개 엔진 완료)
3순위: CORS 도메인 제한 + 보안 헤더 추가
4순위: Rate Limiting (API 호출 횟수 제한)
5순위: callGemini / 임베딩 로직 공통화 (리팩토링)
6순위: 에러 메시지 정리 + 입력 검증 강화
```

---

## 구현 완료 요약 v3 — 인증 + OCR 플러그인 (2026-03-10)

### 관리자 인증 시스템 ✅
- `api/auth.js` — HMAC-SHA256 JWT 직접 구현 (의존성 없음)
- `api/login.js` — 관리자 전용 로그인 (workspace/error의 `public.users` 테이블 공유)
- 모든 API에 `requireAdmin()` 인증 미들웨어 적용
- 프론트엔드 `authFetch()` 래퍼로 Authorization 헤더 자동 주입 + 401 자동 로그아웃
- `LoginScreen` 컴포넌트 추가 (비로그인 시 로그인 화면 표시)

### OCR 플러그인 아키텍처 ✅
- `lib/ocr/index.js` — OCR 엔진 매니저 (레지스트리, DB 설정, 캐시, 우선순위 폴백)
- 6개 OCR 엔진 플러그인:
  - `gemini-vision` — Gemini 2.5 Flash (무료, 기본 1순위)
  - `naver-clova` — 네이버 CLOVA OCR (한국어 최강)
  - `google-vision` — Google Cloud Vision (정확도 최고)
  - `claude-vision` — Claude Sonnet (문맥 분석)
  - `aws-textract` — AWS Textract (표/양식 특화)
  - `ocr-space` — OCR.space (무료 일500건, 한국어 지원)
- `ocr_engine_config` DB 테이블로 우선순위/활성 상태 관리
- 설정 UI에서 수동 변경, 테스트, 우선순위 조정 가능
- 1분 TTL 캐시로 서버리스 환경 최적화

### API 사용량 대시보드 확장 ✅
- OCR 설정을 `api/api-usage.js`에 통합 (Vercel 12 함수 제한 대응)
- GET `?type=ocr` — OCR 엔진 목록 조회
- POST `ocrUpdatePriority` / `ocrToggleEngine` / `ocrTestEngine` 액션

---

## 파일 구조 (최신)

```
workspace/docstore/
├── server.js                    # Express 메인 서버
├── index.html                   # SPA 프론트엔드 (React + Tailwind CDN)
├── vercel.json                  # Vercel 배포 설정
├── package.json                 # 의존성
├── api/
│   ├── db.js                    # PostgreSQL 커넥션 풀
│   ├── auth.js                  # HMAC-SHA256 JWT 인증
│   ├── login.js                 # 관리자 로그인
│   ├── documents.js             # 문서 CRUD + 원본 다운로드/미리보기
│   ├── upload.js                # 멀티포맷 업로드 + OCR + 임베딩
│   ├── search.js                # 텍스트/벡터 검색
│   ├── law.js                   # 법령 검색 프록시
│   ├── law-import.js            # 법령 임포트 (참조 관계)
│   ├── summary.js               # AI 요약 (Gemini)
│   ├── url-import.js            # 웹 URL 크롤링
│   ├── rag.js                   # RAG 질의응답
│   └── api-usage.js             # API 사용량 + OCR 설정
├── lib/
│   ├── pdf-extractor.js         # PDF 추출 (텍스트 + OCR + 문제 파싱)
│   ├── text-extractor.js        # 멀티포맷 텍스트 추출
│   ├── embeddings.js            # 청크 분할 + OpenAI 임베딩
│   ├── law-fetcher.js           # 법제처 API 클라이언트
│   ├── api-tracker.js           # API 호출 추적
│   ├── doc-analyzer.js          # AI 문서 분석 (요약/키워드/태그 자동 생성)
│   └── ocr/
│       ├── index.js             # OCR 엔진 매니저
│       ├── gemini-vision.js     # Gemini 2.5 Flash OCR
│       ├── claude-vision.js     # Claude Sonnet OCR
│       ├── naver-clova.js       # 네이버 CLOVA OCR
│       ├── google-vision.js     # Google Cloud Vision
│       ├── aws-textract.js      # AWS Textract
│       └── ocr-space.js         # OCR.space (무료)
└── scripts/
    ├── create-tables.js         # DB 스키마 생성
    ├── add-original-file.js     # 원본 파일 컬럼 마이그레이션
    ├── add-labeling-tables.js   # 라벨링 시스템 마이그레이션
    ├── reindex-enriched.js      # 기존 문서 enriched 임베딩 재처리
    ├── generate-embeddings.js   # 기존 문서 임베딩 생성
    └── import-pdf.js            # CLI PDF 임포트
```

## DB 테이블 (최신)

| 테이블 | 용도 | 주요 컬럼 |
|--------|------|-----------|
| `documents` | 문서 메타 + 원본 파일 | id, title, file_type, category, summary, keywords(TEXT[]), summary_embedding(vector 1536), original_file(BYTEA) |
| `document_sections` | 추출 텍스트 | document_id(FK), section_type, raw_text, summary, metadata(JSONB) |
| `document_chunks` | 벡터 임베딩 | section_id(FK), chunk_text, enriched_text, embedding(vector 1536) |
| `tags` | 태그 정의 | id, name(UNIQUE), color, usage_count |
| `document_tags` | 문서↔태그 연결 | document_id(FK), tag_id(FK) — 복합 PK |
| `api_usage` | API 호출 기록 | provider, model, endpoint, status, tokens_in/out, cost_estimate |
| `api_key_status` | API 키 상태 | provider, is_active, daily_limit, last_checked, last_error |
| `ocr_engine_config` | OCR 엔진 설정 | engine_id, is_enabled, priority_order |
| `public.users` | 사용자 (error 공유) | username, password_hash, name, is_admin |

---

## 종합 보안 점검 보고서 (2026-03-10)

### 보안 취약점 상세

#### 🔴 CRITICAL — 즉시 조치 필요

| # | 항목 | 위치 | 설명 | 조치 방안 |
|---|------|------|------|-----------|
| 1 | 토큰 시크릿 기본값 | `api/auth.js:5` | `AUTH_TOKEN_SECRET` 미설정 시 예측 가능한 기본값 사용 | 환경변수 필수 + 32자 이상 강제 |
| 2 | CORS 전체 허용 | 모든 API | `Access-Control-Allow-Origin: *` → CSRF 공격 가능 | 허용 도메인 화이트리스트 적용 |
| 3 | Rate Limiting 없음 | 모든 API | 무제한 API 호출 → 비용 폭탄 + DoS | express-rate-limit 또는 인메모리 카운터 |

#### 🟡 HIGH — 조기 개선 권장

| # | 항목 | 위치 | 설명 | 조치 방안 |
|---|------|------|------|-----------|
| 4 | URL 파라미터 토큰 | `api/auth.js:66` | `req.query.token`으로 토큰 추출 → 로그/캐시에 노출 | Authorization 헤더만 허용 |
| 5 | SSRF 위험 | `api/url-import.js` | URL 검증 부족 → 내부 네트워크 접근 가능 | 내부 IP 차단, URL 스키마 검증 |
| 6 | 파일 업로드 무검증 | `api/upload.js` | MIME 타입/확장자 화이트리스트 없음 | multer fileFilter 추가 |
| 7 | 에러 메시지 노출 | 모든 API | `err.message` 그대로 클라이언트 반환 → 내부 정보 유출 | 프로덕션에서 일반 메시지 반환 |
| 8 | HTML 미정화 | `api/url-import.js` | 크롤링 HTML에서 script 태그만 제거, 이벤트 핸들러 등 미처리 | sanitize-html 적용 |
| 9 | SSL 인증서 미검증 | `api/db.js:11` | `rejectUnauthorized: false` → MITM 공격 가능 | Supabase CA 인증서 사용 |

#### 🟢 MEDIUM — 점진적 개선

| # | 항목 | 위치 | 설명 | 조치 방안 |
|---|------|------|------|-----------|
| 10 | 보안 헤더 미설정 | `vercel.json` | X-Frame-Options, CSP, HSTS 등 없음 | vercel.json headers 추가 |
| 11 | RegExp 인젝션 | `lib/pdf-extractor.js` | 사용자 구분자를 `new RegExp()`에 직접 전달 → ReDoS | 특수문자 이스케이프 |
| 12 | ILIKE 와일드카드 | `api/search.js` | 검색어에 `%` 포함 시 패턴 매칭 공격 | `%` 문자 이스케이프 |
| 13 | 파일명 미정화 | `api/upload.js` | 사용자 제공 파일명 그대로 저장 → 경로 순회 | `path.basename()` + 특수문자 제거 |
| 14 | 감사 로그 없음 | 전체 | 누가 언제 무엇을 했는지 추적 불가 | audit_log 테이블 + 로깅 |

#### ✅ 양호한 부분

| 항목 | 설명 |
|------|------|
| SQL Injection | 모든 쿼리가 파라미터 바인딩 사용 |
| 비밀번호 검증 | `crypto.timingSafeEqual`로 타이밍 공격 방지 |
| JWT 구현 | HMAC-SHA256 서명 + 만료 시간 검증 |
| 관리자 인증 | 모든 API에 `requireAdmin()` 적용 |
| OCR 폴백 | 6개 엔진 순차 시도, 자동 폴백 |

---

### 성능 문제점

| 우선도 | 항목 | 위치 | 영향 | 개선안 |
|--------|------|------|------|--------|
| 🔴 | 원본 파일 BYTEA 저장 | `api/upload.js` | DB 팽창, 메모리 과다, Vercel 10GB 한계 | Supabase Storage 이전 |
| 🔴 | AI 요약 순차 처리 | `api/summary.js` | 60+ 섹션 → 300초 타임아웃 | 병렬 처리 (Promise.allSettled) |
| 🟡 | N+1 쿼리 패턴 | `api/law-import.js` | 100+ 조문 → 100+ INSERT | 배치 INSERT 전환 |
| 🟡 | 임베딩 섹션별 호출 | `api/upload.js` | 섹션마다 OpenAI API 호출 | 전체 배치 1회 호출 |
| 🟡 | 요약 텍스트 2000자 절단 | `api/summary.js:53` | 긴 섹션 뒷부분 요약 누락 | 청크별 요약 후 합성 |
| 🟢 | 이미지 미리보기 캐시 | `api/documents.js` | 매 요청마다 BYTEA 조회 | CDN 캐시 또는 signed URL |

---

### 코드 품질 리팩토링 계획

#### Phase 1 — 보안 강화 (우선)

```
1. vercel.json 보안 헤더 추가
   X-Content-Type-Options, X-Frame-Options, HSTS, Referrer-Policy

2. CORS 도메인 제한
   process.env.ALLOWED_ORIGINS 기반 화이트리스트

3. 토큰 시크릿 기본값 제거
   AUTH_TOKEN_SECRET 미설정 시 서버 시작 거부

4. URL 파라미터 토큰 제거
   Authorization 헤더만 허용

5. 에러 메시지 정리
   프로덕션: 일반 메시지 반환 + 내부 로깅
```

#### Phase 2 — 입력 검증 강화

```
1. 파일 업로드 검증
   MIME 타입 화이트리스트 + 확장자 검증 + 클라이언트 크기 체크

2. URL 임포트 SSRF 방어
   내부 IP 차단 + URL 스키마 검증 + 호스트명 화이트리스트

3. HTML 크롤링 정화
   sanitize-html 패키지 적용

4. 파일명 정화
   path.basename() + 특수문자 제거 + 길이 제한

5. 검색어 이스케이프
   ILIKE 와일드카드 문자 이스케이프
```

#### Phase 3 — 성능 최적화

```
1. 원본 파일 스토리지 분리
   BYTEA → Supabase Storage + signed URL

2. 임베딩 배치 처리
   섹션별 → 전체 배치 1회 호출

3. 법령 임포트 배치 INSERT
   개별 INSERT → multi-row INSERT

4. AI 요약 병렬 처리
   순차 → Promise.allSettled (동시 5개)

5. callGemini 공통 모듈화
   rag.js, summary.js 중복 → lib/gemini.js 분리
```

#### Phase 4 — 운영 안정성

```
1. Rate Limiting 추가
   인메모리 카운터 (서버리스: Vercel KV 또는 DB)

2. 구조화된 로깅
   console.log → 요청 ID + 타임스탬프 + 레벨

3. 감사 로그
   audit_log 테이블 (action, user_id, resource_type, timestamp)

4. 환경변수 검증
   서버 시작 시 필수 변수 체크 + 누락 시 명확한 에러

5. DB 커넥션 에러 핸들링
   pool.on('error') 이벤트 처리
```

---

### 향후 확장 및 기능 최적화 방향

#### 단기 (1~2주)

| 항목 | 설명 | 예상 효과 |
|------|------|-----------|
| 문서 메타 수정 | 제목/카테고리 변경 API + UI | 삭제 후 재업로드 불필요 |
| 임베딩 재생성 | 실패 임베딩 수동 재시도 버튼 | 검색 누락 방지 |
| OCR 실패 시 원본 보존 | OCR 전체 실패해도 원본 파일 저장 | 업로드 실패율 감소 |
| 요약 캐시 무효화 | 섹션 수정 시 요약 재생성 | 데이터 정합성 |
| 클라이언트 파일 크기 검증 | 업로드 전 50MB 체크 | UX 개선 |

#### 중기 (1~2개월)

| 항목 | 설명 | 예상 효과 |
|------|------|-----------|
| Supabase Storage 이전 | 원본 파일 DB → 오브젝트 스토리지 | DB 크기 90% 감소, 성능 향상 |
| RAG 대화 컨텍스트 | 후속 질문 지원 (채팅 히스토리) | AI 질의 품질 향상 |
| 검색 결과 하이라이팅 | 검색어 위치 시각적 표시 | 검색 UX 개선 |
| SSE 스트리밍 요약 | AI 요약 실시간 표시 | 대기 시간 체감 감소 |
| 문서 태그 시스템 | 카테고리 외 자유 태그 | 분류 유연성 |

#### 장기 (3개월+)

| 항목 | 설명 | 예상 효과 |
|------|------|-----------|
| 법령 개정 비교 | 동일 법령 버전 간 diff | 법령 추적 기능 |
| 다중 사용자 권한 | 역할별 접근 제어 (뷰어/에디터/관리자) | 팀 협업 지원 |
| 문서 버전 관리 | 수정 이력 추적 + 롤백 | 데이터 안전성 |
| 소프트 삭제 | deleted_at 컬럼 + 휴지통 | 실수 복구 가능 |
| 실시간 알림 | 문서 처리 완료 알림 (Supabase Realtime) | 대용량 처리 UX |
| 멀티 LLM 지원 | RAG/요약에 OpenAI, Claude 선택 가능 | 비용/품질 최적화 |

---

### API 비용 분석 (최신)

| API | 사용처 | 모델 | 예상 비용 | 비고 |
|-----|--------|------|-----------|------|
| OpenAI Embeddings | `lib/embeddings.js` | text-embedding-3-small | ~$0.02/1M 토큰 | 🟢 저렴 |
| OpenAI GPT-4o | `lib/pdf-extractor.js` (quiz 파싱) | gpt-4o | ~$5/1M 입력 토큰 | 🔴 높음 |
| Google Gemini | RAG, 요약, OCR | gemini-2.5-flash | 무료~저가 | 🟢 낮음 |
| Anthropic Claude | OCR (폴백) | claude-sonnet-4-6 | ~$3/1M 토큰 | 🟡 중간 |
| OCR.space | OCR (무료 폴백) | - | 무료 (일500건) | 🟢 무료 |
| Naver CLOVA | OCR (한국어 특화) | - | 종량제 | 🟡 중간 |

#### 비용 최적화 전략

1. **Gemini 우선** — 무료/저가 모델 최우선 사용 (현재 적용됨)
2. **OCR 폴백 체인** — 무료 엔진 → 유료 엔진 순서 (현재 적용됨)
3. **요약 캐싱** — 동일 섹션 중복 요약 방지 (현재 적용됨)
4. **임베딩 배치화** — 개별 → 배치로 API 호출 횟수 최소화 (미적용)
5. **Rate Limiting** — 일일 한도 설정으로 비용 상한 제어 (미적용)

---

## 벡터화 중심 라벨링 설계 (2026-03-10)

> 문서가 많아지고 종류가 다양해질수록, 검색 정확도를 높이려면
> "맥락 정보(요약, 태그, 키워드)"를 벡터에 포함시키는 **enriched embedding** 전략이 필요

### 현재 문제점

| 항목 | 현재 상태 | 문제 |
|------|----------|------|
| 카테고리 | `category` 단일 자유텍스트 | "법령"/"법률"/"법" 중복, 정규화 안됨 |
| 태그 | 없음 | 하나의 문서에 여러 주제 붙일 수 없음 |
| 검색 필터 | `docId`, `chapter` 2개뿐 | 카테고리별, 태그별 필터 불가 |
| 문서 요약 | 섹션 metadata.summary만 존재 | 문서 전체 요약 없음, 벡터화에 미반영 |
| 임베딩 | 청크 원문 텍스트만 벡터화 | 맥락 정보 없어 유사도 정확도 낮음 |

### 개선: enriched embedding 전략

```
[현재] embedding = vectorize(청크_원문)
[개선] embedding = vectorize(맥락_프리픽스 + 청크_원문)

맥락 프리픽스 예시:
  [문서] 개인정보 보호법
  [분류] 법령
  [태그] CCTV, 개인정보, 설치기준
  [문서요약] 개인정보의 수집·이용·제공 원칙과 정보주체 권리를 규정
  [장] 제4장 영상정보처리기기
  [조항] 제25조 영상정보처리기기의 설치·운영 제한
  [섹션요약] 공개된 장소에 영상정보처리기기 설치 시 요건과 제한사항
  (원문 텍스트...)
```

### DB 스키마 변경

#### 신규 테이블

```sql
-- 태그 정의
CREATE TABLE tags (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL,
  color VARCHAR(7) DEFAULT '#6B7280',
  usage_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 문서 ↔ 태그 연결 (다대다)
CREATE TABLE document_tags (
  document_id INT REFERENCES documents(id) ON DELETE CASCADE,
  tag_id INT REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, tag_id)
);

CREATE INDEX idx_document_tags_doc ON document_tags(document_id);
CREATE INDEX idx_document_tags_tag ON document_tags(tag_id);
```

#### 기존 테이블 확장

```sql
-- documents 테이블
ALTER TABLE documents ADD COLUMN IF NOT EXISTS summary TEXT;
  -- 문서 전체 1~3줄 AI 요약
ALTER TABLE documents ADD COLUMN IF NOT EXISTS keywords TEXT[];
  -- AI 추출 핵심 키워드 5~10개
ALTER TABLE documents ADD COLUMN IF NOT EXISTS summary_embedding vector(1536);
  -- 문서 요약 벡터 (문서 단위 검색용)

-- document_sections 테이블
ALTER TABLE document_sections ADD COLUMN IF NOT EXISTS summary TEXT;
  -- 섹션별 1줄 AI 요약

-- document_chunks 테이블
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS enriched_text TEXT;
  -- 맥락 프리픽스 + 원문 (이걸로 embedding 생성)
```

### enriched_text 생성 로직

```javascript
function buildEnrichedText({
  chunkText, docTitle, docSummary, category,
  tags, keywords, sectionSummary, sectionMeta
}) {
  const parts = [];
  // 1) 문서 맥락
  parts.push(`[문서] ${docTitle}`);
  if (category) parts.push(`[분류] ${category}`);
  if (tags.length) parts.push(`[태그] ${tags.join(', ')}`);
  if (keywords.length) parts.push(`[키워드] ${keywords.join(', ')}`);
  // 2) 문서 요약
  if (docSummary) parts.push(`[문서요약] ${docSummary}`);
  // 3) 섹션 맥락
  const { label, chapter, section, articleTitle } = sectionMeta;
  if (chapter) parts.push(`[장] ${chapter}`);
  if (label) parts.push(`[조항] ${label}`);
  if (sectionSummary) parts.push(`[섹션요약] ${sectionSummary}`);
  // 4) 원문
  parts.push(chunkText);
  return parts.join('\n');
}
```

### 처리 파이프라인

```
문서 업로드/임포트
    ↓
1. 텍스트 추출 & 섹션 분할 (기존)
    ↓
2. AI 메타데이터 생성 (Gemini) ← 신규
   • 문서 전체 요약 → documents.summary
   • 키워드 추출 → documents.keywords
   • 섹션별 요약 → document_sections.summary
   • 태그 자동 추천 → tags + document_tags
    ↓
3. enriched 임베딩 생성 ← 핵심 변경
   • buildEnrichedText() 로 맥락 프리픽스 합성
   • enriched_text 저장 + embedding 벡터 저장
    ↓
4. 문서 요약 벡터 생성 ← 신규
   • documents.summary_embedding (문서 단위 검색용)
```

### 2단계 검색 (문서→청크)

```sql
-- 1단계: 관련 문서 찾기 (summary_embedding)
SELECT id, title, summary
FROM documents
WHERE summary_embedding IS NOT NULL
ORDER BY summary_embedding <=> $1::vector
LIMIT 5;

-- 2단계: 해당 문서 내 상세 청크 검색
SELECT dc.chunk_text, dc.enriched_text
FROM document_chunks dc
JOIN document_sections ds ON dc.section_id = ds.id
WHERE ds.document_id = ANY($2)
ORDER BY dc.embedding <=> $1::vector
LIMIT 10;
```

### 구현 순서

| 순서 | 작업 | 상태 |
|------|------|------|
| 1 | DB 마이그레이션 (테이블/컬럼 추가) | ✅ 완료 |
| 2 | AI 요약·키워드·태그 자동 생성 (`lib/doc-analyzer.js`) | ✅ 완료 |
| 3 | enriched_text 생성 + 임베딩 개선 (`lib/embeddings.js`) | ✅ 완료 |
| 4 | 업로드/임포트 파이프라인에 통합 (upload/law-import/url-import) | ✅ 완료 |
| 5 | 검색 API 태그 필터 + 요약 정보 반환 | ✅ 완료 |
| 6 | 태그 관리 API (`documents.js` 통합: addTag/removeTag/analyze) | ✅ 완료 |
| 7 | 기존 문서 일괄 재처리 스크립트 (`scripts/reindex-enriched.js`) | ✅ 완료 |
| 8 | 프론트엔드 UI (태그 표시/필터/분석 버튼) | 미구현 |

---

## 환경변수

```
# 필수
DATABASE_URL=postgresql://...
GEMINI_API_KEY=AI...

# AI API (선택적 — 해당 기능 사용 시 필요)
OPENAI_API_KEY=sk-...              # 임베딩, PDF 퀴즈 파싱
ANTHROPIC_API_KEY=sk-ant-...       # Claude OCR (폴백)

# 외부 서비스
LAW_API_OC=법제처API인증키          # 법령 임포트

# 인증
AUTH_TOKEN_SECRET=32자이상시크릿     # JWT 서명 키 (필수 설정 권장)

# OCR 엔진 (선택적)
OCR_SPACE_API_KEY=K...             # OCR.space 무료
CLOVA_OCR_SECRET=...               # 네이버 CLOVA
CLOVA_OCR_URL=...                  # 네이버 CLOVA 엔드포인트
GOOGLE_VISION_API_KEY=...          # Google Cloud Vision
AWS_ACCESS_KEY_ID=...              # AWS Textract
AWS_SECRET_ACCESS_KEY=...          # AWS Textract
AWS_TEXTRACT_REGION=ap-northeast-2 # AWS Textract 리전
```
