# DocStore 현황 분석 및 확장 제안

> 작성일: 2026-03-10
> 역할: PDF 문서 관리 → 지식 벡터화 파이프라인

## 현재 기능 요약

| 파이프라인 | 입력 | 처리 | 출력 |
|-----------|------|------|------|
| PDF 업로드 | PDF 파일 | 텍스트 추출 → 섹션 분할 → 임베딩 | DB 저장 + 벡터 검색 |
| 객관식 파싱 | 기출 PDF | GPT-4o 분할 파싱 (10문제씩) | 문제/보기/정답 구조화 |
| 법령 임포트 | 법령명 검색 | 법제처 API → 조문 파싱 → 계층 라벨링 | 조문별 DB + 벡터 |
| 검색 | 키워드 | 텍스트 ILIKE / 벡터 cosine | 관련 문서/청크 |

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
│   └── law-import.js            # 법령 임포트
├── lib/
│   ├── pdf-extractor.js         # PDF 추출 (텍스트 + OCR + 문제 파싱)
│   ├── embeddings.js            # 청크 분할 + OpenAI 임베딩
│   └── law-fetcher.js           # 법제처 API 클라이언트
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

- [ ] 웹 URL 크롤링 소스 추가
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
- [ ] `api/url-import.js` 신규 (HTML → 텍스트 추출)
- [ ] 업로드 탭 URL 모드 추가
- [ ] RAG 답변 마크다운 렌더링 (marked.js CDN)
- [ ] RAG 대화 컨텍스트 (후속 질문)

### 추가 패키지

```
mammoth    → DOCX 텍스트 추출
xlsx       → Excel 파싱
csv-parse  → CSV 파싱
marked     → RAG 답변 마크다운 렌더링 (CDN)
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
