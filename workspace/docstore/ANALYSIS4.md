# DocStore 프로젝트 발표 자료 v4

> 작성일: 2026-03-14
> 대상: workspace/docstore (PDF 문서 관리 + 법령 지식 RAG 시스템)
> 배포: [https://docstore-eight.vercel.app](https://docstore-eight.vercel.app)
> 이전 보고서: ANALYSIS3.md (2026-03-13)

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [전체 아키텍처](#2-전체-아키텍처)
3. [핵심 기능과 구현 원리](#3-핵심-기능과-구현-원리)
4. [v3 이후 주요 변경 사항](#4-v3-이후-주요-변경-사항)
5. [4대 프레임워크 기준 평가](#5-4대-프레임워크-기준-평가)
6. [E2E 테스트 현황](#6-e2e-테스트-현황)
7. [DB 스키마 및 API 전체 현황](#7-db-스키마-및-api-전체-현황)
8. [향후 과제](#8-향후-과제)

---

## 1. 프로젝트 개요

### 1.1 한 줄 요약

**DocStore**는 PDF·DOCX·법령 등 다양한 문서를 업로드하고, **지식 그래프 + 하이브리드 검색 + LLM 기반 RAG**로 질의응답하는 **법령·규정 도메인 특화 풀스택 웹 시스템**이다.

### 1.2 우리가 풀고 있는 문제

| 문제 | 기존 방식 | DocStore 방식 |
|------|-----------|---------------|
| 법령 조문을 찾으려면? | 법제처 사이트에서 수동 검색 | 법령 자동 임포트 + 하이브리드 검색 + 교차 참조 그래프 |
| 여러 법령 간 관계 파악 | 각 법령을 하나씩 열어보며 비교 | 지식 그래프(트리플) + 커뮤니티 탐지로 관계 시각화 |
| "이 법의 핵심이 뭐야?" 같은 질문 | 전문가에게 직접 질문 | RAG + 답변 가이드 + Few-shot으로 AI가 근거 기반 답변 |
| 최신 뉴스/게시판 정보 반영 | 수동으로 확인 후 정리 | 크롤링 → 자동 지식화 → 검색 가능 |

### 1.3 기술 스택 요약

| 계층 | 기술 | 비고 |
|------|------|------|
| 프론트엔드 | React 18 (CDN) + Tailwind CSS | 빌드 도구 없는 단일 SPA (10,000행+) |
| 백엔드 | Express.js (로컬) / Vercel Serverless (배포) | api/*.js 32개 엔드포인트 |
| DB | Supabase PostgreSQL + pgvector (HNSW) | 벡터 + FTS 이중 인덱스 |
| 임베딩 | OpenAI / Upstage Solar / Cohere embed-v3 | **3종 모델 선택 가능**, 자동 차원 마이그레이션 |
| LLM | Gemini 3.x/2.5 (기본), GPT-5.x/4o, Claude | 멀티 프로바이더 자동 전환 |
| 리랭킹 | Cohere Rerank v3.5 (선택) | Cross-encoder 기반 재순위화 |
| OCR | 6개 엔진 플러그인 | Gemini Vision, CLOVA, Cloud Vision 등 |
| 지식그래프 | PostgreSQL (엔티티+트리플) + Neo4j (선택) | Louvain/Leiden 커뮤니티 탐지 |
| 추적 | LangFuse + 자체 rag_traces 테이블 | 토큰/비용/파이프라인 단계별 기록 |

---

## 2. 전체 아키텍처

### 2.1 4계층 파이프라인

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       ① 데이터 입력 계층                                │
├─────────────────────────────────────────────────────────────────────────┤
│  PDF(8종 로더) │ DOCX │ XLSX/CSV │ JSON │ HWP/HWPX │ 이미지(OCR 6종)   │
│  URL 크롤링    │ 법제처 API(3종) │ 네이버 뉴스 │ 사이트 게시판 크롤링      │
└───────┬─────────────────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                      ② 텍스트 처리 계층                                 │
├─────────────────────────────────────────────────────────────────────────┤
│  텍스트 추출 → 섹션 분할 → 5가지 청킹 전략                                │
│  (sentence / recursive / law-article / semantic / markdown)            │
│  → Enriched Text (메타 8필드 + 원문) → 임베딩 (1536D/4096D/1024D)        │
│  → pgvector 저장 + tsvector FTS 인덱스                                  │
└───────┬─────────────────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                      ③ 지식 구조화 계층                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  NER (정규식 + LLM 하이브리드) → 5종 엔티티                               │
│  관계 추출 (정규식 14종 + LLM) → knowledge_triples                      │
│  교차 참조 매트릭스 (명시적 + 시맨틱)                                      │
│  커뮤니티 탐지 (Louvain / Leiden) → LLM 요약 생성                         │
└───────┬─────────────────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────────────────────────┐
│            ④ RAG 질의응답 계층 (StateGraph 9노드)                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  toolRouter → toolExecutor → search → augment → generate → parse       │
│                                           ↓                             │
│                                     → verify → finalize                 │
│                                        ↓ (불충분?)                       │
│                                  correctiveRewrite → search (재루프)     │
│                                                                         │
│  + SSE 실시간 스트리밍 + Few-shot 자동 매칭 + 답변 가이드                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 배포 구조

```
로컬 개발:  server.js (Express) → 모든 API 라우트 통합
Vercel 배포: api/*.js 각 파일이 독립 서버리스 함수로 동작

├── vercel.json: 함수별 maxDuration 설정 (RAG 300초, 크롤링 120초 등)
├── lib/*.js: 공유 비즈니스 로직 (RAG 그래프, 검색, 임베딩 등)
└── index.html: CDN 기반 SPA (빌드 도구 불필요)
```

---

## 3. 핵심 기능과 구현 원리

### 3.1 문서 업로드 & 임베딩

**사용자가 하는 일**: 파일을 드래그앤드롭 → 카테고리·청킹 전략 선택 → 업로드

**내부 동작 원리**:

```
[파일 선택]
    ↓
detectFileType() — 확장자로 파일 형식 감지
    ↓
extractFromFile() — 형식별 텍스트 추출
  ├── PDF: 8개 로더 플러그인 (pdf-parse, pdfjs, pymupdf 등)
  ├── DOCX: mammoth (단락 단위)
  ├── XLSX: xlsx 라이브러리 (행 단위)
  ├── HWP/HWPX: hwp.js
  └── 이미지: OCR 엔진 매니저 (6개 엔진 폴백 체인)
    ↓
splitText() — 5가지 청킹 전략 중 선택
  ├── sentence: 마침표 기준 (범용)
  ├── recursive: 구분자 계층 (LangChain과 동일 패턴)
  ├── law-article: 제N조 패턴 + 항(①②③) 세분화
  ├── semantic: Gemini Flash AI 분할
  └── markdown: 헤딩(#) 계층 파싱 + 접두어 부착
    ↓
buildEnrichedText() — 메타 정보를 청크 텍스트에 결합
  "[문서] 개인정보보호법 [분류] 법령 [조항] 제15조 ... (원문)"
    ↓
generateEmbeddings() — 3종 모델 중 선택 (배치 병렬 처리)
  ├── OpenAI text-embedding-3-small (1536차원)
  ├── Upstage Solar embedding (4096차원, 한국어 1위)
  └── Cohere embed-multilingual-v3.0 (1024차원)
    ↓
DB INSERT — document_chunks 테이블 (배치 50개씩)
  + FTS tsvector 자동 갱신 (트리거)
```

**핵심 설계 포인트**:
- **Enriched Text**: 원문에 메타데이터(문서명, 분류, 조항 등)를 결합하여 임베딩 → 검색 정확도 향상
- **멀티 모델 임베딩**: 모델 변경 시 DB 벡터 컬럼 차원을 자동 마이그레이션 (`ALTER COLUMN ... TYPE vector(N)`)
- **대용량 파일**: 4.5MB 이상은 Supabase Storage signed URL 경유

---

### 3.2 하이브리드 검색 (Hybrid RAG의 핵심)

**사용자가 하는 일**: 검색어 입력 → 통합/텍스트/의미 중 선택 → 결과 확인

**내부 동작 원리 — 5단계 파이프라인**:

```
질문: "개인정보 수집 시 동의가 필요한가?"
    ↓
[1단계] 병렬 검색
  ├── vectorSearch(): 질문 임베딩 → pgvector cosine similarity (HNSW 인덱스)
  └── ftsSearch(): N-gram 토크나이저 → tsvector @@ tsquery + ts_rank_cd (GIN 인덱스)
    ↓
[2단계] RRF 합산 (Reciprocal Rank Fusion, K=60)
  score = 1/(rank_vector + 60) + 1/(rank_fts + 60)
  양쪽 모두 매칭 시 보너스 가산
    ↓
[3단계] Cohere Rerank v3.5 (선택)
  최대 4096 토큰/문서, Cross-encoder 관련성 점수 재계산
    ↓
[4단계] 점수 정규화 + 가중 합산
  finalScore = vector(0.4) + RRF(0.3) + Rerank(0.3)
    ↓
[5단계] MMR 다양성 보장 (λ=0.7)
  3-gram Jaccard 유사도로 중복 제거
    ↓
최종 결과 (topK건) + 하이라이팅 + 확장 검색어 표시
```

**핵심 설계 포인트**:
- **RRF 합산**: 벡터와 키워드 검색의 랭킹을 하나로 합치는 업계 표준 기법
- **MMR**: 결과 다양성 보장 — 유사한 문서 반복 방지
- **FTS 폴백**: 임베딩 API 장애 시 FTS만으로 검색 계속 동작 (graceful degradation)
- **쿼리 확장**: 동의어 사전(~50개) + N-gram 한국어 토크나이저

---

### 3.3 RAG 질의응답 (StateGraph 9노드)

**사용자가 하는 일**: 채팅 탭에서 질문 입력 → SSE 스트리밍으로 실시간 답변 수신

**내부 동작 원리 — StateGraph 9노드 파이프라인**:

#### 노드 1: toolRouter (도구 라우터)

LLM이 질문을 분석하여 적절한 도구를 자동 선택한다.

```
사용 가능한 도구 4종:
  ├── document_search: 문서 검색 (기본)
  ├── knowledge_graph: 지식 그래프 탐색
  ├── summarize: 문서 요약
  └── direct_answer: 검색 없이 직접 답변 (인사, 단순 질문)

예시:
  "개인정보보호법 제15조 내용이 뭐야?" → [document_search]
  "이 법의 전체 구조를 보여줘" → [knowledge_graph, summarize]
  "안녕하세요" → [direct_answer]
```

**원리**: LLM에게 도구 설명과 예시를 제공하고, JSON 배열로 선택하게 한다. 실패 시 `document_search`로 폴백.

#### 노드 2: toolExecutor (도구 실행)

선택된 도구들을 **병렬 실행**하고 결과를 state에 병합한다.

#### 노드 3: search (멀티홉 검색)

```
쿼리 강화 (병렬):
  ├── rewriteQuery(): 복합 질문 → 2~3개 하위 쿼리 분해 (LLM)
  │   "개인정보 동의" → ["개인정보 수집 동의 요건", "정보주체 동의 절차"]
  └── generateHyDE(): 가상 답변 문서 생성 → 임베딩
      → blendEmbeddings(원본 75% + HyDE 25%)

1차 검색: 하이브리드 (벡터 + FTS + RRF)
    ↓
참조 추출: "개인정보보호법 제15조" 같은 타법령 참조 감지
    ↓
2차 검색: 참조된 법령/조문 추가 검색 (멀티홉)
    ↓
병합 + 중복 제거 + Cohere Rerank + MMR
```

**원리**: 1차 검색 결과에서 타법령 참조를 감지하면, 해당 법령을 2차 검색하여 더 풍부한 근거를 확보한다 (멀티홉).

#### 노드 4: augment (컨텍스트 증강)

```
카테고리 감지 → 검색 결과의 대표 카테고리 결정
    ↓
컨텍스트 텍스트: [근거 1] 제목 → 텍스트
    ↓
지식그래프 트리플: 질문과 관련된 엔티티-관계 15개
  "[개인정보보호법] —적용→ [정보주체] —보호→ [개인정보]"
    ↓
커뮤니티 요약: 관련 커뮤니티 3개의 글로벌 컨텍스트
    ↓
Few-shot 예시:
  ├── 사용자 선택: UI에서 체크한 과거 Q&A (우선)
  └── 자동 매칭: rag_traces에서 키워드 유사도로 상위 2개
    ↓
프롬프트 빌드: 템플릿(DB/폴백) + 변수 치환 + Few-shot 주입
```

#### 노드 5: generate (LLM 호출)

```
stream=true: callLLMStream() → SSE 토큰 단위 전송
stream=false: callLLM() → 전체 응답 한 번에 반환
재시도: 스트리밍 실패 시 비스트리밍 fallback (1회)
```

#### 노드 6: parse (출력 파싱)

```
[1단계] tryParseJSON(): ```json 코드블록 → JSON.parse → 검증
[2단계] parseMarkdownAnswer(): ### 헤딩 기준 섹션 추출 (폴백)
   → sourceIndex 범위 검증 (환각 방지)
   → verified 플래그 (근거 존재 여부)
```

#### 노드 7: verify (답변 검증 — Corrective RAG)

```
2차 LLM 호출: "이 답변이 근거 자료와 일치하는가?"
→ verification { score, confidence, shouldRetry, retryQuery }

판단 결과:
  점수 높음 → finalize (종료)
  점수 낮음 → correctiveRewrite (재검색)
```

#### 노드 8: correctiveRewrite (재검색 준비)

```
수정된 쿼리로 교체 → search 노드로 복귀 (루프)
최대 2회 재시도 (무한 루프 방지)
```

**원리**: 답변이 근거에 부합하지 않으면, LLM이 제안한 수정 쿼리로 재검색하여 답변 품질을 자동 개선한다.

#### 노드 9: finalize (저장)

```
rag_traces 테이블에 전체 파이프라인 기록
LangFuse 트레이스 종료
SSE 'done' 이벤트 발행
```

#### 전체 흐름도

```
toolRouter → toolExecutor → search → augment → generate → parse
                                                           ↓
                                                         verify
                                                        ↙     ↘
                                          correctiveRewrite   finalize
                                              ↓
                                            search (재루프, 최대 2회)
```

---

### 3.4 지식 그래프 & 커뮤니티 탐지

**사용자가 하는 일**: 문서 탭 → 문서 선택 → "지식그래프" 버튼 → 구축 실행

**내부 동작 원리**:

#### 엔티티 추출 (2단계)

```
[1단계] 정규식 NER (항상 실행, 빠름)
  ├── law: "개인정보보호법", "정보통신망법"
  ├── article: "제10조", "제3조의2제1항"
  ├── organization: "개인정보보호위원회" (기관명 사전)
  ├── concept: "동의", "비식별화" (45개 개념 사전)
  └── duty: "~의무", "~권리", "~책임" (패턴)
    ↓
[2단계] LLM NER (선택, 정규식 결과를 힌트로 전달)
  Few-shot 프롬프트 → Gemini Flash
  "정규식이 이미 찾은 엔티티 (건너뛰세요): ..."
  → 정규식이 놓친 복합 용어, 약칭 보완
```

#### 관계 추출

```
문장 단위로 엔티티 쌍 감지 → 14가지 관계 패턴 매칭:
  "~을 준용한다" → 준용
  "~에 적용된다" → 적용
  "~의 예외로" → 예외
  ...등 14종
```

#### 커뮤니티 탐지 (Louvain / Leiden)

```
그래프 구축: 엔티티→노드, 트리플→양방향 엣지(가중치=confidence)
    ↓
알고리즘 자동 선택:
  법령 문서(article 비율 높음) → Leiden (정밀)
  일반 문서 → Louvain (빠름)
    ↓
커뮤니티별 LLM 요약 생성
    ↓
글로벌 검색: 질문 키워드 ↔ 커뮤니티 요약 매칭 → RAG 컨텍스트 주입
```

**핵심 설계 포인트**:
- Louvain/Leiden 알고리즘을 **순수 JavaScript로 구현** → Vercel 서버리스에서 외부 라이브러리 없이 동작
- 커뮤니티 요약이 RAG에 자동 주입되어 "이 법의 전체 구조" 같은 **글로벌 질의** 대응 가능

---

### 3.5 멀티 모델 임베딩 (v4 신규)

ANALYSIS3에서 "임베딩 모델 1종 한계"로 지적된 사항이 해결되었다.

| 모델 | 차원 | 특징 |
|------|------|------|
| OpenAI text-embedding-3-small | 1536 | 범용, 빠르고 저렴 (기본값) |
| Upstage Solar embedding | 4096 | 한국어 임베딩 1위, 법률 문서에 최적 |
| Cohere embed-multilingual-v3.0 | 1024 | 다국어 검색 최적화, Reranker와 시너지 |

**모델 변경 시 자동 처리**:
```
설정에서 모델 변경
    ↓
DB 벡터 컬럼 차원 자동 마이그레이션
  ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(4096)
    ↓
기존 임베딩은 무효 → 재임베딩 필요 (알림 표시)
```

---

### 3.6 API 키 관리 & Graceful Degradation (v4 신규)

#### API 키 비활성 시 전체 화면 차단

```
설정 탭에서 API 키 비활성화
    ↓
ApiKeyStatusContext (React Context) → 모든 탭에 전파
    ↓
각 탭별 대응:
  ├── 검색 탭: 벡터 검색 비활성 (하이브리드는 FTS 폴백으로 동작)
  ├── 채팅 탭: LLM 또는 임베딩 비활성 시 전송 차단 + 경고 배너
  ├── 문서 탭: AI 분석/요약/임베딩 버튼 비활성
  └── 설정 탭: 토글 즉시 반영
```

#### 환경변수 자동 활성화

```
대시보드 로드 시:
  환경변수(OPENAI_API_KEY 등) 설정된 프로바이더 자동 감지
    ↓
  is_active = true, daily_limit = 0 (무제한) 자동 설정
```

#### 임베딩 실패 시 FTS 폴백

```
hybridSearch() 실행:
  임베딩 생성 시도 → 실패 (API 비활성/한도 초과)
    ↓
  FTS(텍스트 검색)만으로 검색 계속 진행
    ↓
  결과에 경고 메시지 첨부: "임베딩 API 오류로 텍스트 검색만 사용됨"
```

---

### 3.7 크롤링 & 지식화

**사용자가 하는 일**: 설정 탭 → 크롤링 소스/키워드 등록 → 실행 → 결과에서 선택 → 지식화

**내부 동작**:
```
[소스 기반 크롤링]
  사이트 게시판 URL → HTML 파싱 (3가지 패턴 자동 매칭)
  → 제목/본문/URL 추출 → 멀티키워드 점수 계산 → 상위 N건 필터
  → crawl_results 저장

[지식화]
  선택된 crawl_results → documents INSERT
  → 텍스트 추출 → 청크 분할 → 임베딩 → RAG 검색 가능
```

**v4 신규 기능**:
- 멀티키워드 선택 + 스코어 기반 상위 N건 필터
- 사이트 중요도(importance) 설정
- 소스/키워드/제외사이트 인라인 편집
- ECONNRESET 에러 자동 재시도

---

### 3.8 기타 핵심 기능

| 기능 | 파일 | 설명 |
|------|------|------|
| **답변 가이드** | index.html (ChatTab) | 주제/관점/답변형식 3가지 가이드로 AI 답변 방향 제어 |
| **Few-shot 자동 매칭** | lib/few-shot-manager.js | 과거 성공 Q&A에서 유사 예시를 자동 검색, 사용자가 선택/해제 가능 |
| **프롬프트 관리** | lib/prompt-manager.js | DB 기반 프롬프트 템플릿 + 카테고리별 분기 + Few-shot 자동 삽입 |
| **법령 검색·임포트** | lib/law-fetcher.js | 법제처 API 3종 (법령명, 조문, 본문) 연동 |
| **교차 참조 매트릭스** | lib/cross-reference.js | 문서 간 명시적·시맨틱 참조 관계 분석 |
| **비식별화** | lib/deidentify.js | 개인정보 키워드 자동 마스킹 |
| **RAG 트레이싱** | lib/rag-tracer.js + LangFuse | 파이프라인 전 단계 기록 + 비용 추적 |
| **인증** | lib/auth.js | JWT(HS256) + 조직(org_id) 격리 |

---

## 4. v3 이후 주요 변경 사항 (03-13 → 03-14)

### 4.1 코드 변경 커밋 (8건)

| 커밋 | 유형 | 내용 |
|------|------|------|
| `c0b10b1` | fix | 법령 검색 시 입력 공백 자동 제거 |
| `f5a018a` | feat | API 키 비활성 시 전체 화면에서 관련 기능 차단 (ApiKeyStatusContext) |
| `3abe5f6` | fix | 검색 시 임베딩 API 비활성/한도 초과 에러 graceful 처리 (FTS 폴백) |
| `5c9fbf5` | fix | 환경변수 설정된 API 키 자동 활성화 및 무제한 보장 |
| `3ed1ff9` | fix | AI 채팅 답변 가이드 버튼 가시성 개선 (아이콘+텍스트+pulse) |
| `628eb48` | fix | 임베딩 모델 변경 후 전체 기능 장애 수정 (서버리스 캐시 동기화) |
| `d5ef107` | fix | 임베딩 모델 변경 시 DB 벡터 차원 자동 마이그레이션 |
| `850b83d` | feat | 크롤링 소스 신규 추가 시 사이트 중요도 속성 + 크롤링/임베딩 안정화 |

### 4.2 ANALYSIS3 대비 핵심 변화 요약

| 항목 | ANALYSIS3 상태 | 현재 상태 |
|------|----------------|-----------|
| 임베딩 모델 | 1종 (OpenAI) | **3종** (OpenAI/Upstage/Cohere) + 자동 차원 마이그레이션 |
| Tool Router | 미구현 | **구현** — LLM이 4개 도구 중 자동 선택 |
| Corrective RAG | verify 노드만 | **verify + correctiveRewrite + 재검색 루프** (최대 2회) |
| API 키 관리 | 단순 활성/비활성 | **React Context로 전체 화면 전파** + 환경변수 자동 활성화 + 무제한 |
| 임베딩 장애 대응 | 500 에러 반환 | **FTS 폴백** + 경고 메시지 |
| 답변 가이드 UI | 아이콘만 | **아이콘+텍스트+"가이드"** + pulse 인디케이터 + 빈 채팅 소개 카드 |

---

## 5. 4대 프레임워크 기준 평가

```
평가 등급:
  ★★★★★  업계 최상위 수준 (프로덕션 급)
  ★★★★☆  대부분 구현, 일부 고급 기능 부재
  ★★★☆☆  핵심 구현 완료, 최적화 여지 있음
  ★★☆☆☆  기본 구현, 주요 기능 누락
  ★☆☆☆☆  초기 단계
```

---

### 5-1. LangChain 기준 평가

> **LangChain**: 가장 널리 쓰이는 RAG 프레임워크. 모듈형 체인, 다양한 리트리버, 프롬프트 관리가 핵심.

| LangChain 핵심 컴포넌트 | ANALYSIS3 | 현재 | 변화 | 근거 |
|---|---|---|---|---|
| **Document Loaders** | ★★★★★ | ★★★★★ | 유지 | 14종 로더 + HWP/HWPX |
| **Text Splitters** | ★★★★★ | ★★★★★ | 유지 | 5전략 + 프리셋 + 미리보기 |
| **Embeddings** | ★★★★☆ | ★★★★★ | **상향** | 3종 모델 선택 가능 + 자동 차원 마이그레이션 (1종 한계 해소) |
| **Vector Stores** | ★★★★☆ | ★★★★★ | **상향** | pgvector HNSW + GIN FTS + 동적 차원 변경 |
| **Retrievers** | ★★★★★ | ★★★★★ | 유지 | RRF + Rerank + MMR + HyDE + 쿼리리라이팅 |
| **Chains/Prompts** | ★★★★☆ | ★★★★☆ | 유지 | DB 템플릿 + 카테고리별 분기 + Few-shot |
| **Memory** | ★★★★☆ | ★★★★☆ | 유지 | DB 세션 + 20메시지 윈도우 |
| **Output Parsers** | ★★★★☆ | ★★★★☆ | 유지 | JSON+MD 2단 폴백 + 환각 검증 |
| **Callbacks/Tracing** | ★★★★☆ | ★★★★☆ | 유지 | LangFuse 연동 + rag_traces + API 비용 추적 |

**종합: ★★★★☆ (4.4) → ★★★★★ (4.6/5)**

**상향 이유**:
- Embeddings: ★4→★5 — 3종 모델 선택 가능 (OpenAI/Upstage/Cohere), ANALYSIS3에서 "모델 1종 한계"로 지적된 사항 해결
- Vector Stores: ★4→★5 — 모델 변경 시 DB 벡터 차원 동적 마이그레이션 지원

**잔여 격차**:
- Memory: 대화 요약(ConversationSummaryMemory) 미구현
- Output Parsers: 자동 재시도(OutputFixingParser) 미구현

---

### 5-2. Hybrid RAG 기준 평가

> **Hybrid RAG**: 키워드 검색 + 벡터 검색을 결합하여 단일 방식의 한계를 극복하는 접근법.

| Hybrid RAG 핵심 기법 | ANALYSIS3 | 현재 | 변화 | 근거 |
|---|---|---|---|---|
| **벡터 검색** | ★★★★★ | ★★★★★ | 유지 | pgvector cosine + HNSW |
| **키워드 검색** | ★★★★★ | ★★★★★ | 유지 | tsvector + ts_rank_cd + GIN |
| **RRF 점수 합산** | ★★★★★ | ★★★★★ | 유지 | K=60 업계 표준 |
| **리랭킹** | ★★★★☆ | ★★★★☆ | 유지 | Cohere Rerank v3.5 |
| **Enriched Embedding** | ★★★★★ | ★★★★★ | 유지 | 메타 8필드 결합 |
| **다국어 지원** | ★★★★☆ | ★★★★☆ | 유지 | N-gram + 동의어 50개 |
| **필터링** | ★★★★★ | ★★★★★ | 유지 | 문서/장/태그/카테고리 |
| **결과 다양성** | ★★★★★ | ★★★★★ | 유지 | MMR (λ=0.7) + Jaccard |
| **쿼리 확장** | ★★★★★ | ★★★★★ | 유지 | 동의어 + 리라이팅 + HyDE + 블렌딩 |
| **Few-shot 컨텍스트** | ★★★★☆ | ★★★★☆ | 유지 | 과거 Q&A 자동 매칭 + 사용자 선택 |
| **Graceful Degradation** | — | ★★★★★ | **신규** | 임베딩 실패 시 FTS 폴백 + 경고 메시지 |
| **멀티 모델 임베딩** | — | ★★★★★ | **신규** | 3종 임베딩 모델 선택 + 차원 자동 마이그레이션 |

**종합: ★★★★★ (4.7) → ★★★★★ (4.8/5)**

**상향 이유**:
- Graceful Degradation: 임베딩 API 장애 시에도 FTS만으로 검색 계속 동작 — 프로덕션 안정성 핵심
- 멀티 모델: 법률 특화(Upstage), 다국어(Cohere) 등 용도별 최적 모델 선택 가능

**잔여 격차**:
- 형태소 분석기(Mecab/KoNLPy) 미연동
- Cross-encoder 자체 모델 학습 미구현

---

### 5-3. LangGraph 기준 평가

> **LangGraph**: LangChain 팀의 에이전트 프레임워크. 상태 머신 기반 멀티스텝 워크플로우를 그래프로 정의.

| LangGraph 핵심 개념 | ANALYSIS3 | 현재 | 변화 | 근거 |
|---|---|---|---|---|
| **상태 그래프 (StateGraph)** | ★★★★☆ | ★★★★☆ | 유지 | addNode/addEdge/addConditionalEdge/compile/invoke |
| **멀티홉 검색** | ★★★★☆ | ★★★★☆ | 유지 | 1→2홉 고정 |
| **조건부 분기** | ★★★★☆ | ★★★★☆ | 유지 | search/verify 분기를 그래프 엣지로 정의 |
| **도구 호출 (Tool Use)** | ★★☆☆☆ | ★★★★☆ | **대폭 상향** | Tool Router + Tool Executor 구현 (4종 도구 LLM 자동 선택) |
| **Self-RAG** | ★☆☆☆☆ | ★★★☆☆ | **상향** | Tool Router가 direct_answer 선택 시 검색 생략 (부분적 Self-RAG) |
| **계획-실행 루프** | ★☆☆☆☆ | ★☆☆☆☆ | 유지 | Plan-and-Execute 미구현 |
| **Corrective RAG** | ★★★★☆ | ★★★★★ | **상향** | verify → correctiveRewrite → search 재루프 (최대 2회), 완전한 Corrective RAG 패턴 |
| **Human-in-the-Loop** | ★★★☆☆ | ★★★☆☆ | 유지 | 답변 가이드 + Few-shot 선택 |
| **병렬 실행** | ★★★★☆ | ★★★★☆ | 유지 | 벡터/FTS 병렬, 쿼리리라이팅+HyDE 병렬 |
| **스트리밍** | ★★★★★ | ★★★★★ | 유지 | SSE 토큰 단위 + 중간 이벤트 |
| **재시도/폴백** | ★★★★☆ | ★★★★☆ | 유지 | 스트리밍→비스트리밍 fallback |
| **이벤트 시스템** | ★★★★☆ | ★★★★☆ | 유지 | emitEvent → SSE 실시간 전달 |

**종합: ★★★☆☆ (3.3) → ★★★★☆ (3.8/5)**

**상향 이유**:
1. **Tool Use**: ANALYSIS3에서 "LLM이 도구를 선택하는 패턴 없음"이던 것이 `toolRouterNode` + `toolExecutorNode`로 완전 구현. LLM이 4개 도구(document_search, knowledge_graph, summarize, direct_answer) 중 적절한 것을 JSON으로 선택하고 병렬 실행.
2. **Corrective RAG 완성**: ANALYSIS3의 verify 노드에 더해 `correctiveRewriteNode`가 추가됨. 답변이 불충분하면 수정 쿼리로 재검색 → 재생성 → 재검증하는 완전한 자기 교정 루프.
3. **Self-RAG 부분 구현**: Tool Router가 `direct_answer`를 선택하면 검색 없이 직접 답변하므로, "검색이 필요한가?" 판단이 부분적으로 구현됨.

**잔여 격차**:
- 완전한 Self-RAG: 검색 결과의 충분성을 판단하여 추가 검색을 동적으로 결정하는 패턴은 미구현
- Plan-and-Execute: 복잡한 질문을 계획 → 단계별 실행하는 루프 미구현

---

### 5-4. Graph RAG (Microsoft) 기준 평가

> **Graph RAG**: 문서에서 지식 그래프를 추출하고, 커뮤니티 탐지 → 계층 요약 → 글로벌 질의를 처리하는 접근법.

| Graph RAG 핵심 기법 | ANALYSIS3 | 현재 | 변화 | 근거 |
|---|---|---|---|---|
| **엔티티 추출** | ★★★★☆ | ★★★★☆ | 유지 | 정규식 NER 5종 + LLM 하이브리드 |
| **관계 추출** | ★★★★★ | ★★★★★ | 유지 | 정규식 14종 + LLM 관계 추출 |
| **지식 그래프 구성** | ★★★★☆ | ★★★★☆ | 유지 | entities + knowledge_triples + Neo4j 선택 |
| **그래프 시각화** | ★★★★☆ | ★★★★☆ | 유지 | D3.js force-directed + 커뮤니티 색상 |
| **커뮤니티 탐지** | ★★★★☆ | ★★★★☆ | 유지 | Louvain + Leiden 순수 JS |
| **계층적 요약** | ★★★★☆ | ★★★★☆ | 유지 | 커뮤니티별 LLM 요약 |
| **글로벌 질의** | ★★★★☆ | ★★★★☆ | 유지 | 커뮤니티 요약 키워드 매칭 |
| **로컬 질의** | ★★★★★ | ★★★★★ | 유지 | 하이브리드 검색 + 멀티홉 + 트리플 |
| **그래프 탐색** | ★★★☆☆ | ★★★☆☆ | 유지 | UI 링크 클릭 이동 |
| **트리플 → RAG 통합** | ★★★★☆ | ★★★★★ | **상향** | Tool Router가 knowledge_graph 도구로 트리플을 적극 활용 |

**종합: ★★★★☆ (3.9) → ★★★★☆ (4.0/5)**

**상향 이유**:
- 트리플 RAG 통합: Tool Router가 `knowledge_graph` 도구를 선택하면 지식 그래프 데이터가 RAG 컨텍스트에 더욱 효과적으로 통합됨

**잔여 격차**:
- Map-Reduce 요약: 커뮤니티 간 계층적 요약(상위 커뮤니티) 미구현
- 그래프 순회 알고리즘: BFS/DFS 기반 관련 엔티티 자동 탐색 미구현
- 동적 그래프 업데이트: 문서 추가 시 증분 업데이트 없음 (전체 재구축)

---

### 5-5. 종합 비교 매트릭스

```
                    LangChain    Hybrid RAG    LangGraph    Graph RAG
                    ─────────    ──────────    ─────────    ─────────
ANALYSIS2 (03-12)   ★★★★☆        ★★★★★         ★★☆☆☆        ★★★☆☆
                    (4.2/5)      (4.6/5)       (2.5/5)      (2.8/5)

ANALYSIS3 (03-13)   ★★★★☆        ★★★★★         ★★★☆☆        ★★★★☆
                    (4.4/5)      (4.7/5)       (3.3/5)      (3.9/5)

현재 v4 (03-14)     ★★★★★        ★★★★★         ★★★★☆        ★★★★☆
                    (4.6/5)      (4.8/5)       (3.8/5)      (4.0/5)

변화 (v3→v4)        +0.2         +0.1          +0.5         +0.1
누적 변화 (v2→v4)   +0.4         +0.2          +1.3         +1.2
```

**핵심 분석**:

| 항목 | 값 | 설명 |
|------|-----|------|
| **최대 강점** | Hybrid RAG (4.8/5) | 업계 최상위 수준의 검색 파이프라인 + FTS 폴백 안정성 |
| **최대 성장** | LangGraph (+1.3 누적) | 2.5→3.8, StateGraph+Tool Router+Corrective RAG 순차 구현 |
| **균형 성장** | Graph RAG (+1.2 누적) | 커뮤니티 탐지·요약·글로벌 검색 일괄 구현 후 Tool Router 통합 |
| **차기 과제** | LangGraph (3.8/5) | Plan-and-Execute, 완전한 Self-RAG 도입 여지 |

---

## 6. E2E 테스트 현황

### 6.1 테스트 결과 요약

| 항목 | 수치 |
|------|------|
| 총 테스트 수 | 126개 |
| 통과 | 121개 (96%) |
| fixme/skip | 5개 (환경 의존적) |
| 실패 | 0개 |

### 6.2 탭별 테스트 커버리지

| 탭 | 테스트 수 | 통과율 | 주요 검증 항목 |
|------|-----------|--------|----------------|
| 검색 | 30개 | 100% | 통합/텍스트/벡터 검색, 자동완성, 필터, 정렬, Few-shot 제안 |
| 크롤링 | 28개 | 100% | 소스/키워드 CRUD, 인라인 편집, 지식화, 멀티키워드 |
| PDF 로더 | 18개 | 100% | 8종 로더, 대용량, 청킹 전략, 미리보기 |
| UX | 11개 | 100% | 다크모드, 반응형, 탭 전환, 키보드, 접근성 |
| 네비게이션 | 7개 | 100% | 6탭 구조, URL 해시 라우팅, 인증 가드 |
| 인증 | 5개 | 100% | 로그인, 토큰 갱신, 만료 처리 |
| AI 채팅 | 5개 | 100% | 세션 관리, 스트리밍, 가이드 |

---

## 7. DB 스키마 및 API 전체 현황

### 7.1 DB 테이블 (26개)

```
organizations               ← 다중 조직 지원 (multi-tenancy)
├─ documents                ← 문서 메타 (제목, 카테고리, 요약, storage_path)
│  ├─ document_sections     ← 섹션 (raw_text, fts_vector, fts_morpheme_vector)
│  │  └─ document_chunks    ← 청크 (chunk_text, embedding[1536/4096/1024], enriched_text, fts_vector)
│  ├─ document_tags         ← 태그 연결 (many-to-many)
│  ├─ entities              ← 엔티티 (name, type, aliases[], metadata)
│  ├─ knowledge_triples     ← 트리플 (subject→predicate→object, confidence, context)
│  ├─ cross_references      ← 교차참조 (source↔target, relation_type, confidence)
│  └─ communities           ← 커뮤니티 (entity_ids, algorithm, modularity, summary)
│
├─ tags                     ← 태그 라벨
├─ chat_sessions            ← 대화 히스토리 (messages JSONB)
├─ prompt_templates         ← 프롬프트 템플릿 (template, few_shot_examples, model_params)
├─ rag_traces               ← RAG 트레이싱 (question→결과 전체 기록)
├─ api_usage                ← API 사용량 (tokens, cost, endpoint)
├─ api_key_status           ← API 키 상태 (active/exhausted, daily_limit)
├─ app_settings             ← 앱 설정 (key-value)
├─ deidentify_keywords      ← 비식별화 키워드
│
├─ crawl_sources            ← 크롤링 소스 (board_url, css_selectors, importance)
├─ crawl_keywords           ← 크롤링 키워드 (title_weight, content_weight)
├─ crawl_results            ← 크롤링 결과 (url UNIQUE, relevance_score)
└─ crawl_exclusions         ← 제외 패턴 (url_pattern)
```

### 7.2 API 엔드포인트 (32개)

| 그룹 | 엔드포인트 | 역할 |
|------|-----------|------|
| **인증** | POST `/api/login` | JWT 토큰 발급 |
| | GET/POST `/api/organizations` | 조직 관리 |
| **문서** | GET/POST/DELETE `/api/documents` | 문서 CRUD + 태그 + 분석 |
| | POST `/api/upload` | 파일 업로드 + 임베딩 |
| | POST `/api/upload-url` | 대용량 signed URL |
| | POST `/api/url-import` | URL 크롤링 임포트 |
| | POST `/api/summary` | AI 요약 |
| | GET `/api/pdf-loaders` | PDF 로더 목록 |
| | POST `/api/split-preview` | 청크 미리보기 |
| **검색/RAG** | GET `/api/search` | 하이브리드 검색 + 자동완성 |
| | POST `/api/rag` | RAG 질의 (SSE) |
| | GET `/api/few-shot` | Few-shot 매칭 |
| **법령** | POST `/api/law` | 법령 검색 (법제처 API) |
| | POST `/api/law-import` | 법령 임포트 + 임베딩 |
| | GET `/api/law-graph` | 법령 참조 그래프 |
| **지식그래프** | GET/POST/DELETE `/api/knowledge-graph` | 엔티티/트리플 관리 |
| | GET/POST/DELETE `/api/knowledge-graph-neo4j` | Neo4j 연동 |
| | GET/POST/DELETE `/api/cross-references` | 교차참조 매트릭스 |
| | GET/POST/DELETE `/api/communities` | 커뮤니티 탐지/요약 |
| **크롤링** | GET/POST/DELETE `/api/crawl-sources` | 소스 CRUD |
| | GET/POST/DELETE `/api/crawl-keywords` | 키워드 CRUD |
| | POST `/api/crawl` | 크롤링 실행 |
| | POST `/api/crawl-ingest` | 결과 지식화 |
| | POST `/api/naver-news` | 네이버 뉴스 |
| **설정/관측** | GET/POST `/api/settings` | 앱 설정 |
| | GET/POST `/api/api-usage` | API 사용량 + 키 상태 |
| | GET/POST `/api/deidentify` | 비식별화 |
| | POST `/api/ocr` | OCR |
| | GET/POST `/api/prompts` | 프롬프트 템플릿 |
| | GET/DELETE `/api/rag-traces` | RAG 트레이싱 |
| | GET `/api/observability` | LangFuse 상태 |
| | GET/POST `/api/chat-sessions` | 대화 히스토리 |

---

## 8. 향후 과제

### 8.1 우선순위별 과제

#### 즉시 적용 가능 (1~2일)

| # | 항목 | 기대 효과 |
|---|------|-----------|
| 1 | **답변 피드백 UI (👍/👎)** | RAG 품질 측정 지표 확보 |
| 2 | **Few-shot 품질 필터** | 피드백 좋은 Q&A만 few-shot 후보로 사용 |
| 3 | **임베딩 캐시 (해시 기반)** | 동일 텍스트 재임베딩 방지 → 비용 30~50% 절감 |

#### 단기 (1~2주)

| # | 항목 | 기대 효과 |
|---|------|-----------|
| 4 | **완전한 Self-RAG** | 단순 질문에서 검색 생략 → 응답 속도 향상 |
| 5 | **대화 요약 메모리** | 긴 대화 맥락 유지 + 토큰 50% 절약 |
| 6 | **Parent Document Retriever** | 검색 정확도 향상 + 충분한 컨텍스트 확보 |

#### 중기 (1~2개월)

| # | 항목 | 기대 효과 |
|---|------|-----------|
| 7 | **Plan-and-Execute 에이전트** | "A법과 B법 비교" 같은 복합 질의 처리 |
| 8 | **그래프 증분 업데이트** | 전체 재구축 없이 효율적 업데이트 |
| 9 | **Map-Reduce 계층 요약** | Microsoft Graph RAG 수준의 글로벌 질의 |
| 10 | **BFS/DFS 그래프 탐색** | 연쇄 참조 관계 자동 발견 |

### 8.2 우선순위 매트릭스

```
                    구현 난이도
                    낮음          중간          높음
                ┌──────────┬──────────┬──────────┐
    높음        │ 1.피드백UI │ 4.SelfRAG│ 7.P&E   │
    기          │ 2.FS품질  │ 5.요약메모리│          │
    대          │ 3.임베딩캐시│ 6.PDR    │          │
    효          ├──────────┼──────────┼──────────┤
    과          │          │ 8.증분그래프│ 9.계층요약│
                │          │          │ 10.BFS   │
                └──────────┴──────────┴──────────┘
```

---

## 부록: 파일 구조 (2026-03-14 기준)

```
workspace/docstore/
├── server.js                       # Express 메인 (32개 라우트)
├── index.html                      # SPA 프론트엔드 (10,000행+)
├── vercel.json                     # Vercel 배포 설정
├── ANALYSIS4.md                    # 분석 보고서 v4 (본 문서)
│
├── api/                            # API 엔드포인트 (32개)
│   ├── login.js                    # JWT 로그인
│   ├── documents.js                # 문서 CRUD
│   ├── upload.js                   # 파일 업로드 + 임베딩
│   ├── search.js                   # 하이브리드 검색 + FTS 폴백
│   ├── rag.js                      # RAG 질의 (SSE, StateGraph 9노드)
│   ├── few-shot.js                 # Few-shot 자동 매칭 API
│   ├── law.js / law-import.js      # 법령 검색 / 임포트
│   ├── knowledge-graph.js          # 지식그래프 CRUD
│   ├── communities.js              # 커뮤니티 탐지/요약
│   ├── crawl.js                    # 크롤링 실행
│   ├── api-usage.js                # API 사용량 + 자동 활성화
│   └── ... (32개)
│
├── lib/                            # 핵심 라이브러리
│   ├── rag-graph.js                # StateGraph 9노드 (toolRouter+correctiveRewrite 포함)
│   ├── rag-agent.js                # 멀티홉 검색 엔진
│   ├── hybrid-search.js            # 벡터 + FTS + RRF + FTS 폴백
│   ├── embeddings.js               # 3종 임베딩 + 차원 마이그레이션
│   ├── knowledge-graph.js          # NER + 관계 추출
│   ├── community-detection.js      # Louvain/Leiden 순수 JS
│   ├── community-summary.js        # 커뮤니티 요약 + 글로벌 검색
│   ├── gemini.js                   # 멀티 LLM (Gemini/OpenAI/Claude) + checkDailyLimit
│   ├── api-tracker.js              # API 사용량 + 비용 + 한도 관리
│   ├── prompt-manager.js           # 프롬프트 템플릿 엔진
│   ├── few-shot-manager.js         # Few-shot 자동 매칭
│   ├── law-fetcher.js              # 법제처 API (공백 자동 제거)
│   └── ... (25개+)
│
├── scripts/                        # DB 마이그레이션
└── tests/                          # E2E 테스트 (Playwright, 126개)
```

---

> 본 문서는 **현재 코드베이스 기준**(2026-03-14)으로 작성되었으며,
> ANALYSIS.md(v1), ANALYSIS2.md(v2), ANALYSIS3.md(v3), E2E-TEST-REPORT.md를 참조하여
> 프로젝트 개요·기능·구현 원리·4대 프레임워크 평가를 종합적으로 정리한 **발표 자료**입니다.
