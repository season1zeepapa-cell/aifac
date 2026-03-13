# DocStore 종합 분석 보고서 v3

> 작성일: 2026-03-13
> 대상: workspace/docstore (PDF 문서 관리 + 법령 지식 RAG 시스템)
> 배포: [https://docstore-eight.vercel.app](https://docstore-eight.vercel.app)
> 이전 보고서: ANALYSIS2.md (2026-03-12)

---

## 1. 시스템 전체 아키텍처

### 1.1 기술 스택 현황

| 계층 | 기술 | 비고 |
|------|------|------|
| 프론트엔드 | React 18 (CDN) + Tailwind CSS | 빌드 도구 없는 단일 SPA (10,195행) |
| 백엔드 | Express.js (로컬) / Vercel Serverless (배포) | api/*.js 32개 엔드포인트 |
| DB | Supabase PostgreSQL + pgvector (HNSW) | 벡터 1536D + FTS 이중 인덱스 |
| 임베딩 | OpenAI text-embedding-3-small | 1536차원, Enriched Text 결합 |
| LLM | Gemini 3.x/2.5 (기본), GPT-5.x/4o, Claude | 멀티 프로바이더 자동 전환 |
| 리랭킹 | Cohere Rerank v3.5 (선택) | Cross-encoder 기반 재순위화 |
| OCR | 6개 엔진 플러그인 | Gemini Vision, CLOVA, Cloud Vision 등 |
| 지식그래프 | PostgreSQL (엔티티+트리플) + Neo4j (선택) | Louvain/Leiden 커뮤니티 탐지 |
| 추적 | LangFuse + 자체 rag_traces 테이블 | 토큰/비용/파이프라인 단계별 기록 |

### 1.2 핵심 파이프라인 전체도

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         데이터 입력 계층                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  PDF(8종 로더) │ DOCX │ XLSX/CSV │ JSON │ HWP/HWPX │ 이미지(OCR 6종)     │
│  URL 크롤링    │ 법제처 API(3종) │ 네이버 뉴스 │ 사이트 게시판 크롤링        │
└───────┬─────────────────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                       텍스트 처리 계층                                    │
├─────────────────────────────────────────────────────────────────────────┤
│  텍스트 추출 → 섹션 분할 → 5가지 청킹 전략                                  │
│  (sentence / recursive / law-article / semantic / markdown)            │
│  → Enriched Text (메타 8필드 + 원문) → 임베딩 (1536D)                      │
│  → pgvector 저장 + tsvector FTS 인덱스                                   │
│  → 비식별화 (선택) → 태그/카테고리 자동 분류                                  │
└───────┬─────────────────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                       지식 구조화 계층                                    │
├─────────────────────────────────────────────────────────────────────────┤
│  NER (정규식 + LLM 하이브리드)                                             │
│    → 5종 엔티티: law, article, organization, concept, duty              │
│  관계 추출 (정규식 + LLM)                                                 │
│    → 14종 관계: 준용, 적용, 예외, 의거, 위반, 정의, 위임 ...                   │
│  교차 참조 매트릭스 (명시적 + 시맨틱)                                         │
│  커뮤니티 탐지 (Louvain / Leiden) → LLM 요약 생성                           │
└───────┬─────────────────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                    RAG 질의응답 계층 (StateGraph)                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  search ──→ augment ──→ generate ──→ parse ──→ verify ──→ finalize     │
│    │           │           │           │          │          │           │
│    │ 쿼리 리라이팅  │ 지식그래프     │ SSE 스트리밍  │ JSON/MD   │ 2차 LLM   │ DB 저장   │
│    │ HyDE       │ 커뮤니티 요약  │ 비스트리밍    │ 2단 폴백   │ 검증      │ LangFuse │
│    │ 멀티홉 검색   │ Few-shot   │ fallback   │ 환각 경고   │          │          │
│    │ RRF+Rerank │ 프롬프트 빌드  │            │           │          │          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 기능별 사용법과 동작 방식

### 2.1 문서 업로드 및 관리

#### 사용법
1. **등록 탭** → 파일을 드래그앤드롭하거나 클릭으로 선택
2. 카테고리(법령/규정/기출/일반) 선택, 청킹 전략/크기/오버랩 설정
3. 업로드 → 텍스트 추출 → 섹션 분할 → 임베딩 생성 → DB 저장

#### 동작 방식
```
[파일 선택]
    ↓
detectFileType() — 확장자로 파일 형식 감지
    ↓
extractFromFile() — 형식별 텍스트 추출
  ├── PDF: pdf-parse/pdfjs/pymupdf 등 8개 로더 플러그인
  ├── DOCX: mammoth (단락 단위)
  ├── XLSX: xlsx 라이브러리 (행 단위)
  ├── CSV: csv-parse (열 매핑)
  ├── HWP/HWPX: hwp.js
  └── 이미지: OCR 엔진 매니저 (6개 엔진 폴백 체인)
    ↓
splitText() — 5가지 청킹 전략 중 선택
  ├── sentence: 마침표 기준 (범용)
  ├── recursive: 구분자 계층 (LangChain 동일 패턴)
  ├── law-article: 제N조 패턴 + 항(①②③) 세분화
  ├── semantic: Gemini Flash AI 분할
  └── markdown: 헤딩(#) 계층 파싱 + 접두어 부착
    ↓
buildEnrichedText() — 메타 정보를 청크 텍스트에 결합
  "[문서] 개인정보보호법 [분류] 법령 [조항] 제15조 ... (원문)"
    ↓
generateEmbeddings() — OpenAI text-embedding-3-small (1536D)
  배치 CONCURRENCY=5 병렬 처리
    ↓
DB INSERT — document_chunks 테이블 (배치 50개씩)
  + FTS tsvector 자동 갱신 (트리거)
```

#### 대용량 파일 처리
- 4.5MB 미만: multipart/form-data 직접 전송
- 4.5MB 이상: Supabase Storage signed URL → 직접 PUT → 서버에서 다운로드 후 처리

---

### 2.2 검색 시스템

#### 사용법
1. **검색 탭** → 검색어 입력 (자동완성 제안 표시)
2. 검색 유형 선택: 통합(hybrid) / 텍스트(text) / 의미(vector)
3. 필터 설정: 문서 범위, 장/절, 태그
4. 결과 카드 클릭 → 문서 상세 이동

#### 동작 방식: 하이브리드 검색 5단계

```
질문: "개인정보 수집 시 동의가 필요한가?"
    ↓
[1단계] 병렬 검색
  ├── vectorSearch(): 질문 임베딩 → pgvector cosine similarity (HNSW)
  └── ftsSearch(): N-gram 토크나이저 → tsvector @@ tsquery + ts_rank_cd
    ↓
[2단계] RRF 합산 (K=60)
  score = 1/(rank_vector + 60) + 1/(rank_fts + 60)
  양쪽 모두 매칭 시 보너스 가산
    ↓
[3단계] Cohere Rerank v3.5 (선택)
  최대 4096 토큰/문서, 관련성 점수 재계산
    ↓
[4단계] 점수 정규화 + 가중 합산
  finalScore = vector(0.4) + RRF(0.3) + Rerank(0.3)
    ↓
[5단계] MMR 다양성 보장 (λ=0.7)
  3-gram Jaccard 유사도로 중복 제거
    ↓
최종 결과 (topK건) + 하이라이팅 + 확장 검색어 표시
```

#### 쿼리 확장
- **동의어 사전**: ~50개 항목 (예: "개인정보" → "개인정보보호", "프라이버시")
- **N-gram 토크나이저**: 한국어 2/3자 조합 생성
- **형태소 분석** (선택): kiwipiepy Python 서버 or 로컬 N-gram 폴백

#### 자동완성
- 입력 시 debounce(300ms)로 API 호출
- 문서 제목 + 섹션 본문에서 매칭
- 키보드 내비게이션 (↑↓ Enter)

---

### 2.3 RAG 질의응답 (AI 채팅)

#### 사용법
1. **채팅 탭** → 질문 입력
2. 옵션 설정:
   - LLM 프로바이더/모델 선택 (Gemini/OpenAI/Claude)
   - 쿼리 리라이팅 ON/OFF, HyDE ON/OFF
   - 문서 범위 필터
   - 답변 가이드 (주제/관점/답변형식) 설정
3. Few-shot 예시가 자동 제안되면 체크박스로 선택/제거
4. 전송 → SSE 스트리밍으로 실시간 답변 표시
5. 근거 자료 펼치기 → 원본 조문 확인

#### 동작 방식: StateGraph 6노드 파이프라인

**1. search 노드** — 멀티홉 검색
```
쿼리 강화 (병렬):
  ├── rewriteQuery(): 복합 질문 → 2~3개 하위 쿼리 (LLM)
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

**2. augment 노드** — 컨텍스트 증강
```
카테고리 감지: 검색 결과의 대표 카테고리 결정
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

**3. generate 노드** — LLM 호출
```
stream=true: callLLMStream() → SSE 토큰 단위 전송
stream=false: callLLM() → 전체 응답 한 번에 반환
재시도: 스트리밍 실패 시 비스트리밍 fallback (1회)
```

**4. parse 노드** — 출력 파싱
```
[1단계] tryParseJSON(): ```json 코드블록 → JSON.parse → 검증
[2단계] parseMarkdownAnswer(): ### 헤딩 기준 섹션 추출 (폴백)
   → sourceIndex 범위 검증 (환각 방지)
   → verified 플래그 (근거 존재 여부)
```

**5. verify 노드** (선택) — 답변 검증
```
2차 LLM 호출: "이 답변이 근거 자료와 일치하는가?"
→ verification { score, confidence }
```

**6. finalize 노드** — 저장 및 완료
```
rag_traces 테이블에 전체 파이프라인 기록
LangFuse 트레이스 종료
SSE 'done' 이벤트 발행
```

---

### 2.4 답변 가이드 시스템

#### 사용법
1. 채팅 입력 영역 옆 **슬라이더 아이콘** 클릭
2. 3가지 가이드 설정:
   - **주제**: 개인정보보호, CCTV/영상정보, 법률 해석 등 (프리셋 or 직접 입력)
   - **관점**: 법률 전문가, 실무 담당자, 초보자 눈높이 등
   - **답변형식**: 요약(3줄), 상세 해설, 표/비교표, 체크리스트 등
3. 설정된 가이드는 뱃지로 표시

#### 동작 방식
```
사용자 질문: "개인정보 수집 동의가 필요한가?"
    +
가이드: [주제] CCTV/영상정보 | [관점] 실무 담당자 | [답변형식] 체크리스트
    ↓
실제 전송되는 질문:
  "[주제] CCTV/영상정보 | [관점] 실무 담당자 | [답변형식] 체크리스트

  개인정보 수집 동의가 필요한가?"
```

---

### 2.5 Few-shot 자동 매칭 시스템

#### 사용법
1. 채팅 또는 검색 탭에서 **4자 이상 입력** 시 자동 실행 (800ms debounce)
2. 유사한 과거 질문이 **체크박스 리스트**로 표시
3. **체크**: 해당 예시를 RAG 프롬프트에 포함 → AI가 참고하여 더 정확한 답변 생성
4. **체크 해제**: 해당 예시 제외
5. **접힌 상태**: 선택된 항목만 뱃지로 표시, x로 개별 제거
6. 아무것도 선택하지 않으면 → 자동 매칭으로 동작 (기존 방식)

#### 동작 방식
```
사용자 입력: "개인정보 수집 동의..."
    ↓
GET /api/few-shot?q=개인정보+수집+동의&max=3
    ↓
few-shot-manager.js:
  1. 키워드 추출: ["개인정보", "수집", "동의"]
     - 한국어 조사 제거 (은/는/을/를/에서/으로 등)
     - 불용어 필터링 (이/가/의/등)
  2. rag_traces 조회: 성공한 Q&A (90일 이내, 상위 50개)
  3. 유사도 계산:
     - 정확 매칭: "동의" = "동의" → 1.0
     - 부분 매칭: "개인정보" ⊂ "개인정보보호법" → 0.5
     - 최종 = Jaccard(0.4) + Coverage(0.6)
  4. 상위 3개 반환 (minScore >= 0.15, 중복 제거)
    ↓
UI: 체크박스 리스트 표시
    ↓
[전송 시]
  선택 있음 → body.userFewShots = [선택된 Q&A]
  선택 없음 → 자동 매칭 (augment 노드에서 findRelevantFewShots 호출)
    ↓
augment 노드에서 프롬프트에 주입:
  "## 예시
   ### 예시 1
   질문: 개인정보 수집 시 동의를 받아야 하나요?
   답변: 개인정보보호법 제15조에 따라..."
```

---

### 2.6 지식 그래프 시스템

#### 사용법
1. **문서 탭** → 문서 선택 → **지식그래프** 버튼
2. 알고리즘 선택: 자동(문서 타입 감지) / Louvain / Leiden
3. **LLM NER 보완** 체크 시: 정규식 + LLM 하이브리드 추출
4. **구축** 버튼 → 엔티티/트리플 생성 → D3 그래프 시각화
5. **커뮤니티 탐지** → **요약 생성** → 글로벌 검색에 활용

#### 동작 방식: NER + RE + 커뮤니티

**엔티티 추출 (2단계 파이프라인)**
```
[1단계] 정규식 NER (항상 실행, 매우 빠름)
  ├── law: "개인정보보호법", "정보통신망법" (CROSS_LAW_PATTERN)
  ├── article: "제10조", "제3조의2제1항"
  ├── organization: "개인정보보호위원회" (기관명 사전)
  ├── concept: "동의", "비식별화" (45개 개념 사전)
  └── duty: "~의무", "~권리", "~책임" (패턴)
    ↓
[2단계] LLM NER (선택, 정규식 결과를 힌트로 전달)
  Few-shot 프롬프트 → Gemini Flash
  "정규식이 이미 찾은 엔티티 (건너뛰세요): ..."
  → 정규식이 놓친 복합 용어, 약칭, 비정형 기관명 보완
    ↓
병합 + 중복 제거 (type:name 키 기준)
```

**관계 추출**
```
문장 단위로 엔티티 쌍 감지 → 14가지 관계 패턴 매칭:
  "~을 준용한다" → 준용
  "~에 적용된다" → 적용
  "~의 예외로" → 예외
  ...
주/목적어 판별:
  조사 패턴(은/는 vs 을/를) → confidence 1.0
  출현 순서(앞=주어) → confidence 0.7
```

**커뮤니티 탐지**
```
그래프 구축: 엔티티→노드, 트리플→양방향 엣지(가중치=confidence 누적)
    ↓
알고리즘 자동 선택:
  문서 타입 감지: articleNumber 비율 분석
  법령(article 비율 높음) → Leiden (정밀)
  일반 문서 → Louvain (빠름)
    ↓
커뮤니티 요약: LLM으로 각 커뮤니티의 엔티티+관계를 자연어 요약
    ↓
글로벌 검색: 질문 키워드 ↔ 커뮤니티 요약 매칭 → RAG 컨텍스트에 추가
```

---

### 2.7 프롬프트 관리 시스템

#### 사용법
1. **튜닝 탭** → **프롬프트 템플릿** 서브탭
2. 기존 템플릿 편집 또는 새 템플릿 생성
3. 변수 사용: `{{question}}`, `{{contextText}}`, `{{historyText}}`, `{{fewShotBlock}}`
4. 카테고리별 분기: 법령/규정/기출/default
5. Few-shot 예시 추가: 입력/출력 쌍 등록

#### 동작 방식
```
loadTemplate(name='rag-answer', category='법령'):
  1. 캐시 확인 (5분 TTL, Map 기반)
  2. DB 조회: prompt_templates 테이블
     WHERE name='rag-answer' AND category IN ('법령', 'default')
     ORDER BY CASE WHEN category='법령' THEN 0 ELSE 1 END
  3. 폴백: FALLBACK_TEMPLATES (하드코딩 3종)
     - rag-answer:default — JSON 답변 형식
     - query-rewrite:default — 쿼리 분해
     - hyde:default — 가상 문서 생성

renderTemplate(template, variables, fewShotExamples):
  {{변수}} 치환 + formatFewShotExamples() 삽입
```

---

### 2.8 크롤링 & 지식화

#### 사용법
1. **설정 탭** → **크롤링 설정**
2. 소스 등록: 사이트 URL + CSS 선택자 설정
3. 키워드 등록: 검색어 + 제목/내용 가중치
4. 크롤링 실행 → 결과 미리보기 (점수순 정렬)
5. 체크박스로 선택 → **지식화**: documents 테이블에 변환 + 임베딩

#### 동작 방식
```
[소스 기반 크롤링]
  사이트 게시판 URL → HTML 파싱 (3가지 패턴 자동 매칭)
  → 제목/본문/URL 추출 → 키워드 점수 계산
  → crawl_results 저장

[네이버 뉴스]
  네이버 검색 API → 뉴스 결과 → 키워드 매칭 점수
  → crawl_results 저장

[지식화]
  선택된 crawl_results → documents INSERT
  → 텍스트 추출 → 청크 분할 → 임베딩 → RAG 검색 가능
```

---

### 2.9 관측성 & 모니터링

#### 사용법
1. **튜닝 탭** → **RAG 트레이싱**: 파이프라인 실행 이력 조회
2. **API 사용량**: 프로바이더별 토큰/비용 차트
3. **관측성**: LangFuse 연동 상태 확인

#### 동작 방식
```
RAG 실행 시:
  createRagTracer() → 각 단계마다 setXxx() 호출
    setQueryRewrite(), setHyDE(), setSearchResults()
    setPromptInfo(), setLLMOutput(), setParsedOutput()
    setVerification()
  → tracer.save() → rag_traces INSERT

동시에:
  LangFuse createTrace() → createSpan() (단계별)
  → endSpan() → finalizeTrace()

API 사용량:
  trackedApiCall() → api_usage INSERT
  → 프로바이더/모델/엔드포인트별 토큰+비용
  → isCreditError(): 크레딧 소진 자동 감지 (6개 패턴)
  → updateKeyStatus(): 키 비활성화/활성화 전환
```

---

### 2.10 인증 & 보안

#### 동작 방식
```
POST /api/login → JWT 발급 (HS256, 7일 만료)
  ↓
모든 API 요청: Authorization: Bearer <token>
  ↓
requireAuth():
  토큰 검증 → { user, orgId, isAdmin } 추출
  ↓
orgFilter():
  orgId=null (슈퍼어드민): 전체 데이터 접근
  orgId=N: WHERE org_id = N 자동 필터
```

보안 계층:
- CORS 설정 + Rate Limiting
- SQL 파라미터 바인딩 (인젝션 방지)
- 입력 검증: ILIKE escape, 파일명 정제
- 에러 메시지: 안전 패턴 화이트리스트 (프로덕션 노출 최소화)
- Soft delete: deleted_at 타임스탬프

---

## 3. DB 스키마 전체 (26개 테이블)

```
organizations               ← 다중 조직 지원 (multi-tenancy)
├─ documents                ← 문서 메타 (제목, 카테고리, 요약, storage_path)
│  ├─ document_sections     ← 섹션 (raw_text, fts_vector, fts_morpheme_vector)
│  │  └─ document_chunks    ← 청크 (chunk_text, embedding[1536], enriched_text, fts_vector)
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
├─ api_key_status           ← API 키 상태 (active/exhausted)
├─ app_settings             ← 앱 설정 (key-value)
├─ deidentify_keywords      ← 비식별화 키워드
│
├─ crawl_sources            ← 크롤링 소스 (board_url, css_selectors)
├─ crawl_keywords           ← 크롤링 키워드 (title_weight, content_weight)
├─ crawl_results            ← 크롤링 결과 (url UNIQUE, relevance_score)
└─ crawl_exclusions         ← 제외 패턴 (url_pattern)
```

### 주요 인덱스
| 인덱스 | 타입 | 대상 |
|--------|------|------|
| idx_chunks_embedding_hnsw | HNSW (m=16, ef=64) | document_chunks.embedding |
| idx_chunks_fts | GIN | document_chunks.fts_vector |
| idx_sections_fts | GIN | document_sections.fts_vector |
| idx_sections_morpheme | GIN | document_sections.fts_morpheme_vector |
| idx_rag_traces_created | btree DESC | rag_traces.created_at |

---

## 4. API 엔드포인트 전체 목록 (32개)

### 인증
| 메서드 | 경로 | 역할 |
|--------|------|------|
| POST | `/api/login` | JWT 토큰 발급 |
| GET/POST | `/api/organizations` | 조직 관리 (슈퍼어드민) |

### 문서 관리
| 메서드 | 경로 | 역할 |
|--------|------|------|
| GET/POST/DELETE | `/api/documents` | 문서 CRUD + 태그 + 분석 |
| POST | `/api/upload` | 파일 업로드 + 텍스트 추출 + 임베딩 |
| POST | `/api/upload-url` | 대용량 파일 signed URL 발급 |
| POST | `/api/url-import` | 웹 URL 크롤링 임포트 |
| POST | `/api/summary` | AI 요약 생성 |
| GET | `/api/pdf-loaders` | PDF 로더 목록 |
| POST | `/api/split-preview` | 청크 분할 미리보기 |

### 검색 & RAG
| 메서드 | 경로 | 역할 |
|--------|------|------|
| GET | `/api/search` | 하이브리드 검색 + 자동완성 |
| POST | `/api/rag` | RAG 질의응답 (SSE 스트리밍) |
| GET | `/api/few-shot` | Few-shot 자동 매칭 |

### 법령
| 메서드 | 경로 | 역할 |
|--------|------|------|
| POST | `/api/law` | 법령 검색 (법제처 API) |
| POST | `/api/law-import` | 법령 임포트 + 임베딩 |
| GET | `/api/law-graph` | 법령 참조 그래프 |

### 지식 그래프
| 메서드 | 경로 | 역할 |
|--------|------|------|
| GET/POST/DELETE | `/api/knowledge-graph` | 엔티티/트리플 관리 |
| GET/POST/DELETE | `/api/knowledge-graph-neo4j` | Neo4j 연동 (선택) |
| GET/POST/DELETE | `/api/cross-references` | 교차참조 매트릭스 |
| GET/POST/DELETE | `/api/communities` | 커뮤니티 탐지/요약 |

### 크롤링
| 메서드 | 경로 | 역할 |
|--------|------|------|
| GET/POST/DELETE | `/api/crawl-sources` | 크롤링 소스 CRUD |
| GET/POST/DELETE | `/api/crawl-keywords` | 크롤링 키워드 CRUD |
| POST | `/api/crawl` | 크롤링 실행 |
| POST | `/api/crawl-ingest` | 크롤링 결과 지식화 |
| POST | `/api/naver-news` | 네이버 뉴스 검색 |

### 설정 & 관측
| 메서드 | 경로 | 역할 |
|--------|------|------|
| GET/POST | `/api/settings` | 앱 설정 |
| GET/POST | `/api/api-usage` | API 사용량 |
| GET/POST | `/api/deidentify` | 비식별화 키워드 |
| POST | `/api/ocr` | OCR |
| GET/POST | `/api/prompts` | 프롬프트 템플릿 |
| GET/DELETE | `/api/rag-traces` | RAG 트레이싱 |
| GET | `/api/observability` | LangFuse 상태 |
| GET/POST | `/api/chat-sessions` | 대화 히스토리 |

---

## 5. 프론트엔드 구조 (index.html 10,195행)

### 탭 구조
```
App (루트)
├─ 등록 탭 (upload)     — 파일 업로드 + 법령 검색 임포트
├─ 문서 탭 (documents)  — 문서 목록 + 상세 + 지식그래프 + 크롤링
├─ 검색 탭 (search)     — 하이브리드 검색 + 자동완성 + Few-shot 제안
├─ 채팅 탭 (chat)       — AI 질의응답 + 답변 가이드 + Few-shot 선택
├─ 설정 탭 (settings)   — API 키, LLM 모델, 임베딩, OCR, 카테고리, 비식별화
└─ 튜닝 탭 (tuning)     — 대시보드, API 사용량, 프롬프트, 분할설정, 트레이싱, 커뮤니티
```

---

## 6. ANALYSIS2.md 이후 구현된 기능

| 기능 | 구현일 | 파일 |
|------|--------|------|
| LangGraph 스타일 StateGraph 도입 | 03-12 | lib/rag-graph.js |
| 프롬프트 매니저 (DB 템플릿 + 폴백) | 03-12 | lib/prompt-manager.js |
| RAG 자체 트레이싱 | 03-12 | lib/rag-tracer.js |
| LangFuse 연동 | 03-12 | lib/langfuse.js |
| 커뮤니티 탐지 (Louvain/Leiden) | 03-12 | lib/community-detection.js |
| 커뮤니티 요약 + 글로벌 검색 | 03-12 | lib/community-summary.js |
| LLM Few-shot NER 하이브리드 | 03-12 | lib/llm-ner.js |
| LLM 관계 추출 보완 | 03-12 | lib/llm-ner.js |
| 답변 가이드 (주제/관점/형식) | 03-12 | index.html ChatTab |
| AI 채팅 답변 렌더링 수정 | 03-12 | index.html ParsedAnswer |
| Few-shot 자동 매칭 | 03-13 | lib/few-shot-manager.js |
| Few-shot 선택/제거 UI | 03-13 | index.html + api/few-shot.js |

---

## 7. 4대 프레임워크 기준 평가

```
평가 등급:
  ★★★★★  업계 최상위 수준 (프로덕션 급)
  ★★★★☆  대부분 구현, 일부 고급 기능 부재
  ★★★☆☆  핵심 구현 완료, 최적화 여지 있음
  ★★☆☆☆  기본 구현, 주요 기능 누락
  ★☆☆☆☆  초기 단계
```

---

### 7-1. LangChain 기준 평가

> LangChain: 가장 널리 쓰이는 RAG 프레임워크. 모듈형 체인, 다양한 리트리버, 프롬프트 관리가 핵심.

| LangChain 핵심 컴포넌트 | ANALYSIS2 평가 | 현재 평가 | 변화 | 근거 |
|------------------------|---------------|----------|------|------|
| **Document Loaders** | ★★★★★ | ★★★★★ | 유지 | 14종 로더 + HWP/HWPX 지원 |
| **Text Splitters** | ★★★★★ | ★★★★★ | 유지 | 5전략 + 프리셋 + 미리보기 |
| **Embeddings** | ★★★★☆ | ★★★★☆ | 유지 | Enriched Text 전략 우수, 모델 1종 한계 |
| **Vector Stores** | ★★★★☆ | ★★★★☆ | 유지 | pgvector HNSW + GIN FTS |
| **Retrievers** | ★★★★★ | ★★★★★ | 유지 | RRF + Rerank + MMR + HyDE + 쿼리리라이팅 |
| **Chains/Prompts** | ★★★☆☆ | ★★★★☆ | **상향** | 프롬프트 매니저 도입 (DB 템플릿, 카테고리별 분기, Few-shot, 프롬프트 체인) |
| **Memory** | ★★★★☆ | ★★★★☆ | 유지 | DB 세션 + 20메시지 윈도우 |
| **Output Parsers** | ★★★★☆ | ★★★★☆ | 유지 | JSON+MD 2단 폴백 + 환각 검증 |
| **Callbacks/Tracing** | ★★★☆☆ | ★★★★☆ | **상향** | LangFuse 연동 + rag_traces 테이블 + API 비용 추적 |

**종합: ★★★★☆ (4.2 → 4.4/5)**

**상향 이유:**
- Chains/Prompts: ★3→★4 — `prompt-manager.js` 도입으로 DB 템플릿 + 카테고리별 분기 + Few-shot 자동 삽입 + executePromptChain() 체인 실행 구현
- Callbacks/Tracing: ★3→★4 — LangFuse Trace/Span/Generation 연동 + rag_traces 자체 테이블로 전 파이프라인 기록

**잔여 격차:**
- Embeddings: 모델 선택지 1종 (한국어 특화 모델 부재)
- Memory: 대화 요약(ConversationSummaryMemory) 미구현
- Output Parsers: 자동 재시도(OutputFixingParser) 미구현

---

### 7-2. Hybrid RAG 기준 평가

> Hybrid RAG: 키워드 검색 + 벡터 검색을 결합하여 단일 방식의 한계를 극복하는 접근법.

| Hybrid RAG 핵심 기법 | ANALYSIS2 평가 | 현재 평가 | 변화 | 근거 |
|---------------------|---------------|----------|------|------|
| **벡터 검색** | ★★★★★ | ★★★★★ | 유지 | pgvector cosine + HNSW |
| **키워드 검색** | ★★★★★ | ★★★★★ | 유지 | tsvector + ts_rank_cd + GIN |
| **RRF 점수 합산** | ★★★★★ | ★★★★★ | 유지 | K=60 업계 표준 |
| **리랭킹** | ★★★★☆ | ★★★★☆ | 유지 | Cohere Rerank v3.5 |
| **Enriched Embedding** | ★★★★★ | ★★★★★ | 유지 | 메타 8필드 결합 |
| **다국어 지원** | ★★★★☆ | ★★★★☆ | 유지 | N-gram + 동의어 50개 |
| **필터링** | ★★★★★ | ★★★★★ | 유지 | 문서/장/태그/카테고리 |
| **결과 다양성** | ★★★★★ | ★★★★★ | 유지 | MMR (λ=0.7) + Jaccard |
| **쿼리 확장** | ★★★★★ | ★★★★★ | 유지 | 동의어 + 쿼리 리라이팅 + HyDE + 블렌딩 |
| **Few-shot 컨텍스트** | — (미평가) | ★★★★☆ | **신규** | 과거 Q&A 자동 매칭 + 사용자 선택 |

**종합: ★★★★★ (4.6 → 4.7/5)**

**상향 이유:**
- Few-shot 컨텍스트 추가: RAG 프롬프트에 유사 과거 Q&A를 동적 삽입하여 출력 품질 향상
- 사용자 선택 기능: 자동 매칭 결과를 사용자가 직접 관리 가능

**잔여 격차:**
- 형태소 분석기(Mecab/KoNLPy) 미연동
- Cross-encoder 자체 모델 학습 미구현

---

### 7-3. LangGraph 기준 평가

> LangGraph: LangChain 팀의 에이전트 프레임워크. 상태 머신 기반 멀티스텝 워크플로우를 그래프로 정의.

| LangGraph 핵심 개념 | ANALYSIS2 평가 | 현재 평가 | 변화 | 근거 |
|--------------------|---------------|----------|------|------|
| **상태 그래프 (StateGraph)** | ★★☆☆☆ | ★★★★☆ | **대폭 상향** | StateGraph 클래스 직접 구현. addNode/addEdge/addConditionalEdge/compile/invoke 패턴 |
| **멀티홉 검색** | ★★★★☆ | ★★★★☆ | 유지 | 1→2홉 고정. 동적 홉 수 조절 없음 |
| **조건부 분기** | ★★★☆☆ | ★★★★☆ | **상향** | search→augment/finalize, parse→verify/finalize 분기를 그래프 엣지로 정의 |
| **도구 호출 (Tool Use)** | ★★☆☆☆ | ★★☆☆☆ | 유지 | LLM이 도구를 선택하는 패턴 없음 |
| **Self-RAG** | ★☆☆☆☆ | ★☆☆☆☆ | 유지 | 검색 필요성 판단, 답변 충분성 평가 미구현 |
| **계획-실행 루프** | ★☆☆☆☆ | ★☆☆☆☆ | 유지 | Plan-and-Execute 미구현 |
| **Corrective RAG** | ★★★☆☆ | ★★★★☆ | **상향** | verified 검증 + verify 노드(2차 LLM 검증) + 환각 경고 + 재시도 메커니즘 |
| **Human-in-the-Loop** | ★★☆☆☆ | ★★★☆☆ | **상향** | 답변 가이드(주제/관점/형식) + Few-shot 선택/제거로 사용자가 파이프라인에 개입 |
| **병렬 실행** | ★★★★☆ | ★★★★☆ | 유지 | 벡터/FTS 병렬, 쿼리리라이팅+HyDE 병렬 |
| **스트리밍** | ★★★★★ | ★★★★★ | 유지 | SSE 토큰 단위 + 중간 이벤트(sources, enhancement, debug) |
| **재시도/폴백** | — (미평가) | ★★★★☆ | **신규** | generate 노드: 스트리밍 실패 → 비스트리밍 fallback (node.retry.max=1) |
| **이벤트 시스템** | — (미평가) | ★★★★☆ | **신규** | emitEvent(state, type, data) → SSE 실시간 전달 (stage/sources/token/parsed/done) |

**종합: ★★☆☆☆ (2.5) → ★★★☆☆ (3.3/5)**

**대폭 상향 이유:**
1. **StateGraph 구현**: ANALYSIS2 시점에는 "명시적 상태 머신 없음"이었으나, 현재 `rag-graph.js`에 범용 StateGraph 클래스를 직접 구현. LangGraph의 핵심 패턴(노드 등록, 조건부 엣지, 재시도, 이벤트)을 순수 JS로 재현.
2. **조건부 분기**: 검색 결과 유무에 따른 augment/finalize 분기, 검증 옵션에 따른 verify/finalize 분기가 그래프 엣지로 정의됨.
3. **Corrective RAG**: verify 노드(2차 LLM 검증)와 generate 노드 재시도로 답변 품질 자동 검증 가능.
4. **Human-in-the-Loop**: 답변 가이드 + Few-shot 선택으로 사용자가 AI 파이프라인에 직접 개입 가능.

**잔여 격차:**
- Self-RAG: LLM이 "검색이 필요한지" 자체 판단하는 패턴 없음
- Tool Use: LLM이 "법령 검색/문서 검색/계산" 중 선택하는 에이전틱 패턴 없음
- Plan-and-Execute: 복잡한 질문을 계획 → 단계별 실행하는 루프 없음

---

### 7-4. Graph RAG (Microsoft) 기준 평가

> Graph RAG: 문서에서 지식 그래프를 추출하고, 커뮤니티 탐지 → 계층 요약 → 글로벌 질의를 처리하는 접근법.

| Graph RAG 핵심 기법 | ANALYSIS2 평가 | 현재 평가 | 변화 | 근거 |
|-------------------|---------------|----------|------|------|
| **엔티티 추출** | ★★★☆☆ | ★★★★☆ | **상향** | 정규식 NER 5종 + LLM NER 하이브리드 파이프라인 (llm-ner.js) |
| **관계 추출** | ★★★★☆ | ★★★★★ | **상향** | 정규식 14종 관계 + LLM 관계 추출 보완 (extractTriplesWithLLM) |
| **지식 그래프 구성** | ★★★☆☆ | ★★★★☆ | **상향** | entities + knowledge_triples 테이블 + Neo4j 선택 연동 |
| **그래프 시각화** | ★★★★☆ | ★★★★☆ | 유지 | D3.js force-directed + 커뮤니티 색상 구분 |
| **커뮤니티 탐지** | ★☆☆☆☆ | ★★★★☆ | **대폭 상향** | Louvain + Leiden 순수 JS 구현. 문서 타입별 자동 알고리즘 선택 |
| **계층적 요약** | ★★☆☆☆ | ★★★★☆ | **대폭 상향** | 커뮤니티별 LLM 요약 생성 (community-summary.js) + 일괄 생성 |
| **글로벌 질의** | ★★☆☆☆ | ★★★★☆ | **대폭 상향** | globalSearch(): 질문↔커뮤니티 요약 키워드 매칭 → RAG 컨텍스트 주입 |
| **로컬 질의** | ★★★★★ | ★★★★★ | 유지 | 하이브리드 검색 + 멀티홉 + 트리플 컨텍스트 |
| **그래프 탐색** | ★★★☆☆ | ★★★☆☆ | 유지 | UI 링크 클릭 이동. 그래프 순회 알고리즘 미구현 |
| **트리플 → RAG 통합** | — (미평가) | ★★★★☆ | **신규** | findTriplesForRAG(): 질문과 관련 트리플 15개를 RAG 컨텍스트에 추가 |

**종합: ★★★☆☆ (2.8) → ★★★★☆ (3.9/5)**

**대폭 상향 이유:**
1. **커뮤니티 탐지**: ANALYSIS2에서 "미구현"이던 Louvain/Leiden이 완전 구현됨. 순수 JS로 외부 라이브러리 없이 Vercel 서버리스에서 동작.
2. **계층적 요약**: 커뮤니티별 LLM 요약이 구현되어 "이 법의 전체 구조" 같은 글로벌 질의 대응 가능.
3. **글로벌 검색 통합**: 커뮤니티 요약을 RAG 컨텍스트에 자동 주입하는 파이프라인 완성.
4. **LLM NER**: 정규식이 놓치는 엔티티를 LLM이 보완하는 2단계 파이프라인으로 추출 커버리지 향상.
5. **트리플 RAG 통합**: 지식그래프 트리플이 RAG 답변의 근거로 직접 활용됨.

**잔여 격차:**
- Map-Reduce 요약: 현재는 커뮤니티 단위 요약. 커뮤니티 간 계층적 요약(상위 커뮤니티)은 미구현
- 그래프 순회 알고리즘: BFS/DFS 기반 관련 엔티티 탐색 미구현
- 동적 그래프 업데이트: 문서 추가 시 기존 그래프 증분 업데이트 없음 (전체 재구축)

---

### 7-5. 종합 비교 매트릭스

```
                    LangChain    Hybrid RAG    LangGraph    Graph RAG
                    ─────────    ──────────    ─────────    ─────────
ANALYSIS2 (03-12)   ★★★★☆        ★★★★★         ★★☆☆☆        ★★★☆☆
                    (4.2/5)      (4.6/5)       (2.5/5)      (2.8/5)

현재 (03-13)        ★★★★☆        ★★★★★         ★★★☆☆        ★★★★☆
                    (4.4/5)      (4.7/5)       (3.3/5)      (3.9/5)

변화                 +0.2         +0.1          +0.8         +1.1
```

**핵심 분석:**
- **최대 강점**: Hybrid RAG (4.7/5) — 업계 최상위 수준의 검색 파이프라인
- **최대 개선**: Graph RAG (+1.1) — 커뮤니티 탐지/요약/글로벌 검색 일괄 구현
- **차기 과제**: LangGraph (3.3/5) — 에이전틱 패턴(Self-RAG, Tool Use) 도입 여지

---

## 8. 개선 및 확장 제안

### 8-1. 즉시 적용 가능 (1~2일)

| # | 항목 | 대상 파일 | 기대 효과 |
|---|------|----------|----------|
| 1 | **답변 피드백 UI (👍/👎)** | index.html + api/rag-traces.js | RAG 품질 측정 지표 확보. rag_traces에 feedback 컬럼 추가 |
| 2 | **Few-shot 품질 필터** | lib/few-shot-manager.js | 피드백 좋은 Q&A만 few-shot 후보로 사용 (feedback='positive' 필터) |
| 3 | **임베딩 캐시 (해시 기반)** | lib/embeddings.js | 동일 텍스트 재임베딩 방지 → 비용 30~50% 절감 |

### 8-2. 단기 (1~2주)

| # | 항목 | 기법 | 기대 효과 |
|---|------|------|----------|
| 4 | **Self-RAG (검색 필요성 판단)** | LLM이 "이 질문에 검색이 필요한가?" 판단 후 불필요 시 직접 답변 | 단순 질문에서 검색 생략 → 응답 속도 2~3배 향상 |
| 5 | **Corrective RAG 루프** | parse 후 답변 품질 평가 → 불충분 시 쿼리 리라이팅 후 재검색 | 검색 실패 시 자동 복구 → 답변 커버리지 향상 |
| 6 | **대화 요약 메모리** | 20메시지 윈도우 초과 시 LLM으로 요약 → 요약 + 최근 10메시지 | 긴 대화 맥락 유지 + 토큰 50% 절약 |
| 7 | **Parent Document Retriever** | 작은 청크(200자)로 검색 → 부모 섹션(800자) 반환 | 검색 정확도 향상 + 충분한 컨텍스트 확보 |

### 8-3. 중기 (1~2개월)

| # | 항목 | 기법 | 기대 효과 |
|---|------|------|----------|
| 8 | **Tool Use (에이전틱 RAG)** | LLM이 "법령 검색 / 문서 검색 / 계산 / 요약" 중 도구 선택 | 복잡한 질문 자동 분해 처리 |
| 9 | **그래프 증분 업데이트** | 문서 추가/수정 시 기존 지식그래프에 증분 병합 | 전체 재구축 없이 효율적 업데이트 |
| 10 | **커뮤니티 계층 요약 (Map-Reduce)** | 하위 커뮤니티 요약 → 상위 커뮤니티 요약 → 문서 전체 요약 | Microsoft Graph RAG 수준의 글로벌 질의 |
| 11 | **임베딩 모델 다양화** | Upstage Solar Embedding (한국어 1위), Cohere embed-v3 | 한국어 검색 정확도 향상 |
| 12 | **BFS/DFS 그래프 탐색** | 시작 엔티티에서 N-홉 관련 엔티티 자동 탐색 | 연쇄 참조 관계 자동 발견 |

### 8-4. 장기 (3개월+)

| # | 항목 | 기법 | 기대 효과 |
|---|------|------|----------|
| 13 | **Plan-and-Execute 에이전트** | 복잡한 질문 → 계획 수립 → 단계별 실행 → 통합 답변 | "A법과 B법의 차이를 표로 비교" 같은 복합 질의 처리 |
| 14 | **RAG 평가 데이터셋** | 정답 포함 Q&A 세트 → 자동 평가 (Recall, Precision, F1) | RAG 품질 정량적 측정 + 회귀 방지 |
| 15 | **크롤링 자동화 (cron)** | 주기적 크롤링 + 자동 지식화 (점수 임계값 초과 시) | 최신 정보 자동 반영 |
| 16 | **법령 개정 비교** | 동일 법령 버전 간 diff + 변경점 하이라이팅 | 법령 개정 추적 |

---

### 8-5. 개선 우선순위 매트릭스

```
                    구현 난이도
                    낮음          중간          높음
                ┌──────────┬──────────┬──────────┐
    높음        │ 1.피드백UI │ 5.CRAG   │ 8.ToolUse│
    기          │ 2.FS품질  │ 6.요약메모리│          │
    대          │ 3.임베딩캐시│ 7.PDR    │          │
    효          ├──────────┼──────────┼──────────┤
    과          │ 4.SelfRAG│ 11.임베딩  │ 10.계층요약│
                │          │ 9.증분그래프│ 12.BFS   │
                ├──────────┼──────────┼──────────┤
    낮음        │          │ 15.크롤링  │ 13.P&E   │
                │          │          │ 14.평가셋 │
                └──────────┴──────────┴──────────┘
```

**권장 실행 순서**: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → ...

---

## 9. 파일 구조 (최신 — 2026-03-13)

```
workspace/docstore/
├── server.js                       # Express 메인 (32개 라우트)
├── index.html                      # SPA 프론트엔드 (10,195행)
├── vercel.json                     # Vercel 배포 설정
├── ANALYSIS2.md                    # 분석 보고서 v2
├── ANALYSIS3.md                    # 분석 보고서 v3 (본 문서)
│
├── api/                            # API 엔드포인트 (32개)
│   ├── login.js                    # JWT 로그인
│   ├── documents.js                # 문서 CRUD
│   ├── upload.js                   # 파일 업로드 + 임베딩
│   ├── upload-url.js               # 대용량 signed URL
│   ├── url-import.js               # URL 크롤링 임포트
│   ├── search.js                   # 하이브리드 검색 + 자동완성
│   ├── rag.js                      # RAG 질의 (SSE)
│   ├── few-shot.js                 # Few-shot 자동 매칭 API ★신규
│   ├── law.js                      # 법령 검색
│   ├── law-import.js               # 법령 임포트
│   ├── law-graph.js                # 법령 참조 그래프
│   ├── knowledge-graph.js          # 지식그래프 CRUD
│   ├── knowledge-graph-neo4j.js    # Neo4j 연동
│   ├── cross-references.js         # 교차참조 매트릭스
│   ├── communities.js              # 커뮤니티 탐지/요약
│   ├── summary.js                  # AI 요약
│   ├── ocr.js                      # OCR
│   ├── deidentify.js               # 비식별화
│   ├── chat-sessions.js            # 대화 히스토리
│   ├── prompts.js                  # 프롬프트 CRUD
│   ├── rag-traces.js               # RAG 트레이싱
│   ├── api-usage.js                # API 사용량
│   ├── settings.js                 # 앱 설정
│   ├── observability.js            # LangFuse 상태
│   ├── pdf-loaders.js              # PDF 로더 목록
│   ├── split-preview.js            # 청크 미리보기
│   ├── organizations.js            # 조직 관리
│   ├── crawl.js                    # 크롤링 실행
│   ├── crawl-sources.js            # 크롤링 소스
│   ├── crawl-keywords.js           # 크롤링 키워드
│   ├── crawl-ingest.js             # 크롤링 지식화
│   └── naver-news.js               # 네이버 뉴스
│
├── lib/                            # 핵심 라이브러리
│   ├── rag-graph.js                # StateGraph RAG 파이프라인
│   ├── rag-agent.js                # 멀티홉 검색 엔진
│   ├── rag-tracer.js               # RAG 자체 트레이싱
│   ├── hybrid-search.js            # 벡터 + FTS + RRF
│   ├── reranker.js                 # Cohere Rerank
│   ├── embeddings.js               # 임베딩 + Enriched Text
│   ├── output-parser.js            # JSON/MD 파싱 + 환각 검증
│   ├── query-enhancer.js           # 쿼리 리라이팅 + HyDE
│   ├── prompt-manager.js           # 프롬프트 템플릿 엔진
│   ├── few-shot-manager.js         # Few-shot 자동 매칭 ★신규
│   ├── knowledge-graph.js          # NER + 관계 추출
│   ├── llm-ner.js                  # LLM 하이브리드 NER
│   ├── community-detection.js      # Louvain/Leiden 커뮤니티
│   ├── community-summary.js        # 커뮤니티 요약 + 글로벌 검색
│   ├── cross-reference.js          # 교차참조 구축
│   ├── gemini.js                   # 멀티 LLM (Gemini/OpenAI/Claude)
│   ├── langfuse.js                 # LangFuse 추적
│   ├── api-tracker.js              # API 사용량 + 비용
│   ├── text-splitters.js           # 5가지 청킹 전략
│   ├── text-extractor.js           # 멀티포맷 텍스트 추출
│   ├── pdf-extractor.js            # PDF 추출 (플러그인)
│   ├── korean-tokenizer.js         # N-gram + 동의어
│   ├── input-sanitizer.js          # 입력 검증
│   ├── deidentify.js               # 비식별화
│   ├── storage.js                  # Supabase Storage
│   ├── summary-cache.js            # 요약 캐시
│   ├── law-fetcher.js              # 법제처 API
│   ├── doc-analyzer.js             # AI 문서 분석
│   ├── db.js                       # PostgreSQL 풀
│   ├── auth.js                     # JWT + 조직 격리
│   ├── cors.js                     # CORS
│   ├── error-handler.js            # 에러 핸들링
│   ├── rate-limit.js               # Rate Limiting
│   └── pdf-loaders/                # PDF 로더 플러그인 (8개)
│
├── scripts/                        # DB 마이그레이션
│   ├── create-tables.js            # 전체 스키마
│   ├── create-community-tables.js  # 커뮤니티 테이블
│   └── ...
│
└── tests/                          # E2E 테스트 (Playwright)
    ├── login.spec.js
    ├── navigation.spec.js
    ├── documents.spec.js
    ├── search.spec.js
    ├── search-advanced.spec.js     # 27개 검색 심화
    ├── crawl.spec.js               # 29개 크롤링
    ├── chat.spec.js
    └── ...
```

---

## 10. 결론

DocStore는 **법령·규정 도메인에 특화된 풀스택 RAG 시스템**으로, 지난 2일간(03-12~13) 아래 핵심 기능이 추가되며 4대 프레임워크 평가에서 전반적 상향을 달성했다:

| 추가 기능 | 영향 받은 평가 |
|----------|-------------|
| StateGraph 상태 머신 | LangGraph ★2.5→3.3 |
| 커뮤니티 탐지 (Louvain/Leiden) | Graph RAG ★2.8→3.9 |
| 커뮤니티 요약 + 글로벌 검색 | Graph RAG |
| LLM NER 하이브리드 | Graph RAG |
| 프롬프트 매니저 (DB 템플릿) | LangChain ★4.2→4.4 |
| LangFuse + rag_traces | LangChain |
| Few-shot 자동 매칭 + 선택/제거 | Hybrid RAG ★4.6→4.7 |
| 답변 가이드 (주제/관점/형식) | LangGraph |

**다음 우선 과제**: 답변 피드백 UI(👍/👎), Self-RAG, Corrective RAG 루프
