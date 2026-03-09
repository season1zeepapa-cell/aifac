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
- [ ] 하드코딩 인증 추가 (workspace/error 패턴)
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
| 이미지 | .jpg, .png | Claude 비전 OCR | 내용 유형(일반/표/문제) |
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
- `api/summary.js` 신규 (Gemini 2.0 Flash, 1-2줄 요약)
- 단일 섹션 요약 + 문서 전체 일괄 요약
- `metadata.summary`에 캐싱 (중복 호출 방지)
- 각 섹션에 "AI 요약" 버튼 + "전체 AI 요약" 버튼

### 5단계: 웹 URL 크롤링 + RAG 개선 ✅
- `api/url-import.js` 신규 (HTML → 텍스트 추출 → 단락 분할)
- 업로드 탭에 URL 크롤링 모드 추가 (파일/법령/URL 3가지)
- RAG 답변에 marked.js CDN 마크다운 렌더링

### 미구현 (추후)
- 하드코딩 인증 (사용자 요청으로 제외)
- RAG 대화 컨텍스트 (후속 질문 지원)

---

## 코드베이스 점검 보고서 (2026-03-10)

### 보안 취약점

| 등급 | 항목 | 상태 | 설명 |
|------|------|------|------|
| 🔴 긴급 | 인증 없음 | 미조치 | 모든 API가 공개 상태. 누구나 업로드/삭제/AI 호출 가능 |
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
| Google Gemini | `api/rag.js`, `api/summary.js` | gemini-2.0-flash | 무료~저가 | 🟢 낮음 |

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

- [ ] 하드코딩 인증 추가 (보안 + 비용 방어 1차 방어선)
- [ ] API 호출 횟수 제한 (일일 한도)
- [ ] OCR 모델 다운그레이드 (Opus → Sonnet)
- [ ] `callGemini` 공통 모듈 분리
- [ ] 에러 메시지 클라이언트 노출 최소화

#### 중기 (활용도 향상)

- [ ] 문서 수정/제목 변경 기능 (현재 삭제 후 재업로드만 가능)
- [ ] 임베딩 재생성 버튼 (실패한 임베딩 수동 재시도)
- [ ] 검색 결과 하이라이팅 (검색어 위치 시각적 표시)
- [ ] API 사용량 대시보드 (일/월별 호출 현황)

#### 장기 (확장)

- [ ] RAG 대화 컨텍스트 (후속 질문 지원)
- [ ] 문서 간 비교 기능 (법령 개정 전후 비교)
- [ ] 원본 파일 Supabase Storage 이전 (DB BYTEA → 스토리지 분리)

### 우선 실행 순서

```
1순위: 인증 추가 (보안 + 비용 방어)
2순위: API 호출 횟수 제한 (일일 한도)
3순위: OCR 모델 다운그레이드 (Opus → Sonnet)
4순위: callGemini / 임베딩 로직 공통화 (리팩토링)
5순위: 에러 메시지 정리 + CORS 제한
```

---

## 환경변수

```
DATABASE_URL=postgresql://...
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
LAW_API_OC=법제처API인증키
GEMINI_API_KEY=AI... (RAG용)
```
