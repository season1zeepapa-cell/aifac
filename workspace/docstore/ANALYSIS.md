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
- [x] 하드코딩 인증 추가 (workspace/error 패턴)
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

## 환경변수

```
DATABASE_URL=postgresql://...
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
LAW_API_OC=법제처API인증키
GEMINI_API_KEY=AI... (RAG용)
```
