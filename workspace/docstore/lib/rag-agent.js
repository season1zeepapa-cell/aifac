// 멀티홉 RAG 검색 엔진
// 1차 벡터 검색 → 참조 추출 → 2차 검색 → 병합/중복제거/재순위화
const { generateEmbedding } = require('./embeddings');

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

  // ── 1차 검색: 원본 질문으로 벡터 검색 ──
  const embedding = await generateEmbedding(question.trim());
  const hop1Chunks = await vectorSearch(dbQuery, embedding, { topK, docIds });

  if (hop1Chunks.length === 0) {
    return { sources: [], hops: 1 };
  }

  // ── 참조 추출 ──
  const crossRefs = extractCrossReferences(hop1Chunks);

  if (crossRefs.length === 0) {
    // 참조가 없으면 1차 결과만 반환
    return { sources: formatSources(hop1Chunks), hops: 1 };
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

  // ── 병합 + 중복 제거 + 재순위화 ──
  const merged = deduplicateAndRank([...hop1Chunks, ...hop2Chunks], topK + 3);

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
 * 중복 제거 + 유사도 재순위화
 */
function deduplicateAndRank(chunks, limit) {
  const seen = new Set();
  const unique = [];

  for (const chunk of chunks) {
    const key = chunk.chunk_id || chunk.chunk_text?.substring(0, 100);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(chunk);
  }

  // 유사도 내림차순 정렬
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

module.exports = { multiHopSearch, extractCrossReferences };
