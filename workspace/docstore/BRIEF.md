# Brief: DocStore — PDF 텍스트 추출 & DB 저장 시스템

> 다양한 문서(PDF, 추후 Word/Excel)에서 텍스트를 추출하여 Supabase DB에 구조화 저장하고, 벡터 임베딩으로 검색/AI 활용을 지원하는 시스템

## Requirements
- [ ] 1. 텍스트 기반 PDF에서 텍스트 추출 (pdf-parse 라이브러리)
- [ ] 2. 스캔/이미지 PDF 페이지는 Claude Opus 4.6 비전 API로 OCR 처리
- [ ] 3. 추출 단위를 선택 가능 (페이지별 / 섹션별 / 문서 전체 / 사용자 정의) → Supabase에 저장
- [ ] 4. 청크별 벡터 임베딩 생성 (OpenAI text-embedding-3-small) → pgvector 저장
- [ ] 5. 로컬 CLI 스크립트로 PDF 일괄 처리 가능
- [ ] 6. 웹 UI에서 PDF 업로드 → 자동 추출 + DB 저장
- [ ] 7. 저장된 문서 목록 조회, 텍스트 검색, 벡터 유사도 검색 지원
- [ ] 8. 문서 카테고리 분류 (법령, 기출, 규정, 기타)

## DB 테이블 구조
- **`documents`** — id, title, file_type, category, upload_date, metadata(JSONB)
- **`document_sections`** — id, document_id, section_type(page/section/full/custom), section_index, raw_text, image_url
- **`document_chunks`** — id, section_id, chunk_text, embedding(vector), chunk_index

## Constraints
- 기존 Supabase DB에 신규 테이블 추가 (별도 DB 아님)
- Vercel + Supabase 배포 패턴 (workspace/error와 동일)
- 작업 시 Agent와 Skill을 우선 활용
- pgvector 확장 활성화 필요

## Non-goals
- Word/Excel 지원 (1차 스코프 아님, 이후 확장)
- 자체 벡터 DB 구축 (Pinecone, Chroma 등 사용 안 함)
- PDF 원본 파일 자체를 DB에 저장하는 것

## Style
- workspace/error와 동일한 코드 스타일 (2-space 인덴트, 한국어 주석)
- 모바일 퍼스트 반응형 웹 UI
- 다크모드 기본 지원

## Key Concepts
- **OCR**: 이미지에서 글자를 인식해내는 기술 (스캔 PDF 처리용)
- **청크(chunk)**: 긴 텍스트를 AI가 처리하기 좋은 크기로 나눈 조각
- **벡터 임베딩**: 텍스트를 숫자 배열로 변환한 것, 의미 기반 검색에 사용
- **pgvector**: PostgreSQL에서 벡터 데이터를 저장/검색하는 확장 기능

## Open Questions
- 청크 크기 (500자? 1000자?) — 실험 후 결정
- 임베딩 차원 수 (text-embedding-3-small 기본 1536)
- 웹 UI 인증 — workspace/error와 동일한 하드코딩 인증 적용 여부
