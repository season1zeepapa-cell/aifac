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

---

## 관리페이지 4개 탭 개선 계획 (2026-03-10)

> 관리페이지(`ApiDashboardTab`)의 대시보드 / API 키 / 사용량 / OCR 설정 탭에 대한 단계별 개선안

### 현재 상태 요약

| 탭 | 현재 기능 | 주요 한계 |
|----|-----------|-----------|
| 대시보드 | 기간별 총 호출/비용/에러 요약, 프로바이더별 막대 | 일별 추이 그래프 없음, 숫자만 나열 |
| API 키 | 키 상태/테스트/활성화/한도 관리 | 인라인 메시지 적용 완료, 한도 설정이 prompt()로 불편 |
| 사용량 | 모델별 사용 목록 + 에러 로그 | 합계 행 없음, 토큰 수 미표시, 일별 차트 없음 |
| OCR 설정 | 엔진 목록/우선순위/토글/테스트 | 테스트 결과 인라인 적용 완료, 일괄 테스트 없음 |

### 완료된 개선

- [x] **#1 — alert() → 인라인 메시지** (API 키 + OCR 테스트 결과)
- [x] **#2 — 마지막 확인 시각** (API 키 카드에 `last_checked` 표시)
- [x] **#3 — 활성 OCR 요약 카드** (OCR 탭 상단 현재 사용 엔진 체인 표시)

---

### 탭 1: 대시보드 개선

#### 1-A. 일별 추이 시각화 (우선)

| 항목 | 내용 |
|------|------|
| 현재 | `dailyTrend` 데이터를 API에서 받지만 UI에 표시 안 함 |
| 개선 | 7일간 프로바이더별 호출 수/비용을 **간이 바 차트**로 표시 |
| 구현 방법 | CSS `div` 기반 스택 바 차트 (외부 라이브러리 없이 구현 가능) |
| 대안 | Chart.js CDN 사용 시 라인/바 차트 더 깔끔하게 가능 |

```
목표 UI:
┌─────────────────────────────┐
│ 일별 추이 (최근 7일)           │
│                              │
│  3/4  ██░░░░░░░░  12회 $0.02 │
│  3/5  ████░░░░░░  28회 $0.05 │
│  3/6  ██████████  45회 $0.12 │
│  ...                         │
└─────────────────────────────┘
```

- [x] `dailyTrend` 데이터를 날짜별로 그룹핑
- [x] 프로바이더별 색상 스택 표시
- [x] 호출 수 + 비용 라벨 우측 표시

#### 1-B. 요약 카드 보강

| 항목 | 내용 |
|------|------|
| 현재 | 총 호출, 예상 비용, 에러 3개 카드 |
| 개선 | **전일 대비 변화량** 표시 (↑12%, ↓5% 등) |
| 추가 카드 | 활성 키 수 / 총 토큰 사용량 |

- [x] 전일 대비 증감률 계산 로직 추가 (API 측에서 전일 데이터 함께 반환)
- [ ] 총 토큰(입력+출력) 요약 카드 추가 — 합계 행에서 확인 가능
- [ ] 활성 API 키 수 / 전체 키 수 표시

#### 1-C. 빠른 상태 인디케이터

- [ ] 각 프로바이더 옆에 초록/빨강 점으로 현재 활성 상태 한눈에 표시
- [ ] 크레딧 소진 프로바이더는 빨간색 경고 배지 자동 표시

---

### 탭 2: API 키 관리 개선

#### 2-A. 한도 설정 UI 개선 (우선)

| 항목 | 내용 |
|------|------|
| 현재 | `prompt()`로 숫자 입력 → 불편하고 모바일에서 사용성 낮음 |
| 개선 | 카드 내 **인라인 숫자 입력 필드** + 저장 버튼 |

```
목표 UI:
┌──────────────────────────────┐
│ OpenAI                [활성]  │
│ 호출: 15   비용: $0.0234      │
│                              │
│ 일일 한도: [____100___] [저장] │
│ ████████░░░░░░  15/100       │
└──────────────────────────────┘
```

- [x] `editingLimit` 상태 추가 (프로바이더별 편집 모드)
- [x] 한도 클릭 → 인라인 input 전환
- [x] Enter 또는 저장 버튼으로 반영

#### 2-B. 키 설정 가이드

- [x] 미설정 키에 환경변수명 + 용도 안내 표시
- [x] 각 프로바이더별 환경변수명 + 용도 설명
- [x] 예: `OPENAI_API_KEY` → "임베딩 + GPT-4o 퀴즈 파싱"

#### 2-C. 일괄 테스트

- [x] "전체 키 테스트" 버튼 추가 (설정된 키 순차 테스트)
- [x] 진행 상황 표시 (예: "2/4 테스트 중...")
- [x] 결과 요약 (성공 3개, 실패 1개)

---

### 탭 3: 사용량 상세 개선

#### 3-A. 합계 행 추가 (우선)

| 항목 | 내용 |
|------|------|
| 현재 | 모델별 목록만 나열, 총합 없음 |
| 개선 | 목록 하단에 **합계 행** (총 호출, 총 토큰, 총 비용) |

```
목표 UI:
┌──────────────────────────────────┐
│ 모델별 사용량                      │
│                                   │
│ openai  gpt-4o       3회  $0.015  │
│ gemini  2.5-flash    42회 $0.000  │
│ upstage ocr          8회  $0.000  │
│ ──────────────────────────────── │
│ 합계                  53회 $0.015  │
│ 토큰: 입력 12,340 / 출력 8,210    │
└──────────────────────────────────┘
```

- [x] `usageByModel` 배열의 합계 계산
- [x] 합계 행 UI (볼드체, 상단 구분선)
- [x] 토큰 입력/출력 합계 표시

#### 3-B. 일별 추이 차트

- [ ] 대시보드의 `dailyTrend` 데이터를 사용량 탭에도 공유 표시
- [ ] 날짜별 호출 수 + 비용 그래프
- [ ] 프로바이더별 색상 구분

#### 3-C. 사용량 내보내기

- [x] CSV 다운로드 버튼 (모델별 사용량 데이터, BOM 포함 UTF-8)
- [x] 기간 범위 포함된 파일명 자동 생성
- [x] 합계 행 포함

#### 3-D. 에러 로그 필터

- [x] 프로바이더별 필터 버튼
- [ ] 에러 유형별 필터 (credit_exhausted, timeout, etc.)
- [ ] 에러 메시지 전체 보기 (현재 200자 절단 → 클릭 시 펼침)

---

### 탭 4: OCR 설정 개선

#### 4-A. 일괄 테스트 (우선)

| 항목 | 내용 |
|------|------|
| 현재 | 엔진별 개별 테스트만 가능 |
| 개선 | "전체 엔진 테스트" 버튼으로 사용 가능한 엔진 한번에 테스트 |

- [x] "전체 테스트" 버튼 (활성화+사용 가능 엔진 대상)
- [x] 순차 실행 + 진행률 표시 (1/4, 2/4...)
- [x] 결과 요약 카드 (성공 N개, 실패 N개)

#### 4-B. OCR 사용 통계

- [x] 최근 7일 OCR 엔진별 호출 수 / 성공률 표시
- [x] `api_usage` 테이블에서 endpoint='ocr'인 데이터 집계
- [ ] 폴백 발생 횟수 표시 (1순위 실패 → 2순위 성공 케이스)

```
목표 UI:
┌──────────────────────────────────┐
│ 최근 7일 OCR 사용 현황             │
│                                   │
│ Upstage OCR    45회  성공률 98%   │
│ Gemini Vision  3회   성공률 100%  │
│ (폴백 발생: 1회)                   │
└──────────────────────────────────┘
```

#### 4-C. 엔진 설정 상세

- [ ] 엔진 카드 클릭 시 상세 설정 패널 확장
- [ ] 엔진별 고유 설정 (OCR.space: 언어, Gemini: 모델 선택 등)
- [ ] 엔진별 비용 정보 / 일일 한도 표시

#### 4-D. 드래그 앤 드롭 순서 변경

| 항목 | 내용 |
|------|------|
| 현재 | 위/아래 화살표로 1칸씩 이동 |
| 개선 | 드래그 앤 드롭으로 직관적 순서 변경 |
| 난이도 | 중 (HTML5 Drag and Drop API 또는 터치 지원 필요) |

- [x] 드래그 가능한 카드 (cursor-grab)
- [x] 드래그 중 시각 피드백 (원본 투명화 + 드롭 대상 파란색 강조)
- [ ] 모바일 터치 드래그 지원 (HTML5 DnD는 모바일 미지원, 화살표 버튼으로 대체)

---

### 구현 우선순위

| 순위 | 항목 | 탭 | 상태 |
|------|------|-----|------|
| 1 | 일별 추이 시각화 | 대시보드 | ✅ Phase 2 |
| 2 | 합계 행 추가 | 사용량 | ✅ Phase 1 |
| 3 | 한도 설정 인라인 UI | API 키 | ✅ Phase 1 |
| 4 | 일괄 테스트 (키+OCR) | API 키, OCR | ✅ Phase 2 |
| 5 | 요약 카드 보강 (전일 비교) | 대시보드 | ✅ Phase 3 |
| 6 | OCR 사용 통계 | OCR | ✅ Phase 3 |
| 7 | 사용량 내보내기 (CSV) | 사용량 | ✅ Phase 1 |
| 8 | 에러 로그 필터 | 사용량 | ✅ Phase 1 |
| 9 | 키 설정 가이드 | API 키 | ✅ Phase 2 |
| 10 | 드래그 앤 드롭 | OCR | ✅ Phase 4 |

### 구현 완료 이력

```
Phase 1 ✅ (4960488) — 프론트만 수정
  ├── #2 합계 행 추가 (사용량)
  ├── #3 한도 설정 인라인 UI (API 키)
  ├── #7 CSV 내보내기 (사용량)
  └── #8 에러 로그 필터 (사용량)

Phase 2 ✅ (fa16665) — 프론트 + 약간의 가공
  ├── #1 일별 추이 시각화 (대시보드)
  ├── #4 일괄 테스트 (API 키 + OCR)
  └── #9 키 설정 가이드 (API 키)

Phase 3 ✅ (13d7c9a) — API 수정 포함
  ├── #5 요약 카드 보강 (대시보드, 전일 비교 API)
  └── #6 OCR 사용 통계 (OCR, api_usage 쿼리)

Phase 4 ✅ (fec24f6) — 드래그 앤 드롭
  └── #10 드래그 앤 드롭 순서 변경 (OCR)
```

### 미구현 잔여 항목

- [ ] 에러 유형별 필터 (credit_exhausted, timeout 등)
- [ ] 에러 메시지 클릭 시 전체 펼침
- [ ] 폴백 발생 횟수 표시
- [ ] 엔진별 상세 설정 패널
- [ ] 모바일 터치 드래그 (현재 화살표 버튼으로 대체)
- [ ] 총 토큰/활성 키 수 요약 카드 추가

---

## 종합 코드 리뷰 — 보안 / 리팩토링 / 기능 확장 (2026-03-10)

> 전체 코드베이스(11개 API, 21개 lib 파일, SPA 프론트엔드)를 정밀 분석한 결과

---

### Part 1: 보안 취약점

#### 🔴 CRITICAL — 즉시 조치 필요

| # | 항목 | 위치 | 설명 | 조치 방안 |
|---|------|------|------|-----------|
| S1 | JWT 서명 timing-safe 미적용 | `lib/auth.js:54` | `expectedSig !== parts[2]` 일반 비교 → 타이밍 공격 가능 | `crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(parts[2]))` 적용 |
| S2 | URL Import 무한 리다이렉트 | `api/url-import.js:29` | `fetchUrl` 재귀 호출에 횟수 제한 없음 → 서버리스 타임아웃 | `maxRedirects = 5` 파라미터 추가 |
| S3 | 리다이렉트 SSRF 우회 | `api/url-import.js:29` | 리다이렉트된 URL에 `validateUrl()` 재검증 없음 → 내부 IP 접근 가능 | 리다이렉트마다 `validateUrl()` 재실행 |

#### 🟠 HIGH — 조기 개선 권장

| # | 항목 | 위치 | 설명 | 조치 방안 |
|---|------|------|------|-----------|
| S4 | 비밀번호 해싱 SHA-256 | `lib/auth.js:77` | 범용 해시 함수, GPU brute-force 취약 | `bcrypt` 또는 `scrypt`로 전환 |
| S5 | Rate Limiter 서버리스 무력화 | `lib/rate-limit.js` | 인메모리 Map → Vercel 인스턴스마다 리셋 | Redis(Upstash) 또는 DB 기반 카운터 |
| S6 | emptyTrash 트랜잭션 미사용 | `api/documents.js:202-216` | N+1 삭제 + 중간 실패 시 불일치 상태 | BEGIN/COMMIT 트랜잭션 + 배치 DELETE |
| S7 | 로그인 브루트포스 방어 없음 | `api/login.js` | 로그인 시도 횟수 제한 없음 | login 엔드포인트 rate limit 추가 (예: 5회/분) |

#### 🟡 MEDIUM — 점진적 개선

| # | 항목 | 위치 | 설명 | 조치 방안 |
|---|------|------|------|-----------|
| S8 | Gemini API 키 URL 노출 | `api/rag.js:20` 외 4곳 | `?key=${apiKey}` → 로그/에러 트레이스 노출 | `x-goog-api-key` HTTP 헤더로 전달 |
| S9 | DNS Rebinding 공격 | `lib/input-sanitizer.js:97-112` | DNS 조회 → HTTP 요청 사이 DNS 변경 가능 (TOCTOU) | 커스텀 DNS resolver로 요청 시점 재검증 |
| S10 | RegExp 인젝션 | `lib/pdf-extractor.js` | 사용자 구분자를 `new RegExp()`에 직접 전달 → ReDoS | 특수문자 이스케이프 (`escapeRegExp()`) |

#### ✅ 양호한 부분 (변경 없음)

| 항목 | 근거 |
|------|------|
| SQL Injection | 모든 쿼리가 `$1` 파라미터 바인딩 |
| 비밀번호 비교 | `crypto.timingSafeEqual` 적용됨 |
| CORS 도메인 제한 | `lib/cors.js`에 화이트리스트 구현됨 |
| 파일명 정화 | `sanitizeFilename()` — path traversal, null byte 방어 |
| ILIKE 이스케이프 | `escapeIlike()` — 와일드카드 인젝션 방어 |
| SSRF 방어 | DNS 확인 + 내부 IP 블럭리스트 + 호스트 블럭리스트 |
| 에러 메시지 분리 | `error-handler.js` — 프로덕션/개발 에러 메시지 분기 |
| 보안 헤더 | `vercel.json` + `cors.js`에 HSTS, X-Frame-Options 등 설정 |
| 파일 업로드 검증 | MIME 화이트리스트 + 50MB 크기 제한 |

---

### Part 2: 리팩토링 제안

#### 구조적 개선 (중복 제거 / 모듈화)

| # | 항목 | 현재 | 개선안 | 영향 범위 |
|---|------|------|--------|-----------|
| R1 | `callGemini` 4곳 중복 | `rag.js`, `summary.js`, `doc-analyzer.js`, `gemini-vision.js` 각각 정의 | `lib/gemini.js` 공통 모듈 1개로 통합 | 모델명 변경 시 1곳만 수정 (이전에 5곳 수정 경험) |
| R2 | 임베딩 생성 로직 중복 | `upload.js:184-215`와 `url-import.js:189-217` 거의 동일 | `lib/embeddings.js`에 `createEmbeddingsForDocument(docId)` 추출 | 업로드/URL임포트/법령임포트 공통 사용 |
| R3 | 휴지통 삭제 로직 중복 | `documents.js` 단건/전체 삭제 동일 패턴 반복 | `deleteDocumentPermanently(docId)` 함수 추출 | N+1 → 배치 처리도 가능 |
| R4 | 에러 핸들러 lazy require | 여러 catch에서 `require('../lib/error-handler')` | 파일 상단에서 한 번 import | 코드 정리 |

#### 코드 품질

| # | 항목 | 위치 | 개선안 |
|---|------|------|--------|
| R5 | `parseInt` radix 미지정 | `search.js:25`, `url-import.js` 등 | `parseInt(value, 10)` 명시 |
| R6 | `paramIdx` 수동 관리 | `search.js`, `rag.js`, `api-usage.js` | 쿼리 빌더 헬퍼 함수 도입 고려 |
| R7 | index.html 5000줄+ | 단일 SPA 파일 | 컴포넌트별 `<script src>` 분리 또는 빌드 도구 도입 |

#### 구현 우선순위

```
1순위: R1 — callGemini 공통화 (리팩토링 효과 최대, 과거 5곳 수정 재발 방지)
2순위: R2 — 임베딩 로직 통합 (3곳 중복 해소)
3순위: R3 — 삭제 로직 추출 (트랜잭션 적용과 함께)
4순위: R4~R6 — 사소한 코드 정리 (점진적 개선)
5순위: R7 — SPA 분할 (큰 작업, 장기 계획)
```

---

### Part 3: 기능 확장 추천

#### 🥇 높은 우선순위 — 현재 기능의 자연스러운 확장

| # | 기능 | 설명 | 근거 |
|---|------|------|------|
| F1 | 대화형 RAG 채팅 | 현재 1회성 Q&A → 이전 대화 맥락을 포함한 멀티턴 채팅 | RAG API 이미 존재, 대화 히스토리(배열)만 추가 |
| F2 | 문서 버전 관리 | 동일 문서 재업로드 시 diff 표시 + 이전 버전 보관 | 법령은 개정이 잦아 버전 추적 필수 |
| F3 | 문서 비교 | 두 문서(또는 두 버전) 간 차이점 AI 분석 | 법령 신/구 조문 대조에 유용 |
| F4 | 북마크 / 하이라이트 | 섹션별 북마크 + 텍스트 하이라이트 저장 | 중요 조문 빠른 접근, DB 테이블 1개 추가 |

#### 🥈 중간 우선순위

| # | 기능 | 설명 | 근거 |
|---|------|------|------|
| F5 | 법령 개정 알림 | 임포트된 법령을 주기적으로 법제처 API 체크 → 변경 시 알림 | 법령 관리 핵심 가치, CRON 또는 수동 체크 |
| F6 | 공유 링크 | 특정 문서/섹션을 외부에 읽기전용 공유 (토큰 기반) | 협업 시 유용, 별도 인증 없이 접근 |
| F7 | 내보내기 | 문서를 PDF/DOCX/Markdown으로 변환 다운로드 | 보고서 작성 지원 |
| F8 | 일괄 업로드 | 여러 파일 동시 업로드 + 진행 표시 | UX 개선, multer `.array()` 활용 |
| F9 | 사용자별 권한 분리 | 현재 admin-only → viewer/editor/admin 역할 | 다중 사용자 환경 대비 |
| F10 | 검색 결과 하이라이팅 | 검색어 위치를 시각적으로 강조 표시 | 검색 UX 개선 |

#### 🥉 장기 과제

| # | 기능 | 설명 |
|---|------|------|
| F11 | 웹훅/외부 API | 외부 시스템에서 문서 등록/검색 API 호출 (API 키 인증) |
| F12 | Slack/Teams 봇 | 메신저에서 직접 법령 질문 → RAG 답변 |
| F13 | 문서 관계 그래프 | 법령 간 참조 관계를 시각적 그래프로 표시 (이미 참조 데이터 파싱 중) |
| F14 | SSE 실시간 진행 | 업로드/임베딩/분석 진행 상황을 실시간 스트리밍 |
| F15 | 감사 로그 | 누가 언제 어떤 문서를 조회/수정했는지 기록 (`audit_log` 테이블) |
| F16 | 멀티 LLM 선택 | RAG/요약에 OpenAI, Claude, Gemini 중 선택 가능 |

---

### 보안 + 리팩토링 + 기능 확장 종합 실행 순서

```
=== 즉시 (보안) ===
1. S1 — JWT 서명 timingSafeEqual 적용 (1줄 수정)
2. S2+S3 — URL Import 리다이렉트 제한 + SSRF 재검증
3. S7 — 로그인 rate limit 추가

=== 단기 (리팩토링) ===
4. R1 — callGemini 공통 모듈화 (lib/gemini.js)
5. R2 — 임베딩 생성 로직 통합
6. R3 — 삭제 로직 추출 + 트랜잭션

=== 중기 (기능) ===
7. F1 — 대화형 RAG 채팅
8. F2 — 문서 버전 관리
9. F5 — 법령 개정 알림

=== 장기 (확장) ===
10. F3 — 문서 비교
11. F13 — 문서 관계 그래프
12. F15 — 감사 로그
```

---

## 코드베이스 2차 분석 보고서 (2026-03-10)

> 이전 분석 이후 구현된 보안 패치, 리팩토링, 신규 기능을 반영한 최신 분석
> 이미 해결된 항목은 ✅로 표시

---

### 이전 분석 대비 해결 현황

| 이전 ID | 항목 | 상태 |
|---------|------|------|
| S1 | JWT 서명 timingSafeEqual | ✅ 해결 (`lib/auth.js:54-57`) |
| S2 | URL Import 무한 리다이렉트 | ✅ 해결 (`maxRedirects=5` 추가) |
| S3 | 리다이렉트 SSRF 우회 | ✅ 해결 (리다이렉트마다 `validateUrl()` 재검증) |
| S4 | 비밀번호 해싱 SHA-256 | ✅ 해결 (scrypt 전환, 레거시 하위호환) |
| S7 | 로그인 브루트포스 | ✅ 해결 (IP 기준 1분 5회 제한) |
| S8 | Gemini API 키 URL 노출 | ✅ 해결 (`x-goog-api-key` 헤더로 전환, 5곳) |
| R2 | 임베딩 생성 로직 중복 | ✅ 해결 (`createEmbeddingsForDocument()` 추출) |
| R3 | 휴지통 삭제 로직 중복 | ✅ 해결 (`deleteDocumentPermanently()` 추출) |
| R4 | error-handler lazy require | ✅ 해결 (10개 API 파일 상단 import 통일) |
| F1 | 대화형 RAG 채팅 | ✅ 해결 (ChatTab 신규, 멀티턴 히스토리) |
| F14 | SSE 실시간 진행 | ✅ 해결 (시뮬레이션 기반 프로그레스바) |
| F16 | 멀티 LLM 선택 | ✅ 해결 (Gemini/OpenAI/Claude 3사, LLM 설정 탭) |

---

### Part 1: 보안 취약점 (미해결 + 신규)

#### 🔴 CRITICAL

| # | 항목 | 위치 | 설명 | 조치 방안 |
|---|------|------|------|-----------|
| S11 | DB SSL 인증서 미검증 | `lib/db.js:11` | `rejectUnauthorized: false` → MITM 공격으로 DB 자격증명 탈취 가능 | `ssl: { rejectUnauthorized: true, ca: process.env.DB_SSL_CA }` |
| S12 | Rate Limiter 서버리스 무력화 | `lib/rate-limit.js` | 인메모리 Map → Vercel 콜드 스타트마다 초기화 → 로그인 5회 제한이 실질적으로 무효 | Upstash Redis 또는 DB 기반 카운터 전환 |
| S13 | emptyTrash 트랜잭션 미사용 | `api/documents.js:206-209` | `for` 루프 내 개별 삭제 → 중간 실패 시 불일치 상태 + N×5 쿼리 | `BEGIN/COMMIT` + 배치 DELETE (`ANY($1)`) |

#### 🟠 HIGH

| # | 항목 | 위치 | 설명 | 조치 방안 |
|---|------|------|------|-----------|
| S14 | RegExp ReDoS | `lib/pdf-extractor.js` | 사용자 `customDelimiter`를 `new RegExp()`에 직접 전달 → 악의적 패턴으로 CPU 고갈 | `escapeRegExp()` 함수 적용 |
| S15 | 대용량 OCR 메모리 소진 | `lib/ocr.js:26-46` | 50MB 이미지 → base64 인코딩 (1.33배) → 메모리 66MB+ → 서버리스 128MB 한계 초과 | 스트림 기반 업로드 또는 파일 크기 사전 검증 (이미지 10MB 제한) |
| S16 | 24시간 누적 로그인 제한 없음 | `api/login.js` | 1분 5회 제한만 있고 일일 한도 없음 → 1분 대기 후 재시도 반복 가능 | 24시간 IP당 50회 상한 추가 |
| S17 | 요약 API 동시 호출 제한 없음 | `api/summary.js` | 전체 요약(bulk) 호출 시 동시 Gemini 요청 무제한 → API 비용 폭주 | 동시 요청 5개 제한 (세마포어) |

#### 🟡 MEDIUM

| # | 항목 | 위치 | 설명 | 조치 방안 |
|---|------|------|------|-----------|
| S18 | DNS Rebinding (기존 S9) | `lib/input-sanitizer.js` | DNS 조회 → HTTP 요청 사이 DNS 변경 가능 | 커스텀 DNS resolver로 요청 시점 재검증 |
| S19 | parseInt radix 미지정 | `api/search.js:26`, `api/rag.js:49` | `parseInt(value)` → 8진수/16진수 해석 위험 | `parseInt(value, 10)` 명시 |
| S20 | console.log 민감정보 | 다수 API | 에러 로그에 `err.stack` 포함 → API 키/쿼리 노출 가능 | 구조화된 로깅 + 민감정보 마스킹 |
| S21 | 보안 헤더 미설정 | `vercel.json` | CSP, X-Frame-Options, HSTS 등 없음 | `vercel.json` headers 섹션 추가 |

---

### Part 2: 리팩토링 필요 사항

#### 🔴 우선 리팩토링

| # | 항목 | 위치 | 현황 | 개선안 |
|---|------|------|------|--------|
| R5 | 요약 순차 처리 | `api/summary.js:88-106` | 100 섹션 × 2초 = 200초 → 300초 타임아웃 초과 | `Promise.allSettled()` + 동시 5개 제한 (세마포어) |
| R6 | 법령 임포트 N+1 INSERT | `api/law-import.js:103-123` | 1000 조문 = 1000 개별 INSERT | 다중행 INSERT (`VALUES ($1,$2), ($3,$4)...`) |
| R7 | 휴지통 비우기 N+1 삭제 | `api/documents.js:206-209` | `for` 루프 내 `deleteDocumentPermanently()` 개별 호출 | 배치 함수: `deleteDocumentsPermanently(docIds[])` |
| R8 | 태그 조회 N+1 | `api/documents.js:157-167` | 문서 목록 조회 후 태그를 별도 쿼리로 매핑 | `jsonb_agg` 서브쿼리로 단일 쿼리 통합 |

#### 🟡 개선 리팩토링

| # | 항목 | 위치 | 현황 | 개선안 |
|---|------|------|------|--------|
| R9 | 쿼리 빌더 수동 paramIdx | `api/search.js`, `api/rag.js` | 매번 `$${paramIdx}` 수동 관리 → 실수 위험 | 간단한 `QueryBuilder` 헬퍼 함수 |
| R10 | callGemini 호출 옵션 분산 | `api/rag.js`, `api/summary.js`, `lib/doc-analyzer.js` | 각 파일에서 개별 옵션 구성 | `callLLM()` 공통 래퍼에 기본값 통합 |
| R11 | 프론트엔드 컴포넌트 비대화 | `index.html` (5000줄+) | 단일 파일에 모든 컴포넌트 → 유지보수 어려움 | 논리적 섹션 주석 분리 (현재도 양호), 장기적으로 빌드 도구 도입 검토 |
| R12 | 역참조 계산 O(n²) | `api/law-import.js:127-135` | 모든 조문 × 참조 목록 순회 | `Map<조문ID, 참조자[]>` 해시 맵 사용 (현재도 유사하지만 최적화 가능) |

---

### Part 3: 성능 개선 + 기능 개선

#### 성능 개선

| # | 항목 | 위치 | 현재 성능 | 개선 후 | 개선율 |
|---|------|------|-----------|---------|--------|
| P1 | 요약 병렬화 | `api/summary.js` | 100섹션 × 2초 = 200초 | 20묶음 × 2초 = 40초 | **80% 단축** |
| P2 | 법령 배치 INSERT | `api/law-import.js` | 1000 쿼리 | 1 쿼리 | **1000배** |
| P3 | 휴지통 배치 삭제 | `api/documents.js` | N × 5 쿼리 | 5 쿼리 | **N배** |
| P4 | 태그 JOIN 통합 | `api/documents.js` | 1 + N 쿼리 | 1 쿼리 | **N+1 제거** |
| P5 | 검색 결과 캐싱 | `api/search.js` | 매번 벡터 계산 | 동일 쿼리 1분 캐시 | **반복 검색 즉시 응답** |
| P6 | 문서 목록 페이징 API | `api/documents.js` | 전체 목록 반환 | `LIMIT/OFFSET` 서버 페이징 | **초기 로드 시간 단축** |

#### 기능 개선 (UX)

| # | 항목 | 설명 | 효과 |
|---|------|------|------|
| UX1 | 문서 메타 수정 | 제목/카테고리 인라인 편집 API (`action: 'updateMeta'`) | 삭제 후 재업로드 불필요 |
| UX2 | 임베딩 재생성 버튼 | 실패한 임베딩 수동 재시도 | 검색 누락 방지 |
| UX3 | 검색 결과 하이라이팅 | 검색어 위치 `<mark>` 태그 | 검색 결과 가독성 향상 |
| UX4 | 일괄 업로드 | 여러 파일 동시 드래그앤드롭 | 초기 구축 시간 단축 |
| UX5 | 다크모드 | CSS 변수 기반 테마 토글 | 야간 사용 편의 |
| UX6 | 키보드 단축키 | `Ctrl+K` 검색, `Ctrl+N` 업로드 | 파워 유저 효율 |

---

### Part 4: 추가 기능 + 확장 제안

#### 단기 (1~2주)

| # | 항목 | 설명 | 구현 난이도 | 예상 효과 |
|---|------|------|------------|-----------|
| F17 | 대화 히스토리 저장 | 채팅 대화를 DB에 저장하여 세션 간 유지 (`chat_sessions` 테이블) | 중 | RAG 활용도 향상 |
| F18 | 문서 즐겨찾기 | 자주 참조하는 문서 핀 고정 | 하 | 접근 편의성 |
| F19 | 검색 자동완성 | 기존 검색어/문서 제목 기반 서제스트 | 중 | 검색 UX 향상 |
| F20 | 요약 캐시 무효화 | 섹션 수정/재업로드 시 요약 자동 삭제 | 하 | 데이터 정합성 |
| F21 | 업로드 진행률 실시간 | 대용량 파일 업로드 시 바이트 기준 진행률 | 중 | UX 개선 |

#### 중기 (1~2개월)

| # | 항목 | 설명 | 구현 난이도 | 예상 효과 |
|---|------|------|------------|-----------|
| F22 | 문서 버전 관리 | 동일 문서 재업로드 시 버전 이력 보존 + diff | 고 | 법령 개정 추적 |
| F23 | 공유 링크 | 읽기 전용 토큰 기반 공유 URL 생성 | 중 | 외부 협업 지원 |
| F24 | 내보내기 | 문서를 PDF/DOCX/마크다운으로 다운로드 | 중 | 보고서 작성 편의 |
| F25 | 알림 시스템 | 임베딩 완료/분석 완료 시 브라우저 알림 | 중 | 대기 시간 활용 |
| F26 | 문서 비교 | 두 문서 또는 법령 버전 간 diff 표시 | 고 | 법령 개정 분석 |

#### 장기 (3개월+)

| # | 항목 | 설명 | 구현 난이도 | 예상 효과 |
|---|------|------|------------|-----------|
| F27 | 참조 관계 그래프 | 법령 조문 간 참조를 D3.js 네트워크 그래프로 시각화 | 고 | 법률 구조 이해도 향상 |
| F28 | 감사 로그 | `audit_log` 테이블로 모든 CRUD 기록 | 중 | 보안 추적 + 규정 준수 |
| F29 | 다중 사용자 권한 | viewer/editor/admin 역할 분리 + 문서별 접근 제어 | 고 | 팀 환경 지원 |
| F30 | Webhook 연동 | 문서 업로드/분석 완료 시 외부 서비스 알림 | 중 | 자동화 파이프라인 |
| F31 | RAG 에이전트 | 복수 문서 교차 참조 + 근거 체인 자동 구성 | 매우 고 | AI 법률 분석 도구로 확장 |
| F32 | 모바일 앱 (PWA) | 오프라인 캐시 + 푸시 알림 + 홈 화면 설치 | 중 | 모바일 접근성 |

---

### 종합 실행 로드맵

```
=== 즉시 (보안) ===
1. S11 — DB SSL 인증서 검증 (lib/db.js 1줄 수정)
2. S14 — RegExp escapeRegExp 적용 (pdf-extractor.js)
3. S21 — vercel.json 보안 헤더 추가

=== 1주차 (성능) ===
4. R5  — 요약 병렬화 (Promise.allSettled + 세마포어)
5. R6  — 법령 배치 INSERT
6. R7  — 휴지통 배치 삭제 + 트랜잭션

=== 2주차 (리팩토링) ===
7. R8  — 태그 조회 JOIN 통합
8. R9  — 쿼리 빌더 헬퍼
9. S19 — parseInt radix 통일

=== 3주차 (기능) ===
10. UX1 — 문서 메타 수정 API
11. F17 — 대화 히스토리 DB 저장
12. UX3 — 검색 결과 하이라이팅

=== 1개월+ (확장) ===
13. F22 — 문서 버전 관리
14. F26 — 문서 비교
15. F27 — 참조 관계 그래프
```

---

## E2E 테스트 보고서 (2026-03-10)

### 개요

Playwright CLI를 사용하여 배포된 DocStore 웹 애플리케이션(`https://docstore-eight.vercel.app`)에 대한 End-to-End 테스트를 구축하고 실행하였다.

### 테스트 환경

| 항목 | 값 |
|------|-----|
| 테스트 프레임워크 | Playwright (`@playwright/test`) |
| 브라우저 | Chromium (headless) |
| 대상 URL | `https://docstore-eight.vercel.app` |
| 뷰포트 | 390 x 844 (모바일 퍼스트) |
| 인증 방식 | `global-setup.js`로 1회 로그인 → `storageState` 재사용 |
| 실행 모드 | 워커 1개 순차 실행 (rate limit 5회/분 방어) |

### 파일 구조

```
workspace/docstore/
├── playwright.config.js          # 테스트 설정 (프로젝트, 인증, 뷰포트)
├── tests/
│   ├── global-setup.js           # 전역 로그인 → storageState 저장
│   ├── login.spec.js             # 로그인 화면 테스트 (4개)
│   ├── navigation.spec.js        # 탭 네비게이션 테스트 (5개)
│   ├── documents.spec.js         # 문서 목록 탭 테스트 (3개)
│   ├── search.spec.js            # 검색 기능 테스트 (3개)
│   └── chat.spec.js              # AI 채팅 UI 테스트 (6개)
│   └── .auth/                    # 인증 상태 저장 (gitignore)
```

### 실행 방법

```bash
# 전체 테스트 실행
TEST_ID=<아이디> TEST_PW=<비밀번호> npx playwright test

# 특정 파일만 실행
TEST_ID=<아이디> TEST_PW=<비밀번호> npx playwright test tests/login.spec.js

# 브라우저 보면서 실행 (디버깅)
TEST_ID=<아이디> TEST_PW=<비밀번호> npx playwright test --headed

# HTML 리포트 확인
npx playwright show-report
```

### 테스트 결과

총 **21개 테스트** | **20 통과** | **1 스킵** | **28.7초**

#### 로그인 화면 (login.spec.js) — 4/4 통과

| 테스트명 | 결과 | 소요시간 |
|---------|------|---------|
| 로그인 페이지가 정상 로드된다 | ✅ | 1.4s |
| 빈 입력으로 로그인 시 에러 메시지가 표시된다 | ✅ | 1.4s |
| 잘못된 계정으로 로그인 시 에러가 표시된다 | ✅ | 1.7s |
| 정상 로그인 시 메인 화면으로 이동한다 | ✅ | 1.8s |

#### AI 채팅 (chat.spec.js) — 5/6 통과, 1 스킵

| 테스트명 | 결과 | 소요시간 |
|---------|------|---------|
| 채팅 UI 요소가 모두 표시된다 | ✅ | 990ms |
| 하단 상태바에 모델 버전이 표시된다 | ✅ | 1.1s |
| 설정 버튼으로 프로바이더를 변경할 수 있다 | ✅ | 1.9s |
| 예시 질문 버튼들이 표시된다 | ✅ | 1.0s |
| 문서 범위 정보가 상태바에 표시된다 | ✅ | 964ms |
| 질문을 전송하면 AI 답변이 표시된다 | ⏭️ 스킵 | — (API 비용 발생 방지) |

#### 문서 목록 (documents.spec.js) — 3/3 통과

| 테스트명 | 결과 | 소요시간 |
|---------|------|---------|
| 문서 카드가 표시된다 | ✅ | 1.2s |
| 문서가 5개 이상이면 더보기 버튼이 표시된다 | ✅ | 1.2s |
| 등록 탭의 업로드 영역이 표시된다 | ✅ | 1.2s |

#### 탭 네비게이션 (navigation.spec.js) — 5/5 통과

| 테스트명 | 결과 | 소요시간 |
|---------|------|---------|
| 하단 네비게이션에 5개 탭이 표시된다 | ✅ | 1.0s |
| 문서 목록 탭으로 전환된다 | ✅ | 1.2s |
| 검색 탭으로 전환된다 | ✅ | 940ms |
| AI 채팅 탭으로 전환된다 | ✅ | 982ms |
| 관리 탭으로 전환된다 | ✅ | 1.3s |

#### 검색 기능 (search.spec.js) — 3/3 통과

| 테스트명 | 결과 | 소요시간 |
|---------|------|---------|
| 검색 UI 요소가 모두 표시된다 | ✅ | 946ms |
| 텍스트 검색이 실행되고 결과가 표시된다 | ✅ | 2.1s |
| 문서 범위 멀티 선택이 동작한다 | ✅ | 998ms |

### 구현 시 해결한 문제

| 문제 | 원인 | 해결 |
|------|------|------|
| 대량 로그인 실패 | 5개 워커 병렬 로그인 → rate limit (5회/분) 초과 | `global-setup.js`로 1회 로그인 후 `storageState` 재사용 |
| 검색 버튼 선택자 충돌 | `getByRole('button', { name: '검색' })` → nav 탭 + main 버튼 2개 매칭 | `getByRole('main').getByRole('button', { name: '검색', exact: true })` |
| login.spec에서 이미 로그인됨 | global-setup이 저장한 storageState가 적용됨 | `beforeEach`에서 `localStorage.clear()` + `reload()` |
| 채팅 프로바이더 선택자 불일치 | "OpenAI" 별도 버튼이 아닌 하단 상태바에 `Gemini (gemini-2.5-flash)` 형태 | 스크린샷 확인 후 실제 UI에 맞게 선택자 수정 |

### 테스트 커버리지 및 향후 확장

**현재 커버리지**: UI 요소 존재 확인 + 탭 전환 + API 응답 상태 검증

**향후 추가 가능 테스트**:

| 우선순위 | 테스트 영역 | 설명 |
|---------|------------|------|
| 높음 | 파일 업로드 | PDF/DOCX 업로드 → 문서 생성 확인 (로컬 전용) |
| 높음 | 문서 삭제/복원 | 휴지통 이동 → 복원 → 영구 삭제 흐름 |
| 중간 | 벡터 검색 | 의미 검색 모드 전환 + 유사도 결과 확인 |
| 중간 | AI 요약/분석 | 문서 요약 생성 확인 (mock 또는 비용 제한) |
| 낮음 | 법령 임포트 | 법제처 API 연동 테스트 (외부 API 의존) |
| 낮음 | OCR 설정 | 관리 탭 OCR 엔진 토글 |

### 관련 Skill

`playwright-e2e-tester` skill이 `.claude/skills/playwright-e2e-tester/`에 생성되어 있으며, 향후 "E2E 테스트", "브라우저 테스트" 등의 요청 시 자동 활용된다.

---

## RAG 에이전트 확장 계획 — 복수 문서 교차 참조 + 근거 체인 자동 구성

> 작성일: 2026-03-10
> 목표: 현재 단순 RAG를 AI 법률 분석 도구 수준으로 확장

### 현재 RAG 상태

| 항목 | 상태 | 비고 |
|------|------|------|
| 벡터 검색 (코사인 유사도) | ✅ | OpenAI `text-embedding-3-small` 1536차원 |
| 복수 문서 필터 (`docIds`) | ✅ | UI에서 다중 선택 가능 |
| Enriched 임베딩 | ✅ | 문서명, 장, 절, 태그, 요약 포함 |
| 멀티턴 대화 | ✅ | 최근 20메시지 히스토리 |
| 근거 자료 표시 | ✅ | 출처, 유사도, 발췌문 5개 |

### 현재 한계

| 한계 | 문제점 |
|------|--------|
| 단순 유사도 검색만 | topK 청크를 가져와서 LLM에 넘기는 1단계 검색 |
| 교차 참조 없음 | 문서 A의 "제5조"가 문서 B의 "제10조"를 언급해도 연결 안 됨 |
| 근거 체인 없음 | "A → B → C" 형태의 추론 경로를 보여주지 못함 |
| 법률 용어 이해 부족 | "준용", "적용", "예외" 등 법률 특수 관계를 인식하지 못함 |
| 답변에 조문 번호만 | "제5조에 따르면..." 이라고만 하고, 해당 조문 원문을 인라인 제공하지 않음 |

---

### 구현 계획 (4단계)

#### 1단계: 멀티홉 검색 엔진 (Multi-hop Retrieval)

현재 1번 검색으로 끝나는 것을 2~3번 연쇄 검색으로 확장.

**파일**: `lib/rag-agent.js` (신규, ~150줄)

```
[사용자 질문]
     ↓
 ① 1차 검색: 질문 → 벡터 유사도 topK=5
     ↓
 ② 참조 추출: 1차 결과에서 "제N조", "○○법" 등 참조 키워드 파싱
     ↓
 ③ 2차 검색: 추출된 참조를 추가 쿼리로 벡터 검색
     ↓
 ④ 병합 + 중복 제거 + 유사도 재순위화
     ↓
 [최종 컨텍스트 청크 세트]
```

**핵심 로직**:
```js
// 1차 결과에서 참조 추출
function extractCrossReferences(chunks) {
  const refs = new Set();
  for (const chunk of chunks) {
    // 다른 법령 참조: "개인정보 보호법 제10조"
    const lawRefs = chunk.text.match(/[가-힣]+법\s*제\d+조/g);
    // 같은 법령 내 조문 참조: "제5조에 따라"
    const articleRefs = chunk.text.match(/제\d+조(?:의\d+)?/g);
    // 수집
    lawRefs?.forEach(r => refs.add(r));
    articleRefs?.forEach(r => refs.add(r));
  }
  return [...refs];
}
```

**예시 흐름**:
```
질문: "개인정보를 제3자에게 제공할 때 동의 요건은?"

① 1차 검색 → 개인정보보호법 제17조(개인정보의 제공) 발견
② 참조 추출 → "제15조제1항", "제18조", "정보통신망법 제24조의2"
③ 2차 검색 → 제15조(수집·이용), 제18조(목적 외 이용), 정보통신망법 조문
④ 최종: 6~8개 관련 청크 (3개 문서에 걸침)
```

---

#### 2단계: 근거 체인 자동 구성 (Evidence Chain)

LLM이 답변할 때 추론 경로를 구조화해서 반환하도록 프롬프트 개선.

**프롬프트 개선**: `api/rag.js`의 시스템 프롬프트 수정 (~30줄 변경)

```
현재 프롬프트:
"제공된 자료를 기반으로 질문에 답변하세요."

개선 프롬프트:
"답변을 다음 구조로 작성하세요:

1. [결론] 질문에 대한 직접 답변 (1~2문장)

2. [근거 체인] 결론에 이르는 논리 경로
   - 근거①: [출처] 조문/내용 → 의미
   - 근거②: [출처] 조문/내용 → 의미
   - 근거①+② → 중간결론
   - 근거③: [출처] → 최종결론 도출

3. [교차 참조] 관련 조문 간 관계
   - A법 제X조 ←(준용)→ B법 제Y조
   - 제X조 →(예외)→ 제Z조

4. [주의사항] 예외, 단서조항, 최신 개정 여부"
```

**응답 파싱 구조**:

```json
{
  "conclusion": "제3자 제공 시 정보주체의 별도 동의가 필요합니다.",
  "evidenceChain": [
    {
      "step": 1,
      "source": "개인정보보호법 제17조제1항",
      "content": "개인정보처리자는 정보주체의 동의를 받은 경우...",
      "reasoning": "원칙적으로 동의 필요"
    },
    {
      "step": 2,
      "source": "같은 법 제17조제2항",
      "content": "제1항에 따른 동의를 받을 때에는 다음 사항을 알려야 한다...",
      "reasoning": "동의 시 고지 의무 조건"
    }
  ],
  "crossReferences": [
    { "from": "제17조", "to": "제15조제1항", "relation": "준용" },
    { "from": "제17조", "to": "제18조", "relation": "예외" }
  ],
  "caveats": ["제17조제1항제2호~제4호의 예외사유 해당 시 동의 불요"]
}
```

**파일**: `lib/evidence-parser.js` (신규, ~80줄)

---

#### 3단계: 교차 참조 매트릭스 (Cross-Reference Matrix)

복수 문서 간 참조 관계를 자동 인식하는 시스템.

**파일**: `lib/cross-reference.js` (신규, ~100줄)

**두 가지 교차 참조 유형**:

| 유형 | 예시 | 감지 방법 |
|------|------|-----------|
| 명시적 | "정보통신망법 제24조의2에 따라" | 정규식 `[가-힣]+법\s*제\d+조` |
| 암묵적 | 같은 개념이 여러 법령에 등장 | 임베딩 유사도 ≥ 0.85 |

**교차 참조 DB 테이블** (신규):

```sql
CREATE TABLE IF NOT EXISTS cross_references (
  id SERIAL PRIMARY KEY,
  source_section_id INT REFERENCES document_sections(id),
  target_section_id INT REFERENCES document_sections(id),
  relation_type TEXT,     -- 'explicit'|'semantic'|'준용'|'적용'|'예외'
  confidence FLOAT,       -- 명시적=1.0, 시맨틱=유사도값
  context TEXT,           -- "제17조에서 제15조제1항을 준용"
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**구축 시점**: 법령 임포트 시 자동 + 수동 트리거

```
법령 A 임포트
  ↓
① A 내부 참조 (이미 있음: references/referencedBy)
  ↓
② A → 다른 법령 참조 탐색
   "정보통신망법 제24조" → DB에서 해당 조문 찾기
  ↓
③ cross_references 테이블에 저장
  ↓
④ 시맨틱 유사도 기반 암묵적 참조 탐색 (배치)
   A의 각 조문 임베딩 ↔ 기존 조문 임베딩 비교
   유사도 ≥ 0.85 → cross_references에 추가
```

---

#### 4단계: 프론트엔드 — 근거 체인 시각화 UI

**ChatTab 개선** (index.html, ~200줄 추가)

```
┌─────────────────────────────────────────┐
│  질문: 개인정보 제3자 제공 동의 요건?     │
├─────────────────────────────────────────┤
│                                         │
│  ▎결론                                  │
│  제3자 제공 시 정보주체의 별도 동의가     │
│  필요합니다.                             │
│                                         │
│  ▎근거 체인                              │
│  ┌───────────────────────────────┐      │
│  │ ① 개인정보보호법 제17조제1항   │      │
│  │   "정보주체의 동의를 받은 경우" │      │
│  │         ↓ (원칙)              │      │
│  │ ② 같은 법 제17조제2항          │      │
│  │   "동의 시 고지 의무"          │      │
│  │         ↓ (조건)              │      │
│  │ ③ 같은 법 제15조제1항 [준용]   │      │
│  │   "수집·이용 동의 요건 준용"    │      │
│  └───────────────────────────────┘      │
│                                         │
│  ▎교차 참조                              │
│  제17조 ─(준용)→ 제15조제1항             │
│  제17조 ─(예외)→ 제18조                  │
│  개인정보보호법 ←→ 정보통신망법 제24조의2  │
│                                         │
│  ▎주의사항                               │
│  ⚠ 제17조제1항 제2~4호 예외사유 해당 시   │
│    동의 불필요                            │
│                                         │
│  [근거 원문 보기 ▼]                      │
│  ┌─ 개인정보보호법 제17조 ── 92% ──┐     │
│  │ 제17조(개인정보의 제공)...       │     │
│  └──────────────────────────────┘      │
└─────────────────────────────────────────┘
```

---

### 작업량 예상

| 단계 | 파일 | 예상 규모 | 난이도 |
|------|------|-----------|--------|
| 1. 멀티홉 검색 | `lib/rag-agent.js` (신규) | ~150줄 | 중 |
| | `api/rag.js` (수정) | ~40줄 변경 | 중 |
| 2. 근거 체인 | `api/rag.js` 프롬프트 | ~50줄 변경 | 중 |
| | `lib/evidence-parser.js` (신규) | ~80줄 | 중 |
| 3. 교차 참조 매트릭스 | `lib/cross-reference.js` (신규) | ~100줄 | 고 |
| | `api/law-import.js` (수정) | ~30줄 추가 | 중 |
| | DB 마이그레이션 스크립트 | ~20줄 | 저 |
| 4. 프론트엔드 UI | `index.html` ChatTab 수정 | ~200줄 | 중 |

**총 ~670줄 추가/변경**, 기존 RAG 호환 유지

### 추천 구현 순서

```
1단계 (멀티홉) → 2단계 (근거 체인) → 4단계 (UI) → 3단계 (교차 참조)
```

3단계는 독립적이라 나중에 추가해도 1~2단계가 잘 동작한다.
1+2+4를 먼저 하면 즉시 체감 가능한 개선이 되고, 3단계는 데이터가 쌓인 후 효과가 극대화된다.

---

## 참조 관계 그래프 (구현 완료)

> 구현일: 2026-03-10

법령 조문 간 참조를 D3.js 네트워크 그래프로 시각화.

### 구현된 기능

| 기능 | 설명 |
|------|------|
| 탭 전환 | 법령 문서 상세에서 `조문 목록` ↔ `참조 그래프` 탭 전환 |
| 네트워크 그래프 | D3.js force-directed graph — 조문 = 노드, 참조 = 화살표 |
| 장별 색상 | 각 장(chapter)마다 다른 색상으로 노드 구분 |
| 노드 크기 | 역참조 수(중요도)에 비례 |
| 호버 | 연결된 조문만 하이라이트, 나머지 흐려짐 |
| 클릭 | 노드 클릭 → 조문 목록 탭으로 전환 + 해당 조문 스크롤 |
| 줌/팬/드래그 | D3 zoom behavior |
| 통계 패널 | 핵심 조문 TOP5, 장별 참조 밀도, 고립 조문 수 |

### 관련 파일

- `api/law-graph.js` — 그래프 데이터 API (nodes/links/stats)
- `server.js` — GET `/api/law-graph` 라우트
- `index.html` — `LawGraphView` 컴포넌트 + `DocumentDetailModal` 탭 전환

---

## 비식별화 기능 (구현 완료)

> 구현일: 2026-03-10

업로드 시 등록된 키워드를 마스킹 처리 후 DB에 저장.

### 구현된 기능

| 기능 | 설명 |
|------|------|
| 키워드 관리 | 관리 탭에서 키워드 추가/삭제/일괄 등록 |
| 업로드 토글 | 파일 업로드 시 비식별화 ON/OFF 스위치 |
| 띄어쓰기 우회 방지 | 글자 사이 `\s*` 패턴으로 공백 삽입 우회 차단 |
| 결과 표시 | 업로드 완료 시 치환 건수 표시 |

### 관련 파일

- `lib/deidentify.js` — 키워드 매칭/치환 모듈
- `api/deidentify.js` — CRUD API + 자동 테이블 생성
- `api/upload.js` — 비식별화 단계 통합
- `index.html` — `DeidentifyPanel` + 업로드 토글 UI
