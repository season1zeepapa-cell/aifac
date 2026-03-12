# DocStore 종합 분석 보고서

> 작성일: 2026-03-11
> 최종 수정: 2026-03-12
> 대상: workspace/docstore (PDF 문서 관리 + 법령 지식 RAG 시스템)
> 배포: https://docstore-eight.vercel.app

---

## 1. 프로젝트 개요

DocStore는 **법령·규정·기출문제 등 다양한 문서를 업로드하여 벡터화하고, 하이브리드 검색과 RAG 기반 AI 질의응답**을 제공하는 풀스택 웹 애플리케이션이다.

### 기술 스택

| 계층 | 기술 |
|------|------|
| 프론트엔드 | React (CDN) + Tailwind CSS, 빌드 도구 없는 단일 SPA (6,811행) |
| 백엔드 | Express.js (로컬) / Vercel Serverless Functions (배포) |
| DB | Supabase PostgreSQL + pgvector (HNSW 인덱스) |
| 임베딩 | OpenAI text-embedding-3-small (1536차원) |
| LLM | Gemini 2.5 Flash (기본) / GPT-4o / Claude Sonnet |
| 리랭킹 | Cohere Rerank v3.5 (선택적) |
| OCR | 6개 엔진 플러그인 (Gemini Vision, CLOVA, Cloud Vision 등) |
| 크롤링 | 네이버 검색 API + 사이트 게시판 직접 크롤링 |

### 핵심 파이프라인

```
문서 입력 (PDF/DOCX/CSV/이미지/URL/법령API)
    ↓                                          크롤링 입력 (네이버 뉴스/사이트 게시판)
텍스트 추출 → 섹션 분할 → 4가지 청킹 전략          ↓
    ↓                                      키워드 매칭 → 점수 계산 → 결과 저장
Enriched 임베딩 (맥락 정보 + 원문 결합)              ↓
    ↓                                      선택적 지식화 (크롤링 결과 → 문서 변환)
pgvector 저장 + tsvector FTS 인덱스     ←───────┘
    ↓
하이브리드 검색 (벡터 + FTS + RRF 합산 + Cohere 리랭킹)
    ↓
RAG 질의 (멀티홉 검색 + MMR 다양성 + LLM 답변 생성)
```

---

## 2. 기능 구현 현황

### 구현 완료 (✅)

#### 문서 관리
- [x] 멀티포맷 업로드 (PDF/TXT/MD/DOCX/XLSX/CSV/JSON/이미지)
- [x] 웹 URL 크롤링 임포트
- [x] 법제처 API 법령/행정규칙/자치법규 검색 + 임포트
- [x] 문서 메타 인라인 편집 (제목/카테고리 클릭 → 수정)
- [x] 소프트 삭제 + 휴지통 + 영구 삭제
- [x] 원본 파일 다운로드 (Supabase Storage)
- [x] 즐겨찾기 토글
- [x] 태그 추가/삭제 + 태그별 필터링
- [x] AI 문서 분석 (요약/키워드/태그 자동 생성)

#### 크롤링 & 지식화 (신규 — 2026-03-11)
- [x] 네이버 뉴스 검색 API 연동 (fetch + AbortSignal.timeout)
- [x] 사이트 게시판 크롤링 (3가지 HTML 패턴 매칭, 자동 인코딩 감지)
- [x] 크롤링 소스(사이트) CRUD 관리 UI
- [x] 크롤링 키워드 CRUD + 점수 가중치(제목/내용) 관리 UI
- [x] 키워드 매칭 점수 계산 (titleWeight, contentWeight 커스텀)
- [x] 제외 패턴(URL) 관리 (crawl_exclusions)
- [x] 크롤링 결과 미리보기 (제목/점수/출처 + 체크박스 선택)
- [x] 선택적 지식화 — 크롤링 결과 → documents 변환 + 임베딩 자동 처리
- [x] URL 중복 체크 (UNIQUE(url, org_id))
- [x] 크롤링 범위 설정 (recentDays 파라미터)
- [x] 설정 탭에서 네이버 검색 API 키 관리 + 연결 테스트

#### 검색 엔진
- [x] 하이브리드 검색 (벡터 + FTS + RRF 합산)
- [x] 텍스트 전문 검색 (tsvector + ts_rank_cd)
- [x] 벡터 의미 검색 (pgvector cosine)
- [x] Cohere Rerank v3.5 재정렬 (선택적)
- [x] 한국어 N-gram 토크나이저 + 동의어 확장 (약 50개 항목)
- [x] 검색 자동완성 (문서 제목 + 섹션 본문, 키보드 내비게이션)
- [x] 검색 결과 하이라이팅 (서버 ts_headline + 클라이언트 다중 단어)
- [x] 문서/장 범위 필터 + 태그 필터
- [x] 검색 결과 → 문서 상세 모달 이동

#### RAG 질의응답
- [x] 멀티홉 검색 (1차 검색 → 참조 추출 → 2차 검색)
- [x] MMR (Maximal Marginal Relevance) 다양성 보장
- [x] SSE 스트리밍 답변 (토큰 단위)
- [x] 근거 조문 인용 표시 + 검증(verified) 플래그
- [x] 환각 경고 시각화 (미검증 근거 빨간 뱃지 + 툴팁)
- [x] 대화 히스토리 (채팅 세션 저장/복원)
- [x] 멀티 LLM 선택 (Gemini/OpenAI/Claude)
- [x] JSON + 마크다운 출력 파싱

#### 법령 특화
- [x] 법제처 API 3종 (법령/행정규칙/자치법규) 검색 + 상세 조회
- [x] 조문 간 참조 관계 파싱 (제N조 패턴)
- [x] 역참조 계산 (metadata.referencedBy)
- [x] 명시적 + 시맨틱 교차 참조 매트릭스 자동 구축
- [x] D3.js 참조 네트워크 그래프 시각화
- [x] 장/절 기준 그룹핑 + 접기/펼치기

#### 임베딩 파이프라인
- [x] 4가지 청킹 전략 (sentence/recursive/law-article/semantic)
- [x] Enriched 임베딩 (문서 메타 + 계층 라벨 + 원문 결합)
- [x] 배치 임베딩 (5개 병렬, 10개씩 DB INSERT)
- [x] 임베딩 상태 추적 (pending/done/failed)
- [x] 임베딩 재생성 버튼

#### 인증 & 보안
- [x] HMAC-SHA256 JWT 인증 (관리자 전용)
- [x] 조직별 데이터 격리 (org_id)
- [x] Rate Limiting (IP 기준)
- [x] API 사용량 추적 + 비용 대시보드 (네이버 검색 API 포함)
- [x] 입력 검증 + SQL 파라미터 바인딩
- [x] 에러 메시지 안전 패턴 화이트리스트 (프로덕션 환경 노출 최소화)

#### OCR
- [x] 6개 OCR 엔진 플러그인 아키텍처
- [x] 우선순위 폴백 체인 (무료 → 유료)
- [x] OCR 엔진별 설정 UI (관리 탭)

#### E2E 테스트
- [x] Playwright 테스트 인프라 (global-setup, storageState)
- [x] 검색 기능 특화 27개 테스트 (자동완성/하이라이팅/API 구조 등)
- [x] 크롤링 기능 29개 테스트 (소스/키워드/제외패턴/실행/지식화)
- [x] 로그인, 네비게이션, 문서 목록, 채팅 테스트
- [x] UX 기능 테스트, 분석/디버그 테스트

---

### 미구현 / 부분 구현 (❌ / 🔶)

#### 보안 강화
- 🔶 CORS 도메인 제한 (현재 `*` 전체 허용 → 특정 도메인만 허용 필요)
- ❌ RegExp 인젝션 방어 (pdf-extractor.js 사용자 정의 구분자)

#### 검색/RAG 개선
- ❌ 쿼리 리라이팅 (사용자 질문을 검색에 최적화된 형태로 변환)
- ❌ HyDE (Hypothetical Document Embedding) 기법
- ❌ 부모 문서 검색 (Parent Document Retriever)
- ❌ Self-RAG (검색 필요성 자체를 LLM이 판단)

#### 기능 확장
- ❌ 법령 개정 전후 비교 (동일 법령 버전 간 diff)
- ❌ 다중 사용자 역할별 권한 (뷰어/에디터/관리자)
- ❌ 문서 버전 관리 (수정 이력 + 롤백)
- ❌ 실시간 알림 (Supabase Realtime)
- ❌ SSE 스트리밍 요약

#### 인프라
- 🔶 임베딩 배치 최적화 (현재 섹션별 → 전체 문서 단위 배치 가능)
- ❌ 벡터 DB 전용 서비스 (Pinecone/Weaviate 등) 분리
- ❌ 캐싱 레이어 (Redis) 도입
- ❌ CI/CD 파이프라인 구축

---

## 3. RAG 아키텍처 수준 평가

DocStore의 RAG 시스템을 업계 4대 표준 프레임워크 기준으로 비교 평가한다.

### 평가 기준표

```
평가 등급:
  ★★★★★  업계 최상위 수준 (프로덕션 급)
  ★★★★☆  대부분 구현, 일부 고급 기능 부재
  ★★★☆☆  핵심 구현 완료, 최적화 여지 있음
  ★★☆☆☆  기본 구현, 주요 기능 누락
  ★☆☆☆☆  초기 단계
```

---

### 3-1. LangChain 기준 평가 (코드베이스 진단)

> LangChain: 가장 널리 쓰이는 RAG 프레임워크. 모듈형 체인, 다양한 리트리버, 프롬프트 관리가 핵심.
> 진단일: 2026-03-12 | 코드베이스 직접 분석 기반

| LangChain 핵심 컴포넌트 | DocStore 구현 수준 | 코드 근거 | 상세 |
|---|---|---|---|
| **Document Loaders** | ★★★★★ | `lib/text-extractor.js`, `lib/pdf-loaders/` (8개), `api/url-import.js`, `api/law-import.js`, `api/crawl.js`, `api/naver-news.js` | 14종 로더 — PDF 8종(플러그인), DOCX/XLSX/CSV/JSON/TXT/MD, 이미지(OCR 6엔진), URL, 법령API, 네이버뉴스, 사이트크롤링 |
| **Text Splitters** | ★★★★☆ | `lib/text-splitters.js` — `sentenceChunk()`, `recursiveChunk()`, `lawArticleChunk()`, `semanticChunk()` | 4전략. recursive는 LangChain `RecursiveCharacterTextSplitter` 동일 패턴 (구분자 계층: `\n\n`→`\n`→`.`→` `→`''`). semantic은 Gemini Flash 활용. MarkdownHeaderTextSplitter 미구현 |
| **Embeddings** | ★★★★☆ | `lib/embeddings.js` — `generateEmbeddings()`, `buildEnrichedText()`, 배치 CONCURRENCY=5 | OpenAI `text-embedding-3-small` (1536D) 단일 모델. Enriched Text가 차별점: `[문서][분류][태그][키워드][요약][장][절][조항]` 8개 메타필드 + 원문 결합 |
| **Vector Stores** | ★★★★☆ | `lib/hybrid-search.js` — `dc.embedding <=> $1::vector` (코사인), `lib/db.js` — Pool max=2 | pgvector 코사인 거리 + **HNSW 인덱스 적용 확인** (m=16, ef=64). 코드(`create-tables.js`)에는 누락이나 DB에 실제 존재. GIN 인덱스(FTS)도 정상 |
| **Retrievers** | ★★★★★ | `lib/hybrid-search.js` — `rrfFusion()` K=60, `lib/reranker.js` — Cohere v3.5, `lib/rag-agent.js` — `applyMMR()` λ=0.7 | 벡터+FTS 병렬→RRF합산→Cohere Rerank→MMR 다양성. 점수 가중합산 (벡터0.4+RRF0.3+Rerank0.3). 3-gram Jaccard 텍스트 유사도 |
| **Chains/Prompts** | ★★★☆☆ | `api/rag.js` 라인 77~119 — JSON 강제 프롬프트, `lib/rag-agent.js` — `multiHopSearch()` | 프롬프트 하드코딩 (템플릿 변수화 없음). 체인 추상화 없이 순차 파이프라인. 멀티홉은 있으나 동적 라우팅 없음 |
| **Memory** | ★★★★☆ | `api/chat-sessions.js` — JSONB `messages` 배열, `api/rag.js` — `history.slice(-20)` | DB 기반 세션 저장/복원, 최근 10턴(20메시지) 컨텍스트. LangChain `ConversationBufferWindowMemory` 동등. 요약 메모리(ConversationSummaryMemory) 미구현 |
| **Output Parsers** | ★★★★☆ | `lib/output-parser.js` — `tryParseJSON()` → `parseMarkdownAnswer()` 2단계 폴백 | JSON 코드블록 추출→검증→정규화. 근거 번호 verified 검증. 마크다운 폴백 파서 (헤딩 기반 섹션 추출). LangChain `StructuredOutputParser` + `OutputFixingParser` 패턴 부분 구현 |
| **Callbacks/Tracing** | ★★★☆☆ | `lib/api-tracker.js` — `trackUsage()`, `trackedApiCall()`, `checkDailyLimit()`, 비용 테이블 | console.log보다 진보: 토큰별 비용 추정, 크레딧 소진 자동 감지(`isCreditError`), 일일 한도, 키 비활성화. 다만 LangSmith급 체인별 추적/리플레이 없음 |

**종합: ★★★★☆ (4.1/5)** (이전 4.0 → 4.1 상향: Callbacks 재평가 + 로더 확대)

**이전 평가 대비 변경점:**
- Vector Stores: ★★★★☆ 유지 (코드에는 인덱스 생성 SQL 누락이나, DB에 HNSW 인덱스 실존 확인 — `idx_chunks_embedding_hnsw` m=16, ef=64)
- Callbacks/Tracing: ★★☆☆☆ → **★★★☆☆** (상향: `api-tracker.js`의 비용 추적/크레딧 감지/일일 한도가 단순 console.log 이상)
- Document Loaders: 12종 → **14종** (PDF 로더 플러그인 8개 반영)

---

#### 3-1-1. 항목별 코드 진단 상세

##### (1) Document Loaders — ★★★★★

**강점:** 프레임워크 없이 LangChain 수준의 로더 다양성 확보

```
텍스트 기반 (lib/text-extractor.js):
  detectFileType() → EXTENSION_MAP 기반 분기
  ├── text    → 전체/줄/구분자 분할
  ├── markdown → 헤딩(#) 기준 섹션 분할
  ├── docx   → mammoth 라이브러리 (단락 단위)
  ├── xlsx   → 행 단위, 시트/컬럼 선택 가능
  ├── csv    → 행 단위, 열 매핑
  ├── json   → 배열(각 요소) 또는 객체(키별)
  └── image  → OCR 엔진 매니저 위임 (6개 엔진)

PDF 전용 (lib/pdf-loaders/ 플러그인):
  index.js → ALL_LOADERS 레지스트리
  ├── pdf-parse.js    (Node.js, 기본값)
  ├── pdfjs.js        (Node.js, 좌표 기반)
  ├── upstage-doc.js  (HTTP API, 한국어 특화)
  ├── pymupdf.js      (Python 브릿지)
  ├── pypdf.js        (Python 브릿지)
  ├── pdfplumber.js   (Python 브릿지, 표 추출)
  ├── unstructured.js (Python 브릿지)
  └── docling.js      (Python 브릿지)

외부 소스:
  api/url-import.js   → 웹페이지 (charset 자동 감지)
  api/law-import.js   → 법제처 API (조문별 구조화)
  api/crawl.js        → 사이트 게시판 (CSS 선택자 기반)
  api/naver-news.js   → 네이버 뉴스 검색 API
```

**미구현:** LangChain 대비 부족한 로더
- Notion, Google Drive, Slack, Confluence 등 SaaS 연동
- YouTube 자막 로더
- 이메일 (IMAP/EML) 로더

**개선안:**
| 우선순위 | 로더 | 구현 난이도 | 기대 효과 |
|---------|------|-----------|----------|
| 높음 | HWP/HWPX (한글 문서) | 중간 (hwp.js 라이브러리) | 한국 공공문서 대부분이 HWP 형식 |
| 중간 | Google Drive | 중간 (OAuth + API) | 팀 문서 자동 연동 |
| 낮음 | Notion | 높음 (API 페이지네이션) | 지식 베이스 통합 |

---

##### (2) Text Splitters — ★★★★☆

**강점:** 4가지 전략이 용도별로 잘 분화됨

```javascript
// lib/text-splitters.js — 전략별 파라미터
sentenceChunk(text, chunkSize=500, overlap=100)     // 마침표 기준, 범용
recursiveChunk(text, chunkSize=500, overlap=100)     // 구분자 계층, LangChain 동일
lawArticleChunk(text, chunkSize=800, overlap=0)      // 제N조 패턴, 항(①②③) 세분화
semanticChunk(text, chunkSize=800)                   // Gemini Flash AI 분할
```

**발견된 이슈:**
1. `recursiveChunk`의 기본 `overlap=100`이 문장 경계를 무시할 수 있음 (문장 중간에서 잘릴 위험)
2. `semanticChunk`의 `MAX_INPUT=6000`자 제한 — 긴 문서에서 사전 분할이 의미 경계를 훼손할 수 있음
3. 청크 크기 파라미터가 UI에서 조정 불가 (하드코딩)

**개선안:**
| 우선순위 | 항목 | 구현 난이도 | 기대 효과 |
|---------|------|-----------|----------|
| 높음 | MarkdownHeaderTextSplitter | 낮음 | MD 문서의 구조 보존 (현재 헤딩 기반 분할은 있으나 계층 메타데이터 미전달) |
| 높음 | 청크 크기 UI 설정 | 낮음 | 사용자가 문서 특성에 맞게 chunkSize/overlap 조정 |
| 중간 | Parent Document Retriever | 중간 | 작은 청크로 검색 → 부모 섹션 컨텍스트 반환 (정확도↑) |
| 낮음 | overlap 문장 경계 보정 | 낮음 | overlap이 문장 중간에서 잘리지 않도록 보정 |

---

##### (3) Embeddings — ★★★★☆

**강점:** Enriched Text 전략이 LangChain의 `ContextualCompressionRetriever`보다 우수

```javascript
// lib/embeddings.js — buildEnrichedText() 결과 예시:
// [문서] 개인정보 보호법
// [분류] 법령
// [태그] 개인정보, CCTV, 영상정보
// [키워드] 영상정보처리기기, 설치제한
// [문서요약] 개인정보 보호에 관한 기본법으로...
// [장] 제5장 영상정보처리기기의 설치·운영 제한
// [조항] 제25조
// [조항제목] 영상정보처리기기의 설치·운영 제한
// 영상정보처리기기운영자는 ... (원문)
```

**발견된 이슈:**
1. 임베딩 모델이 `text-embedding-3-small` 하나뿐 — 한국어 특화 모델 부재
2. 배치 크기가 CONCURRENCY=5로 고정 — API rate limit에 따라 동적 조절 불가
3. 임베딩 캐싱 없음 — 동일 텍스트 재임베딩 시 비용 발생

**개선안:**
| 우선순위 | 항목 | 구현 난이도 | 기대 효과 |
|---------|------|-----------|----------|
| 높음 | 임베딩 모델 선택지 추가 | 중간 (`api/settings.js` 활용) | Upstage Solar Embedding (한국어 1위), Cohere embed-v3 지원 |
| 중간 | 임베딩 캐시 (해시 기반) | 중간 | 동일 텍스트 재임베딩 방지 → 비용 30~50% 절감 |
| 낮음 | Late Chunking | 높음 | 전체 문서를 한 번에 임베딩 → 청크 경계 문맥 손실 방지 |

---

##### (4) Vector Stores — ★★★★☆

**코드(`create-tables.js`)에는 벡터 인덱스 생성 SQL이 누락되어 있었으나, DB 실제 확인 결과 HNSW 인덱스가 존재**

```sql
-- DB 실제 인덱스 현황 (2026-03-12 확인):
idx_chunks_embedding_hnsw  HNSW (embedding vector_cosine_ops) m=16, ef=64  ✅
idx_chunks_fts             GIN (fts_vector)                                ✅
document_chunks_pkey       btree (id)                                      ✅
```

```javascript
// lib/hybrid-search.js — 벡터 검색 쿼리:
ORDER BY dc.embedding <=> $1::vector  // 코사인 거리 → HNSW 인덱스 사용
LIMIT 30
```

**현재 상태:** 752개 청크, HNSW 인덱스 정상 동작. 현 규모에서는 충분.

**개선안 (향후 규모 확장 시):**
| 우선순위 | 항목 | 설명 | 기대 효과 |
|---------|------|------|----------|
| 높음 | `create-tables.js`에 인덱스 SQL 추가 | 코드와 DB 상태 동기화 | 신규 환경 세팅 시 인덱스 누락 방지 |
| 중간 | enriched_text 컬럼 추가 | `ALTER TABLE document_chunks ADD COLUMN enriched_text TEXT;` | 현재 enriched_text가 DB에 미저장 (매번 재생성) |
| 낮음 | IVFFlat 전환 검토 | 데이터 10만건 이상 시 HNSW보다 메모리 효율적 | 대규모 확장 대비 |

---

##### (5) Retrievers — ★★★★★

**DocStore의 최대 강점.** 5단계 파이프라인이 업계 최상위 수준:

```
질문 입력
  ↓
[1단계] 벡터 검색 ←→ FTS 검색 (병렬 실행)
  │ vectorSearch(): dc.embedding <=> query::vector
  │ ftsSearch(): dc.fts_vector @@ to_tsquery() + ts_rank_cd()
  ↓
[2단계] RRF 합산 (K=60)
  │ rrfFusion(): 양쪽 매칭 시 보너스 합산
  ↓
[3단계] Cohere Rerank v3.5 (선택적)
  │ rerankResults(): 최대 4096 토큰/문서
  ↓
[4단계] 점수 정규화 + 가중 합산
  │ normalizeScores(): Min-Max 정규화
  │ computeFinalScore(): 벡터(0.4) + RRF(0.3) + Rerank(0.3)
  ↓
[5단계] MMR 다양성 보장 (λ=0.7)
  │ applyMMR(): 3-gram Jaccard 유사도로 중복 제거
  ↓
최종 결과 (topK건)
```

**개선안:**
| 우선순위 | 항목 | 구현 난이도 | 기대 효과 |
|---------|------|-----------|----------|
| 높음 | 쿼리 리라이팅 | 낮음 (LLM 1회 호출) | 모호한 질문 → 검색 최적화 쿼리 변환 (recall 20%↑) |
| 높음 | HyDE (Hypothetical Document Embedding) | 낮음 | 가상 답변 생성→임베딩→검색 (벡터 recall 30%↑) |
| 중간 | Parent Document Retriever | 중간 | 작은 청크 검색 → 부모 섹션 반환 (정확도+컨텍스트) |
| 중간 | 형태소 분석기 (Mecab) | 높음 (서버 의존성) | 한국어 FTS 정확도 향상 (N-gram 한계 극복) |

---

##### (6) Chains/Prompts — ★★★☆☆

**현재 구조:** 체인 추상화 없이 `api/rag.js`에 하드코딩

```javascript
// api/rag.js — 프롬프트가 코드에 직접 포함
const prompt = `당신은 법령 및 규정 전문 AI 어시스턴트입니다...
## 답변 형식
반드시 아래 JSON 형식으로만 답변하세요...
\`\`\`json
{ "conclusion": "...", "evidenceChain": [...], ... }
\`\`\`
## 규칙
- 근거 자료에 있는 내용만 바탕으로 답변하세요
...
--- 근거 자료 (총 ${sources.length}건) ---
${contextText}
${historyText}
--- 현재 질문 ---
${question.trim()}`;
```

**문제점:**
1. 프롬프트가 코드에 직접 포함 → 수정 시 재배포 필요
2. 프롬프트 버전 관리 없음
3. 상황별 프롬프트 분기 없음 (법령 질문 vs 일반 문서 질문 동일 프롬프트)
4. LangChain의 `PromptTemplate`, `ChatPromptTemplate`, `FewShotPromptTemplate` 등 템플릿 패턴 미사용

**개선안:**
| 우선순위 | 항목 | 구현 난이도 | 기대 효과 |
|---------|------|-----------|----------|
| 높음 | 프롬프트 템플릿 분리 | 낮음 (별도 파일/DB) | 재배포 없이 프롬프트 수정 가능, A/B 테스트 |
| 높음 | 카테고리별 프롬프트 | 낮음 | 법령/규정/기출/일반 각각 최적화된 프롬프트 |
| 중간 | Few-shot 예시 | 낮음 | 출력 형식 준수율 향상 (현재 JSON 파싱 실패→마크다운 폴백 빈도 감소) |
| 중간 | 프롬프트 체인 | 중간 | 쿼리 분석→검색→답변→검증 각 단계 독립 프롬프트 |

---

##### (7) Memory — ★★★★☆

**현재 구조:** DB 기반 세션 관리, 최근 20메시지 포함

```javascript
// api/chat-sessions.js — chat_sessions 테이블
// messages: JSONB 배열 [{role, content}, ...]
// 제한: 최근 10턴(20메시지)만 프롬프트에 포함

// api/rag.js — 히스토리 전달
const recentHistory = Array.isArray(history) ? history.slice(-20) : [];
const historyText = recentHistory.map(h =>
  h.role === 'user' ? `사용자: ${h.content}` : `AI: ${h.content}`
).join('\n\n');
```

**문제점:**
1. 긴 대화에서 초반 맥락 유실 (20메시지 윈도우)
2. 히스토리가 프롬프트에 직접 포함 → 토큰 소비 증가
3. 대화 요약(ConversationSummaryMemory) 없음

**개선안:**
| 우선순위 | 항목 | 구현 난이도 | 기대 효과 |
|---------|------|-----------|----------|
| 중간 | 대화 요약 메모리 | 중간 (LLM 1회 호출) | 오래된 대화를 요약하여 토큰 절약 + 맥락 유지 |
| 낮음 | 엔티티 메모리 | 높음 | 대화에서 언급된 법률/조문을 추적 |

---

##### (8) Output Parsers — ★★★★☆

**강점:** 2단계 폴백 + 근거 번호 검증이 LangChain `OutputFixingParser`보다 실용적

```
LLM 출력
  ↓
[1단계] tryParseJSON() — ```json 코드블록 추출 → JSON.parse → 검증
  │ 성공 → validateAndNormalize() → sourceIndex 범위 검증 → verified 플래그
  ↓ 실패
[2단계] parseMarkdownAnswer() — 헤딩(##/###) 기준 섹션 분리
  │ 결론, 근거체인, 교차참조, 주의사항 각각 추출
  ↓
구조화된 응답 { conclusion, evidenceChain[], crossReferences[], caveats, warnings[] }
```

**개선안:**
| 우선순위 | 항목 | 구현 난이도 | 기대 효과 |
|---------|------|-----------|----------|
| 중간 | 자동 재시도 (OutputFixingParser) | 낮음 | JSON 파싱 실패 시 LLM에 에러 메시지와 함께 재요청 |
| 낮음 | Guardrails 입력 검증 | 중간 | 악의적 프롬프트 인젝션 방어 |

---

##### (9) Callbacks/Tracing — ★★★☆☆ (상향 조정)

**이전 평가 ★★☆☆☆에서 상향.** `api-tracker.js`가 단순 로깅 이상의 기능 제공:

```javascript
// lib/api-tracker.js — 추적 기능 목록:
trackUsage()         // 프로바이더/모델/엔드포인트별 토큰+비용 기록
trackedApiCall()     // 래핑: 한도 체크→호출→기록→크레딧 감지
checkDailyLimit()    // 일일 호출 한도 확인
isCreditError()      // 크레딧 소진 패턴 6개 매칭
updateKeyStatus()    // 키 비활성화/활성화 자동 전환

// 비용 단가 테이블:
COST_TABLE = {
  'openai:text-embedding-3-small': { in: 0.02, out: 0 },
  'openai:gpt-4o': { in: 5.0, out: 15.0 },
  'anthropic:claude-opus-4-6': { in: 15.0, out: 75.0 },
  ...
}
```

**미구현 (LangSmith 대비):**
- 체인 단계별 추적 (검색→리랭크→LLM 각 단계 시간/토큰)
- 실행 리플레이 (동일 입력으로 재실행)
- 평가 데이터셋 기반 자동 테스트
- 피드백 수집 (사용자 답변 만족도)

**개선안:**
| 우선순위 | 항목 | 구현 난이도 | 기대 효과 |
|---------|------|-----------|----------|
| 높음 | RAG 파이프라인 단계별 타이밍 | 낮음 | 검색/리랭크/LLM 각 단계 병목 식별 |
| 높음 | 답변 피드백 수집 (👍/👎) | 낮음 | RAG 품질 측정 지표 확보 |
| 중간 | 자체 트레이싱 테이블 | 중간 | `rag_traces` 테이블: 질문→검색결과→LLM응답→파싱결과 전 과정 기록 |
| 낮음 | LangSmith/LangFuse 연동 | 중간 | 외부 관측성 도구 활용 |

---

#### 3-1-2. 종합 개선 로드맵 (LangChain 기준)

##### 즉시 적용 (1~2일)

| # | 항목 | 대상 | 효과 |
|---|------|------|------|
| 1 | ~~HNSW 벡터 인덱스 생성~~ | ~~DB 마이그레이션~~ | ✅ 이미 적용 확인 (idx_chunks_embedding_hnsw) |
| 2 | **RAG 파이프라인 타이밍 로그** | `api/rag.js` | 병목 구간 즉시 식별 |
| 3 | **답변 피드백 UI** | `index.html` + API | 품질 측정 기반 확보 |
| 4 | **create-tables.js 인덱스 동기화** | `scripts/create-tables.js` | 코드-DB 상태 일치 |

##### 단기 (1~2주)

| # | 항목 | 대상 | 효과 |
|---|------|------|------|
| 4 | **쿼리 리라이팅** | `lib/rag-agent.js` | 모호한 질문 검색 정확도 20%↑ |
| 5 | **HyDE** | `lib/hybrid-search.js` | 벡터 검색 recall 30%↑ |
| 6 | **프롬프트 템플릿 분리** | `lib/prompts/` 디렉토리 | 재배포 없이 프롬프트 튜닝 |
| 7 | **카테고리별 프롬프트** | `lib/prompts/` | 법령/일반 각각 최적화 |
| 8 | **임베딩 모델 선택** | `lib/embeddings.js` + UI | 한국어 특화 모델 지원 |

##### 중기 (1~2개월)

| # | 항목 | 대상 | 효과 |
|---|------|------|------|
| 9 | **Parent Document Retriever** | `lib/hybrid-search.js` | 검색 정확도 + 컨텍스트 품질 |
| 10 | **대화 요약 메모리** | `api/rag.js` | 긴 대화에서 토큰 절약 + 맥락 유지 |
| 11 | **자체 트레이싱 시스템** | `lib/rag-tracer.js` + DB | 체인별 추적/리플레이/평가 |
| 12 | **HWP 로더** | `lib/text-extractor.js` | 한국 공공문서 지원 |

---

### 3-2. Hybrid RAG 기준 평가

> Hybrid RAG: 키워드 검색 + 벡터 검색을 결합하여 단일 검색 방식의 한계를 극복하는 접근법.

| Hybrid RAG 핵심 기법 | DocStore 구현 수준 | 상세 |
|---|---|---|
| **벡터 검색** | ★★★★★ | pgvector cosine similarity + HNSW 인덱스 |
| **키워드 검색** | ★★★★★ | PostgreSQL tsvector + ts_rank_cd (Cover Density) + GIN 인덱스 |
| **RRF 점수 합산** | ★★★★★ | K=60 업계 표준, 양쪽 매칭 보너스 |
| **리랭킹** | ★★★★☆ | Cohere Rerank v3.5 (선택적). Cross-encoder 자체 모델은 미구현 |
| **Enriched Embedding** | ★★★★★ | 문서 메타 + 계층 라벨 + 태그/키워드 + 요약을 청크와 결합하여 임베딩 |
| **다국어 지원** | ★★★★☆ | 한국어 N-gram + 동의어 사전(50개). 형태소 분석기(Mecab 등) 미연동 |
| **필터링** | ★★★★★ | 문서 범위, 장/절, 태그, 카테고리 — 사전/사후 필터 모두 지원 |
| **결과 다양성** | ★★★★★ | MMR (λ=0.7) + 3-gram Jaccard 유사도로 중복 제거 |
| **쿼리 확장** | ★★★☆☆ | 동의어 확장만 구현. 쿼리 리라이팅, HyDE 미구현 |

**종합: ★★★★☆ (4.3/5)**

Hybrid RAG의 핵심 기법을 거의 완벽히 구현. 특히 RRF + Cohere Rerank + MMR 조합은 업계 최상위 패턴이다. 쿼리 확장(HyDE, 쿼리 리라이팅)과 형태소 분석기 통합이 개선 여지.

---

### 3-3. LangGraph 기준 평가

> LangGraph: LangChain 팀의 에이전트 프레임워크. 상태 머신 기반으로 복잡한 멀티스텝 워크플로우를 그래프로 정의.

| LangGraph 핵심 개념 | DocStore 구현 수준 | 상세 |
|---|---|---|
| **상태 그래프 (StateGraph)** | ★★☆☆☆ | 명시적 상태 머신 없음. 순차적 파이프라인으로 구현 |
| **멀티홉 검색** | ★★★★☆ | 1차 검색 → 참조 추출 → 2차 검색 (2홉). 동적 홉 수 조절은 없음 |
| **조건부 분기** | ★★★☆☆ | FTS 가능 여부 판단, Cohere 존재 여부 등 조건 분기 있으나 그래프로 정의되진 않음 |
| **도구 호출 (Tool Use)** | ★★☆☆☆ | LLM이 도구를 직접 선택하는 패턴 없음. 모든 검색을 코드에서 사전 결정 |
| **Self-RAG** | ★☆☆☆☆ | 검색 필요성 판단, 답변 충분성 평가 미구현 |
| **계획-실행 루프** | ★☆☆☆☆ | Plan-and-Execute 패턴 미구현 |
| **Corrective RAG** | ★★★☆☆ | 근거 verified 검증 + 환각 경고는 있으나, 재검색/자기 수정 루프 없음 |
| **Human-in-the-Loop** | ★★☆☆☆ | 사용자 피드백 수집 메커니즘 없음 (채팅 후속 질문만 가능) |
| **병렬 실행** | ★★★★☆ | 벡터/FTS 병렬 검색, 배치 임베딩 병렬 처리 구현 |
| **스트리밍** | ★★★★★ | SSE 토큰 단위 스트리밍 + 중간 소스 전송 |

**종합: ★★☆☆☆ (2.5/5)**

LangGraph의 핵심 가치인 "그래프 기반 에이전트 워크플로우"와는 거리가 있다. DocStore는 **고정된 파이프라인**을 잘 최적화한 형태이며, LLM이 스스로 판단하여 동작을 결정하는 에이전틱(agentic) 패턴은 아직 미도입이다.

**개선 시 기대효과:**
- Self-RAG 도입 → 불필요한 검색 제거, 답변 품질 자동 평가
- Corrective RAG 루프 → 검색 결과 불충분 시 쿼리 리라이팅 후 재검색
- Tool Use → "법령 검색", "문서 검색", "계산" 등 도구를 LLM이 선택

---

### 3-4. Graph RAG (Microsoft) 기준 평가

> Graph RAG: Microsoft Research의 접근법. 문서에서 지식 그래프(엔티티-관계)를 추출하고, 커뮤니티 탐지로 계층적 요약을 생성하여 글로벌 질의를 처리.

| Graph RAG 핵심 기법 | DocStore 구현 수준 | 상세 |
|---|---|---|
| **엔티티 추출** | ★★★☆☆ | 조문 번호(제N조) + 법령명 추출은 있으나, 범용 NER(인물/기관/개념) 미구현 |
| **관계 추출** | ★★★★☆ | 명시적 교차 참조 (정규식) + 시맨틱 교차 참조 (임베딩 유사도). 관계 유형 감지(준용/적용/예외/의거/위반) |
| **지식 그래프 구성** | ★★★☆☆ | cross_references 테이블로 조문 간 관계 저장. 범용 트리플스토어(Neo4j 등)는 미사용 |
| **그래프 시각화** | ★★★★☆ | D3.js force-directed 네트워크 그래프 + 통계(Top 참조 조문, 고립 조문, 장별 밀도) |
| **커뮤니티 탐지** | ★☆☆☆☆ | Leiden/Louvain 알고리즘 미구현. 장/절 기반 수동 그룹핑만 |
| **계층적 요약** | ★★☆☆☆ | 문서 요약 + 섹션별 요약은 있으나, 커뮤니티 단위 요약(Map-Reduce) 미구현 |
| **글로벌 질의** | ★★☆☆☆ | "이 법의 전체 구조는?" 같은 질문에 대한 전역 답변 능력 제한적 |
| **로컬 질의** | ★★★★★ | 하이브리드 검색 + 멀티홉으로 특정 조문/개념에 대한 정확한 답변 |
| **그래프 탐색** | ★★★☆☆ | 참조 관계 따라 이동 가능 (UI 링크 클릭). 그래프 순회 알고리즘(BFS/DFS) 미구현 |

**종합: ★★★☆☆ (2.8/5)**

DocStore는 법령 도메인에 특화된 **제한적 Graph RAG**를 구현했다. 조문 간 참조 그래프와 시각화는 인상적이지만, Microsoft Graph RAG의 핵심인 커뮤니티 탐지 → 계층 요약 → 글로벌 질의 파이프라인은 미구현이다.

**현재 강점:**
- 법령 조문 참조 관계가 잘 구조화됨 (metadata.references + referencedBy)
- 명시적 + 시맨틱 교차 참조 이중 구축
- D3.js 네트워크 시각화로 관계 탐색 가능

**Graph RAG 완성을 위해 필요한 것:**
- 범용 NER → 엔티티-관계 트리플 추출
- Leiden 커뮤니티 탐지 → 관련 조문 클러스터 자동 발견
- 커뮤니티별 Map-Reduce 요약 → 글로벌 질의 대응

---

### 종합 비교 매트릭스

```
                    LangChain    Hybrid RAG    LangGraph    Graph RAG
                    ─────────    ──────────    ─────────    ─────────
DocStore 수준       ★★★★☆        ★★★★☆         ★★☆☆☆        ★★★☆☆
                    (4.0/5)      (4.3/5)       (2.5/5)      (2.8/5)
```

| 영역 | 강점 | 약점 |
|------|------|------|
| **검색** | RRF + Rerank + MMR 조합은 업계 상위 | 쿼리 리라이팅, HyDE 미구현 |
| **임베딩** | Enriched Embedding + 4가지 청킹 전략 | 모델 선택지 1개 (OpenAI만) |
| **RAG** | 멀티홉 + 환각 검증 + 스트리밍 | Self-RAG, Corrective RAG 루프 없음 |
| **그래프** | 법령 참조 그래프 + D3 시각화 | 커뮤니티 탐지, 글로벌 질의 없음 |
| **에이전트** | 고정 파이프라인 최적화 우수 | LLM 자율 판단 패턴 부재 |
| **데이터 수집** | 크롤링 + 네이버 뉴스 + 지식화 파이프라인 | 스케줄링/자동 수집 미구현 |

---

## 4. 개선 로드맵 제안

### Phase 1 — 검색 품질 고도화 (단기)

| 항목 | 기법 | 기대 효과 |
|------|------|-----------|
| 쿼리 리라이팅 | LLM으로 검색 쿼리 최적화 | 모호한 질문의 검색 정확도 향상 |
| HyDE | 가상 답변 생성 → 임베딩 → 검색 | 벡터 검색 recall 20~30% 향상 |
| 형태소 분석기 | Mecab/KoNLPy 연동 | 한국어 FTS 정확도 향상 |
| 임베딩 모델 다양화 | Upstage, Cohere embed v3 선택 | 한국어 특화 임베딩 |

### Phase 2 — 에이전틱 RAG (중기)

| 항목 | 기법 | 기대 효과 |
|------|------|-----------|
| Self-RAG | 검색 필요성 + 답변 충분성 판단 | 불필요한 검색 제거, 답변 품질 자동 평가 |
| Corrective RAG | 검색 결과 평가 → 재검색 루프 | 검색 실패 시 자동 복구 |
| Tool Use | LLM이 "법령 검색/문서 검색/계산" 도구 선택 | 복잡한 질문 처리 능력 향상 |
| 관측성 | LangSmith 또는 자체 트레이싱 | RAG 파이프라인 디버깅/최적화 |

### Phase 3 — Graph RAG 완성 (장기)

| 항목 | 기법 | 기대 효과 |
|------|------|-----------|
| 범용 NER | LLM 기반 엔티티/관계 추출 | 법령 외 문서에도 그래프 적용 |
| 커뮤니티 탐지 | Leiden 알고리즘 | 관련 조문 클러스터 자동 발견 |
| 계층 요약 | 커뮤니티별 Map-Reduce 요약 | "법 전체 구조" 같은 글로벌 질의 |
| Neo4j 연동 | 전용 그래프 DB | 복잡한 그래프 순회 쿼리 |

### Phase 4 — 크롤링 자동화 (단기~중기)

| 항목 | 기법 | 기대 효과 |
|------|------|-----------|
| 스케줄링 | cron 기반 주기적 크롤링 | 수동 실행 없이 최신 데이터 유지 |
| 알림 | 신규 크롤링 결과 알림 | 관련 뉴스/게시물 실시간 파악 |
| 자동 지식화 | 점수 임계값 초과 시 자동 임포트 | 고관련성 문서 즉시 RAG 반영 |
| RSS/Atom 피드 | 추가 소스 유형 지원 | 크롤링 대상 다양화 |

---

## 5. E2E 테스트 현황

### 테스트 파일 목록

| 파일 | 테스트 수 | 대상 |
|------|----------|------|
| login.spec.js | 3 | 로그인/로그아웃 |
| navigation.spec.js | 5 | 탭 네비게이션 |
| documents.spec.js | 6 | 문서 목록/상세 |
| search.spec.js | 3 | 검색 기본 |
| **search-advanced.spec.js** | **27** | **검색 심화 (자동완성/하이라이팅/API 구조)** |
| **crawl.spec.js** | **29** | **크롤링 (소스/키워드/제외패턴/실행/지식화)** |
| chat.spec.js | 4 | AI 채팅 |
| ux-features.spec.js | - | UX 기능 |
| analyze-debug.spec.js | - | 분석/디버그 |

**총 테스트 수: 77개+**

### 검색 특화 테스트 (search-advanced.spec.js) 최종 결과

> 실행일: 2026-03-11 | 27개 전체 통과 | 소요시간: 약 1분 6초

| 카테고리 | 수 | 검증 항목 |
|---------|---|----------|
| UI 기본 요소 | 3 | 입력창, 모드 전환, 비활성화 |
| 자동완성 | 5 | API 호출, 드롭다운, 키보드 내비, 타입 구분, 단축키 안내 |
| 검색 실행 | 5 | hybrid/FTS/vector 3모드, 0건 처리, Enter 키 |
| 하이라이팅 | 3 | mark 태그, 스타일 적용, 통합 검색 하이라이팅 |
| 카드 상호작용 | 4 | 모달 이동, 매칭 뱃지, RRF 바, 더보기 |
| 필터 | 2 | 패널 열기, 멀티셀렉트 |
| API 응답 구조 | 4 | hybrid/FTS/vector 필드, headline 포함 |
| 자동완성 API | 1 | document/section 타입 구분 |

### 크롤링 테스트 (crawl.spec.js) 최종 결과

> 실행일: 2026-03-11 | 29개 전체 통과

| 카테고리 | 검증 항목 |
|---------|----------|
| 크롤링 탭 UI | 3개 모드 버튼, 4개 서브탭 |
| 소스 관리 UI | 소스 추가/수정/삭제 |
| 키워드 관리 UI | 키워드 추가/수정/삭제, 가중치 설정 |
| 제외 패턴 관리 | URL 패턴 추가/삭제 |
| 크롤링 실행 | 네이버 뉴스/사이트 게시판 실행 |
| 결과 미리보기 | 제목/점수/출처 표시, 체크박스 선택 |
| 지식화 | 선택 결과 → 문서 변환 |

---

## 6. DB 테이블 구조

### 기존 테이블

| 테이블 | 용도 |
|--------|------|
| documents | 문서 메타데이터 (제목/카테고리/태그/소프트삭제) |
| sections | 문서 섹션 (청크 텍스트 + 임베딩 벡터) |
| cross_references | 조문 간 교차 참조 관계 |
| chat_sessions | AI 채팅 세션 히스토리 |
| chat_messages | 채팅 메시지 (질문/답변) |
| api_usage | API 호출 사용량 추적 |
| users / organizations | 사용자/조직 관리 |

### 신규 테이블 (크롤링 — 2026-03-11)

| 테이블 | 용도 | 주요 컬럼 |
|--------|------|-----------|
| crawl_sources | 크롤링 대상 사이트 | name, board_url, base_url, css_selectors(jsonb), is_active |
| crawl_keywords | 검색 키워드 + 가중치 | keyword, max_results, title_weight, content_weight, is_active |
| crawl_results | 크롤링 결과 저장 | source_type(board/naver_news), title, url(UNIQUE), snippet, relevance_score, ingested |
| crawl_exclusions | 제외 URL 패턴 | url_pattern, reason, org_id(nullable=전역) |

**마이그레이션 스크립트:** `scripts/add-crawl-tables.js`

---

## 7. 파일 구조 (최신)

```
workspace/docstore/
├── server.js                    # Express 메인 서버 (29개 라우트)
├── index.html                   # SPA 프론트엔드 (React + Tailwind CDN, 6,811행)
├── vercel.json                  # Vercel 배포 설정 (21개 함수)
├── api/
│   ├── login.js                 # 관리자 JWT 로그인
│   ├── documents.js             # 문서 CRUD + 태그 + 분석 + 휴지통
│   ├── upload.js                # 멀티포맷 업로드 + 비식별화
│   ├── url-import.js            # 웹 URL 크롤링 임포트
│   ├── search.js                # 텍스트/벡터/하이브리드 검색 + 자동완성
│   ├── rag.js                   # RAG 질의응답 (SSE 스트리밍)
│   ├── law.js                   # 법령 검색/상세 프록시
│   ├── law-import.js            # 법령 임포트 + 참조 관계 구축
│   ├── law-graph.js             # 법령 참조 네트워크 그래프 API
│   ├── cross-references.js      # 교차 참조 매트릭스 조회
│   ├── summary.js               # AI 요약 생성/캐시
│   ├── ocr.js                   # OCR 엔진 관리
│   ├── chat-sessions.js         # 채팅 세션 저장/복원
│   ├── deidentify.js            # 문서 비식별화
│   ├── api-usage.js             # API 사용량 추적 (네이버 검색 API 포함)
│   ├── crawl.js                 # 사이트 게시판 크롤링 실행 (신규)
│   ├── naver-news.js            # 네이버 뉴스 검색 API 프록시 (신규)
│   ├── crawl-sources.js         # 크롤링 소스 CRUD (신규)
│   ├── crawl-keywords.js        # 크롤링 키워드 CRUD (신규)
│   └── crawl-ingest.js          # 크롤링 결과 선택적 지식화 (신규)
├── lib/
│   ├── embeddings.js            # 임베딩 생성 + enriched text
│   ├── text-splitters.js        # 4가지 청킹 전략
│   ├── hybrid-search.js         # 벡터 + FTS + RRF 합산
│   ├── reranker.js              # Cohere Rerank v3.5
│   ├── rag-agent.js             # 멀티홉 + MMR 에이전트
│   ├── output-parser.js         # JSON/마크다운 파싱 + 근거 검증
│   ├── korean-tokenizer.js      # N-gram + 동의어 사전
│   ├── cross-reference.js       # 명시적/시맨틱 교차 참조
│   ├── law-fetcher.js           # 법제처 API 헬퍼
│   ├── doc-analyzer.js          # AI 문서 분석 (Gemini)
│   ├── gemini.js                # 멀티 LLM 호출 (Gemini/OpenAI/Claude)
│   ├── db.js                    # PostgreSQL 커넥션 풀
│   ├── auth.js                  # JWT + 조직 격리
│   ├── cors.js                  # CORS 설정
│   ├── error-handler.js         # 에러 메시지 보안 (안전 패턴 화이트리스트)
│   ├── rate-limit.js            # Rate Limiting
│   ├── text-extractor.js        # 멀티포맷 텍스트 추출
│   ├── pdf-extractor.js         # PDF 특화 추출
│   └── ocr/                     # OCR 엔진 플러그인 (6개)
├── scripts/                     # DB 마이그레이션 스크립트
│   ├── add-crawl-tables.js      # 크롤링 테이블 생성 (신규)
│   └── ...                      # 기타 마이그레이션 (15개)
└── tests/                       # Playwright E2E 테스트
    ├── playwright.config.js
    ├── global-setup.js
    ├── search-advanced.spec.js  # 검색 특화 27개 테스트
    ├── crawl.spec.js            # 크롤링 특화 29개 테스트 (신규)
    ├── ux-features.spec.js      # UX 기능 테스트 (신규)
    ├── analyze-debug.spec.js    # 분석/디버그 테스트 (신규)
    └── *.spec.js                # 기타 테스트 (login, navigation, documents, search, chat)
```

---

## 8. 환경변수 목록

| 변수 | 용도 | 필수 |
|------|------|------|
| DATABASE_URL | Supabase PostgreSQL 연결 | ✅ |
| AUTH_TOKEN_SECRET | JWT 서명 키 | ✅ |
| ANTHROPIC_API_KEY | Claude API | ✅ |
| OPENAI_API_KEY | 임베딩 + GPT-4o | ✅ |
| GEMINI_API_KEY | Gemini LLM | 선택 |
| LAW_API_OC | 법제처 API 인증 | 선택 |
| COHERE_API_KEY | Rerank v3.5 | 선택 |
| NAVER_CLIENT_ID | 네이버 검색 API | 선택 (크롤링용) |
| NAVER_CLIENT_SECRET | 네이버 검색 API | 선택 (크롤링용) |

---

## 9. 변경 이력

| 날짜 | 변경 내용 |
|------|-----------|
| 2026-03-11 | 초판 작성 — RAG 아키텍처 수준 평가 + 기능 현황 분석 |
| 2026-03-11 | 크롤링 & 지식화 시스템 전체 구현 (API 5개 + 테스트 29개 + DB 4테이블) |
| 2026-03-11 | 설정 탭에 네이버 검색 API 관리 추가 |
| 2026-03-12 | ANALYSIS2.md 최신화 — 크롤링 기능/DB/테스트/파일구조/환경변수 반영 |
| 2026-03-12 | PDF 로더 플러그인 시스템 구현 계획 추가 |
| 2026-03-12 | LangChain 기준 평가 코드베이스 진단 — 9개 항목 코드 근거 분석, Callbacks 상향(★2→★3), HNSW 인덱스 DB 실존 확인, 종합 4.0→4.1 상향, 12개 개선 로드맵 추가 |

---

## 10. PDF 로더 플러그인 시스템 구현 계획

> 작성일: 2026-03-12
> 목적: PDF 텍스트 추출을 pdf-parse 단일 의존에서 **8개 로더 플러그인 시스템**으로 확장

### 10-1. 배경

현재 `lib/pdf-extractor.js`는 `pdf-parse` 하나에만 의존한다.
pdf-parse는 텍스트 PDF에 적합하지만 **표/레이아웃/이미지 PDF**에서 품질이 떨어진다.
사용자가 업로드 시 원하는 PDF 로더를 선택할 수 있도록 플러그인 시스템을 구축한다.

### 10-2. 지원 로더 (8개)

| # | 로더 | 타입 | 특징 |
|---|------|------|------|
| 1 | pdf-parse | Node.js | 현재 사용 중, 가벼움 |
| 2 | PDF.js (pdfjs-dist) | Node.js | 텍스트 위치/좌표 추출 가능 |
| 3 | Upstage Document Parse | HTTP API | 표/차트/수식 구조화 추출, 유료 |
| 4 | PyMuPDF (fitz) | Python | 가장 빠름, 대용량 문서 최적 |
| 5 | PyPDF | Python | 가볍고 표준적, 텍스트 위주 |
| 6 | PDFPlumber | Python | 표 추출 최강, 한글 최적화 |
| 7 | Unstructured | Python | 레이아웃/요소 분석, 정교한 전처리 |
| 8 | Docling (IBM) | Python | 문서 이해 AI, 구조화 추출 |

### 10-3. 아키텍처

```
lib/pdf-loaders/
├── index.js              # 레지스트리 + 선택/폴백 로직
├── pdf-parse.js          # Node.js 직접 실행
├── pdfjs.js              # Node.js 직접 실행
├── upstage-doc.js        # HTTP API 호출
├── pymupdf.js            # Python 브릿지 호출
├── pypdf.js              # Python 브릿지 호출
├── pdfplumber.js         # Python 브릿지 호출
├── unstructured.js       # Python 브릿지 호출
├── docling.js            # Python 브릿지 호출
├── python-bridge.js      # Python 호출 공통 모듈
└── python/
    ├── bridge.py          # 통합 Python 실행기 (stdin→stdout JSON)
    └── requirements.txt   # Python 의존성
```

#### Python 브릿지 전략

```
[Node.js 플러그인] → child_process.spawn('python3', ['bridge.py'])
                     stdin: { loader: 'pymupdf', pdfPath: '/tmp/xxx.pdf' }
                     stdout: { pages: [...], totalPages: N, method: 'pymupdf' }
```

- **로컬 개발**: `child_process.spawn()` 으로 Python 직접 실행
- **Vercel 배포**: Vercel Python 서버리스 함수 (`api/pdf-python.py`) 를 내부 HTTP 호출

#### 플러그인 인터페이스

```javascript
// 각 로더 플러그인의 공통 인터페이스
module.exports = {
  id: 'pymupdf',
  name: 'PyMuPDF (fitz)',
  type: 'python',                    // 'node' | 'python' | 'api'
  description: '가장 빠름, 대용량 문서 최적',
  bestFor: ['대용량', '속도'],
  envKey: null,                       // Python 설치만 필요
  free: true,
  isAvailable() { /* 설치 여부 확인 */ },
  async extract(pdfBuffer, options) { /* 추출 실행 → { pages, totalPages, fullText } */ },
};
```

### 10-4. 구현 순서 (10단계)

| 단계 | 내용 | 수정/신규 파일 |
|------|------|----------------|
| 1 | 플러그인 레지스트리 | **신규** `lib/pdf-loaders/index.js` |
| 2 | pdf-parse 로더 (기존 로직 분리) | **신규** `lib/pdf-loaders/pdf-parse.js` |
| 3 | pdf-extractor.js 리팩토링 | **수정** `lib/pdf-extractor.js` |
| 4 | upload.js에 pdfLoader 파라미터 추가 | **수정** `api/upload.js` |
| 5 | 로더 목록 API | **신규** `api/pdf-loaders.js`, **수정** `server.js` |
| 6 | 업로드 UI에 로더 선택 드롭다운 | **수정** `index.html` |
| 7 | pdfjs-dist 로더 | **신규** `lib/pdf-loaders/pdfjs.js`, **수정** `package.json` |
| 8 | Upstage Document Parse 로더 | **신규** `lib/pdf-loaders/upstage-doc.js` |
| 9 | Python 브릿지 + 5개 Python 로더 | **신규** `lib/pdf-loaders/python-bridge.js`, `python/bridge.py`, `pymupdf.js` 외 4개 |
| 10 | Vercel Python 함수 | **신규** `api/pdf-python.py`, `api/requirements.txt`, **수정** `vercel.json` |

### 10-5. 핵심 변경 사항

#### pdf-extractor.js 리팩토링

```javascript
// 변경 전: pdf-parse 하드코딩
const parsed = await pdfParse(pdfBuffer);

// 변경 후: 선택된 로더로 추출
const { pdfLoader = 'pdf-parse' } = options;
const { pages, totalPages, fullText } = await extractWithLoader(pdfLoader, pdfBuffer);
```

- 텍스트 추출 부분만 플러그인으로 교체
- 이미지 페이지 OCR, 섹션 분할, 퀴즈 파싱 등 후처리는 그대로 유지

#### api/upload.js 수정

```javascript
// pdfLoader 파라미터 수신
if (req.body.pdfLoader) extraOptions.pdfLoader = req.body.pdfLoader;

// PDF 추출 시 전달
extracted = await extractFromPdf(fileBuffer, {
  sectionType, customDelimiter,
  pdfLoader: extraOptions.pdfLoader || 'pdf-parse'
});
```

#### index.html UI 추가

- `FILE_TYPE_CONFIG.pdf`에 `hasPdfLoaderSelect: true` 추가
- `/api/pdf-loaders` 호출 → 사용 가능한 로더만 드롭다운 표시
- 각 로더 옆에 상태 뱃지 (사용가능/미설치/API키 필요)

### 10-6. 수정 대상 파일 총 목록

| 파일 | 변경 |
|------|------|
| `lib/pdf-loaders/index.js` | **신규** — 플러그인 레지스트리 |
| `lib/pdf-loaders/pdf-parse.js` | **신규** — 기존 로직 분리 |
| `lib/pdf-loaders/pdfjs.js` | **신규** — pdfjs-dist 로더 |
| `lib/pdf-loaders/upstage-doc.js` | **신규** — Upstage API 로더 |
| `lib/pdf-loaders/pymupdf.js` | **신규** — Python 브릿지 |
| `lib/pdf-loaders/pypdf.js` | **신규** — Python 브릿지 |
| `lib/pdf-loaders/pdfplumber.js` | **신규** — Python 브릿지 |
| `lib/pdf-loaders/unstructured.js` | **신규** — Python 브릿지 |
| `lib/pdf-loaders/docling.js` | **신규** — Python 브릿지 |
| `lib/pdf-loaders/python-bridge.js` | **신규** — Python 호출 공통 |
| `lib/pdf-loaders/python/bridge.py` | **신규** — Python 통합 실행기 |
| `lib/pdf-loaders/python/requirements.txt` | **신규** — Python 의존성 |
| `lib/pdf-extractor.js` | **수정** — pdfLoader 옵션 추가 |
| `api/upload.js` | **수정** — pdfLoader 파라미터 수신 |
| `api/pdf-loaders.js` | **신규** — 로더 목록 API |
| `api/pdf-python.py` | **신규** — Vercel Python 함수 |
| `api/requirements.txt` | **신규** — Vercel Python 의존성 |
| `server.js` | **수정** — 새 라우트 추가 |
| `vercel.json` | **수정** — Python 함수 설정 |
| `index.html` | **수정** — PDF 로더 선택 UI |
| `package.json` | **수정** — pdfjs-dist 추가 |

### 10-7. 검증 방법

1. **로컬**: `npm run dev` → 업로드 UI에서 각 로더 선택 후 추출 결과 비교
2. **API**: `GET /api/pdf-loaders` → 목록 + 가용성 확인
3. **Vercel**: `npx vercel --prod` → Node.js 로더 정상 동작, Python 로더 `/api/pdf-python` 경유 확인
4. **폴백**: Python 미설치 시 "미설치" 에러, API 키 없을 때 "키 필요" 상태 표시 확인
