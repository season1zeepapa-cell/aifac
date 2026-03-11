# DocStore 종합 분석 보고서

> 작성일: 2026-03-11
> 대상: workspace/docstore (PDF 문서 관리 + 법령 지식 RAG 시스템)
> 배포: https://docstore-eight.vercel.app

---

## 1. 프로젝트 개요

DocStore는 **법령·규정·기출문제 등 다양한 문서를 업로드하여 벡터화하고, 하이브리드 검색과 RAG 기반 AI 질의응답**을 제공하는 풀스택 웹 애플리케이션이다.

### 기술 스택

| 계층 | 기술 |
|------|------|
| 프론트엔드 | React (CDN) + Tailwind CSS, 빌드 도구 없는 단일 SPA |
| 백엔드 | Express.js (로컬) / Vercel Serverless Functions (배포) |
| DB | Supabase PostgreSQL + pgvector (HNSW 인덱스) |
| 임베딩 | OpenAI text-embedding-3-small (1536차원) |
| LLM | Gemini 2.5 Flash (기본) / GPT-4o / Claude Sonnet |
| 리랭킹 | Cohere Rerank v3.5 (선택적) |
| OCR | 6개 엔진 플러그인 (Gemini Vision, CLOVA, Cloud Vision 등) |

### 핵심 파이프라인

```
문서 입력 (PDF/DOCX/CSV/이미지/URL/법령API)
    ↓
텍스트 추출 → 섹션 분할 → 4가지 청킹 전략
    ↓
Enriched 임베딩 (맥락 정보 + 원문 결합)
    ↓
pgvector 저장 + tsvector FTS 인덱스
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
- [x] API 사용량 추적 + 비용 대시보드
- [x] 입력 검증 + SQL 파라미터 바인딩

#### OCR
- [x] 6개 OCR 엔진 플러그인 아키텍처
- [x] 우선순위 폴백 체인 (무료 → 유료)
- [x] OCR 엔진별 설정 UI (관리 탭)

#### E2E 테스트
- [x] Playwright 테스트 인프라 (global-setup, storageState)
- [x] 검색 기능 특화 27개 테스트 (자동완성/하이라이팅/API 구조 등)
- [x] 로그인, 네비게이션, 문서 목록, 채팅 테스트

---

### 미구현 / 부분 구현 (❌ / 🔶)

#### 보안 강화
- 🔶 CORS 도메인 제한 (현재 `*` 전체 허용 → 특정 도메인만 허용 필요)
- ❌ RegExp 인젝션 방어 (pdf-extractor.js 사용자 정의 구분자)
- ❌ 에러 메시지 클라이언트 노출 최소화

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

### 3-1. LangChain 기준 평가

> LangChain: 가장 널리 쓰이는 RAG 프레임워크. 모듈형 체인, 다양한 리트리버, 프롬프트 관리가 핵심.

| LangChain 핵심 컴포넌트 | DocStore 구현 수준 | 상세 |
|---|---|---|
| **Document Loaders** | ★★★★★ | PDF, DOCX, XLSX, CSV, JSON, TXT, MD, 이미지, URL, 법령 API — 10종 이상 로더 완비 |
| **Text Splitters** | ★★★★☆ | 4가지 전략(sentence/recursive/law-article/semantic). LangChain의 RecursiveCharacterTextSplitter 패턴 구현. MarkdownHeaderTextSplitter 미구현 |
| **Embeddings** | ★★★★☆ | OpenAI text-embedding-3-small + Enriched Text. 다만 모델 선택지가 1개 (LangChain은 20+ 모델 지원) |
| **Vector Stores** | ★★★★☆ | pgvector + HNSW 인덱스. LangChain의 Chroma/Pinecone/Weaviate 등 전환 어려움 (직접 SQL) |
| **Retrievers** | ★★★★★ | Hybrid (벡터+FTS+RRF), Cohere Rerank, MMR 다양성 — LangChain EnsembleRetriever와 동등 |
| **Chains/Prompts** | ★★★☆☆ | 직접 프롬프트 관리. 체인 추상화 없음 (RetrievalQA, ConversationalRetrievalChain 패턴 미사용) |
| **Memory** | ★★★★☆ | 채팅 세션 DB 저장/복원, 최근 20메시지 컨텍스트. ConversationBufferWindowMemory와 유사 |
| **Output Parsers** | ★★★★☆ | JSON/마크다운 파싱 + 근거 검증(verified). StructuredOutputParser 패턴 부분 구현 |
| **Callbacks/Tracing** | ★★☆☆☆ | console.log 수준. LangSmith 같은 관측성 도구 미연동 |

**종합: ★★★★☆ (4.0/5)**

LangChain의 핵심 패턴(로더→분할→임베딩→검색→생성)을 프레임워크 의존 없이 직접 구현. 체인 추상화와 관측성(observability)이 부족하지만, 실질적 기능 수준은 LangChain 기반 프로젝트와 동등하다.

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
| chat.spec.js | 4 | AI 채팅 |
| ux-features.spec.js | - | UX 기능 |

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

---

## 6. 파일 구조 (최신)

```
workspace/docstore/
├── server.js                    # Express 메인 서버
├── index.html                   # SPA 프론트엔드 (React + Tailwind CDN)
├── vercel.json                  # Vercel 배포 설정
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
│   └── api-usage.js             # API 사용량 추적
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
│   ├── rate-limit.js            # Rate Limiting
│   ├── text-extractor.js        # 멀티포맷 텍스트 추출
│   ├── pdf-extractor.js         # PDF 특화 추출
│   └── ocr/                     # OCR 엔진 플러그인 (6개)
├── scripts/                     # DB 마이그레이션 스크립트
└── tests/                       # Playwright E2E 테스트
    ├── playwright.config.js
    ├── global-setup.js
    ├── search-advanced.spec.js  # 검색 특화 27개 테스트
    └── *.spec.js                # 기타 테스트
```
