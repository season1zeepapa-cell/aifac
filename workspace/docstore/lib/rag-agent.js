// 멀티홉 RAG 검색 엔진
// 1차 하이브리드 검색 → 참조 추출 → 2차 벡터 검색 → 병합/중복제거/재순위화(Cohere Rerank)
const { generateEmbedding } = require('./embeddings');
const { hybridSearch } = require('./hybrid-search');
const { rerankResults } = require('./reranker');

/**
 * 청크 텍스트에서 법령 교차 참조를 추출
 * - "개인정보 보호법 제10조" (타 법령 참조)
 * - "제5조에 따라", "제10조의2" (내부 조문 참조)
 * @param {Array} chunks - 검색된 청크 배열
 * @returns {string[]} 추가 검색할 참조 쿼리 목록
 */
function extractCrossReferences(chunks) {
  const refs = new Set();

  for (const chunk of chunks) {
    const text = chunk.chunk_text || '';

    // 타 법령 참조: "○○법 제N조"
    const lawRefs = text.match(/[가-힣]{2,20}법\s*제\d+조(?:의\d+)?/g);
    if (lawRefs) lawRefs.forEach(r => refs.add(r));

    // 내부 조문 참조: "제N조" (자기 문서 내)
    const articleRefs = text.match(/제(\d+)조(?:의\d+)?(?:제\d+항)?/g);
    if (articleRefs) {
      const docTitle = chunk.document_title || '';
      articleRefs.forEach(r => {
        // 조문 번호만 추출하여 문서 제목과 합침
        if (docTitle) refs.add(`${docTitle} ${r}`);
      });
    }

    // 법률 관계어 뒤의 참조 감지: "~에 따라", "~를 준용"
    const relRefs = text.match(/(?:준용|적용|의거|따라|근거)\s*(?:한다|하여|하는)?\s*[.]/g);
    // 관계어 자체는 검색 쿼리로 쓰지 않음 (위 패턴으로 이미 캡처)
  }

  return [...refs];
}

/**
 * 멀티홉 RAG 검색
 * @param {Function} dbQuery - DB 쿼리 함수
 * @param {string} question - 사용자 질문
 * @param {Object} options - { topK, docIds }
 * @returns {{ sources: Array, hops: number }}
 */
async function multiHopSearch(dbQuery, question, options = {}) {
  const { topK = 5, docIds = [] } = options;

  // ── 1차 검색: 하이브리드 검색 (벡터 + 전문검색 + RRF) ──
  let hop1Chunks;
  try {
    hop1Chunks = await hybridSearch(dbQuery, question, { topK, docIds });
  } catch (err) {
    // FTS 컬럼 미생성 등의 경우 기존 벡터 검색으로 fallback
    console.warn('[RAG Agent] 하이브리드 검색 실패, 벡터 검색으로 fallback:', err.message);
    const embedding = await generateEmbedding(question.trim());
    hop1Chunks = await vectorSearch(dbQuery, embedding, { topK, docIds });
  }

  if (hop1Chunks.length === 0) {
    return { sources: [], hops: 1 };
  }

  // ── 참조 추출 ──
  const crossRefs = extractCrossReferences(hop1Chunks);

  // ── DB 교차 참조 테이블에서 관련 섹션 가져오기 ──
  const hop1SectionIds = hop1Chunks
    .map(c => c.chunk_id)
    .filter(Boolean);
  let dbCrossRefChunks = [];
  if (hop1SectionIds.length > 0) {
    try {
      dbCrossRefChunks = await fetchCrossRefChunks(dbQuery, hop1Chunks);
    } catch (err) {
      console.warn('[RAG Agent] 교차 참조 테이블 조회 실패:', err.message);
    }
  }

  if (crossRefs.length === 0 && dbCrossRefChunks.length === 0) {
    // 참조가 없어도 1차 결과에 Rerank 적용
    const reranked = await deduplicateAndRerank(hop1Chunks, question, topK);
    return { sources: formatSources(reranked), hops: 1 };
  }

  // ── 2차 검색: 추출된 참조를 쿼리로 추가 검색 ──
  // 참조 쿼리 최대 3개 (토큰 절약)
  const refQueries = crossRefs.slice(0, 3);
  const hop2Chunks = [];

  for (const refQuery of refQueries) {
    try {
      const refEmbedding = await generateEmbedding(refQuery);
      const results = await vectorSearch(dbQuery, refEmbedding, {
        topK: 3,
        docIds: [], // 2차 검색은 전체 문서 대상 (타 법령 참조 대응)
      });
      hop2Chunks.push(...results);
    } catch (err) {
      console.warn(`[RAG Agent] 2차 검색 실패 (${refQuery}):`, err.message);
    }
  }

  // ── 병합 + 중복 제거 + Cohere Rerank 재순위화 ──
  const merged = await deduplicateAndRerank(
    [...hop1Chunks, ...hop2Chunks, ...dbCrossRefChunks],
    question,
    topK + 3
  );

  return {
    sources: formatSources(merged),
    hops: 2,
    crossRefs: refQueries,
  };
}

/**
 * 벡터 유사도 검색 (내부 헬퍼)
 */
async function vectorSearch(dbQuery, embedding, { topK = 5, docIds = [] }) {
  const vecStr = `[${embedding.join(',')}]`;
  let filterClause = 'dc.embedding IS NOT NULL';
  const params = [vecStr];
  let paramIdx = 2;

  if (docIds.length > 0) {
    filterClause += ` AND ds.document_id = ANY($${paramIdx})`;
    params.push(docIds);
    paramIdx++;
  }
  params.push(Math.min(topK, 15));

  const result = await dbQuery(
    `SELECT
       dc.id AS chunk_id,
       dc.chunk_text,
       ds.section_type,
       ds.metadata AS section_metadata,
       ds.document_id,
       d.title AS document_title,
       d.category,
       1 - (dc.embedding <=> $1::vector) AS similarity
     FROM document_chunks dc
     JOIN document_sections ds ON dc.section_id = ds.id
     JOIN documents d ON ds.document_id = d.id
     WHERE ${filterClause}
     ORDER BY dc.embedding <=> $1::vector
     LIMIT $${paramIdx}`,
    params
  );

  return result.rows;
}

/**
 * 중복 제거 + Cohere Rerank 재순위화
 * - Cohere API 키가 있으면: 중복 제거 → Rerank (질문-청크 관련도 기반)
 * - Cohere API 키가 없으면: 중복 제거 → 기존 유사도 정렬 (fallback)
 *
 * @param {Array} chunks - 검색된 청크 배열 (1차 + 2차 + 교차참조 병합)
 * @param {string} question - 사용자 질문 (Rerank에 사용)
 * @param {number} limit - 최종 반환 개수
 * @returns {Promise<Array>} 재순위화된 청크 배열
 */
async function deduplicateAndRerank(chunks, question, limit) {
  // 1단계: 중복 제거
  const seen = new Set();
  const unique = [];

  for (const chunk of chunks) {
    const key = chunk.chunk_id || chunk.chunk_text?.substring(0, 100);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(chunk);
  }

  // 2단계: Cohere Rerank 시도 (질문-청크 관련도 기반 재순위화)
  try {
    const reranked = await rerankResults(question, unique, limit);

    // rerankResults는 Cohere 키가 없으면 원본 순서 유지 (slice만 수행)
    // relevance_score가 있으면 Rerank 성공
    if (reranked.length > 0 && reranked[0].relevance_score !== undefined) {
      console.log(`[RAG Agent] Cohere Rerank 적용: ${unique.length}개 → ${reranked.length}개`);
      return reranked;
    }
  } catch (err) {
    console.warn('[RAG Agent] Rerank 실패, 유사도 정렬로 fallback:', err.message);
  }

  // 3단계: Fallback — 기존 유사도 내림차순 정렬
  unique.sort((a, b) => parseFloat(b.similarity) - parseFloat(a.similarity));
  return unique.slice(0, limit);
}

/**
 * DB 결과를 소스 형태로 포맷
 */
function formatSources(chunks) {
  return chunks.map(row => {
    const meta = row.section_metadata || {};
    return {
      text: row.chunk_text,
      documentTitle: row.document_title,
      documentId: row.document_id,
      category: row.category,
      label: meta.label || '',
      chapter: meta.chapter || '',
      articleNumber: meta.articleNumber || '',
      articleTitle: meta.articleTitle || '',
      similarity: parseFloat(row.similarity).toFixed(4),
    };
  });
}

/**
 * 교차 참조 테이블에서 관련 청크를 가져오기
 * 1차 검색 결과의 섹션들과 교차 참조 관계에 있는 타 문서 섹션의 청크 반환
 */
async function fetchCrossRefChunks(dbQuery, hop1Chunks) {
  // 1차 결과에서 섹션 ID 추출 (section_id가 없으면 document_id 기반으로 조회)
  const docIds = [...new Set(hop1Chunks.map(c => c.document_id).filter(Boolean))];
  if (docIds.length === 0) return [];

  // 교차 참조 테이블에서 관련 타 문서 섹션 찾기
  const crossRefResult = await dbQuery(
    `SELECT DISTINCT
       ts.id AS section_id,
       cr.relation_type,
       cr.confidence
     FROM cross_references cr
     JOIN document_sections ts ON cr.target_section_id = ts.id
     WHERE cr.source_document_id = ANY($1)
       AND cr.target_document_id != ALL($1)
       AND cr.confidence >= 0.8
     ORDER BY cr.confidence DESC
     LIMIT 5`,
    [docIds]
  );

  if (crossRefResult.rows.length === 0) return [];

  // 섹션 ID → confidence 맵 (동적 유사도 할당에 사용)
  const confidenceMap = new Map();
  crossRefResult.rows.forEach(r => {
    confidenceMap.set(r.section_id, parseFloat(r.confidence));
  });
  const sectionIds = crossRefResult.rows.map(r => r.section_id);

  // 해당 섹션들의 청크 가져오기
  const chunkResult = await dbQuery(
    `SELECT
       dc.id AS chunk_id,
       dc.chunk_text,
       ds.id AS section_id,
       ds.section_type,
       ds.metadata AS section_metadata,
       ds.document_id,
       d.title AS document_title,
       d.category
     FROM document_chunks dc
     JOIN document_sections ds ON dc.section_id = ds.id
     JOIN documents d ON ds.document_id = d.id
     WHERE ds.id = ANY($1)
       AND dc.chunk_text IS NOT NULL
     ORDER BY dc.chunk_index
     LIMIT 5`,
    [sectionIds]
  );

  // 교차참조 confidence를 similarity로 사용 (고정 0.75 대신 동적 값)
  return chunkResult.rows.map(row => ({
    ...row,
    similarity: confidenceMap.get(row.section_id) || 0.75,
  }));
}

module.exports = { multiHopSearch, extractCrossReferences };
