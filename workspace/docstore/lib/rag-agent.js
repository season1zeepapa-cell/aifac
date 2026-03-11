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
  const { topK = 5, docIds = [], orgId = null } = options;

  // ── 1차 검색: 하이브리드 검색 (벡터 + 전문검색 + RRF, 조직별 격리) ──
  let hop1Chunks;
  try {
    hop1Chunks = await hybridSearch(dbQuery, question, { topK, docIds, orgId });
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
 * 중복 제거 + 점수 정규화 + Cohere Rerank + MMR 다양성 보장
 *
 * 처리 흐름:
 *   1. 중복 제거 (chunk_id 또는 텍스트 앞 100자 기준)
 *   2. 점수 정규화 — similarity, rrf_score를 0~1 범위로 min-max 정규화
 *   3. 가중 합산 — finalScore = α×similarity + β×rrfScore (사용 가능한 점수만 반영)
 *   4. Cohere Rerank 시도 → 성공 시 relevance_score를 finalScore에 반영
 *   5. MMR 적용 — 내용이 겹치는 청크를 감점하여 다양성 보장
 *
 * @param {Array} chunks - 검색된 청크 배열 (1차 + 2차 + 교차참조 병합)
 * @param {string} question - 사용자 질문 (Rerank에 사용)
 * @param {number} limit - 최종 반환 개수
 * @returns {Promise<Array>} 재순위화된 청크 배열
 */
async function deduplicateAndRerank(chunks, question, limit) {
  // ── 1단계: 중복 제거 ──
  const seen = new Set();
  const unique = [];

  for (const chunk of chunks) {
    const key = chunk.chunk_id || chunk.chunk_text?.substring(0, 100);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(chunk);
  }

  if (unique.length === 0) return [];

  // ── 2단계: 점수 정규화 (min-max → 0~1 범위) ──
  normalizeScores(unique);

  // ── 3단계: Cohere Rerank 시도 ──
  let rerankApplied = false;
  try {
    const reranked = await rerankResults(question, unique, unique.length);

    if (reranked.length > 0 && reranked[0].relevance_score !== undefined) {
      // Rerank 성공 → relevance_score 정규화 후 반영
      normalizeScores(reranked, ['relevance_score']);
      for (const chunk of reranked) {
        chunk.final_score = computeFinalScore(chunk);
      }
      reranked.sort((a, b) => b.final_score - a.final_score);
      console.log(`[RAG Agent] Cohere Rerank 적용: ${unique.length}개 → 가중 합산 정렬`);

      // ── 4단계: MMR 다양성 보장 ──
      return applyMMR(reranked, limit);
    }
  } catch (err) {
    console.warn('[RAG Agent] Rerank 실패, 가중 합산으로 fallback:', err.message);
  }

  // ── Fallback: Rerank 없이 가중 합산 + MMR ──
  for (const chunk of unique) {
    chunk.final_score = computeFinalScore(chunk);
  }
  unique.sort((a, b) => b.final_score - a.final_score);
  return applyMMR(unique, limit);
}

// ────────────────────────────────────────────────────
// Phase 2: 점수 정규화 + 가중 합산
// ────────────────────────────────────────────────────

/**
 * Min-max 정규화: 지정된 점수 필드들을 0~1 범위로 변환
 * 정규화된 값은 `필드명_norm` 속성에 저장
 *
 * @param {Array} chunks - 청크 배열
 * @param {string[]} fields - 정규화할 필드명 목록
 */
function normalizeScores(chunks, fields = ['similarity', 'rrf_score']) {
  for (const field of fields) {
    const values = chunks.map(c => parseFloat(c[field] || 0)).filter(v => v > 0);
    if (values.length === 0) continue;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;

    for (const chunk of chunks) {
      const val = parseFloat(chunk[field] || 0);
      // 값이 0이면 해당 점수가 없는 것 → 0 유지
      // 모든 값이 같으면 (range === 0) → 1.0으로 통일
      chunk[`${field}_norm`] = val > 0 ? (range > 0 ? (val - min) / range : 1.0) : 0;
    }
  }
}

/**
 * 가중 합산으로 최종 점수 계산
 * 사용 가능한 점수만 반영하여 가중 평균을 구함
 *
 * 가중치 설계:
 *   - similarity (0.4): 벡터 의미 유사도 — 질문과의 의미적 근접성
 *   - rrf_score (0.3): RRF 순위 점수 — 벡터+전문검색 교차 확인
 *   - relevance_score (0.3): Cohere 관련도 — 질문-문서 정밀 매칭
 */
function computeFinalScore(chunk) {
  const weights = [
    { field: 'similarity_norm', weight: 0.4 },
    { field: 'rrf_score_norm', weight: 0.3 },
    { field: 'relevance_score_norm', weight: 0.3 },
  ];

  let totalWeight = 0;
  let totalScore = 0;

  for (const { field, weight } of weights) {
    const val = chunk[field] || 0;
    if (val > 0) {
      totalScore += weight * val;
      totalWeight += weight;
    }
  }

  return totalWeight > 0 ? totalScore / totalWeight : 0;
}

// ────────────────────────────────────────────────────
// Phase 3: MMR (Maximal Marginal Relevance)
// ────────────────────────────────────────────────────

/**
 * MMR 알고리즘으로 다양성 보장
 *
 * 같은 조문이나 비슷한 내용을 가진 청크가 여러 개 검색되면
 * LLM에 중복 정보가 전달되어 답변 품질이 떨어짐.
 * MMR은 "관련성은 높되, 이미 선택된 것과는 다른" 청크를 우선 선택함.
 *
 * 공식: MMR(d) = λ × relevance(d) - (1-λ) × max(similarity(d, selected))
 *   - λ가 높을수록 관련성 중시 (1.0이면 MMR 비활성화)
 *   - λ가 낮을수록 다양성 중시
 *
 * @param {Array} chunks - finalScore 순 정렬된 청크 배열
 * @param {number} limit - 최종 선택 개수
 * @param {number} lambda - 관련성 vs 다양성 균형 (기본 0.7)
 * @returns {Array} MMR로 선택된 청크 배열
 */
function applyMMR(chunks, limit, lambda = 0.7) {
  if (chunks.length <= limit) return chunks;

  // 최고 점수 청크는 무조건 선택
  const selected = [chunks[0]];
  const remaining = new Set(chunks.slice(1).map((_, i) => i + 1));

  while (selected.length < limit && remaining.size > 0) {
    let bestIdx = -1;
    let bestMMR = -Infinity;

    for (const idx of remaining) {
      const candidate = chunks[idx];
      const relevance = candidate.final_score || parseFloat(candidate.similarity) || 0;

      // 이미 선택된 청크들과의 최대 텍스트 유사도
      let maxSim = 0;
      for (const sel of selected) {
        const sim = textSimilarity(candidate.chunk_text, sel.chunk_text);
        if (sim > maxSim) maxSim = sim;
      }

      // MMR 점수: 관련성 높고 + 기존 선택과 겹치지 않을수록 높음
      const mmrScore = lambda * relevance - (1 - lambda) * maxSim;

      if (mmrScore > bestMMR) {
        bestMMR = mmrScore;
        bestIdx = idx;
      }
    }

    if (bestIdx >= 0) {
      selected.push(chunks[bestIdx]);
      remaining.delete(bestIdx);
    } else {
      break;
    }
  }

  return selected;
}

/**
 * 텍스트 유사도 계산 (3-gram Jaccard 유사도)
 *
 * 두 텍스트를 3글자씩 잘라서 집합으로 만든 뒤
 * 교집합 / 합집합 비율로 유사도 측정 (0~1)
 * → 임베딩 API 호출 없이 빠르게 텍스트 중복도 판단
 *
 * @param {string} textA
 * @param {string} textB
 * @returns {number} 유사도 (0~1, 1이면 동일한 텍스트)
 */
function textSimilarity(textA, textB) {
  if (!textA || !textB) return 0;

  // 성능을 위해 앞 500자만 비교
  const a = textA.substring(0, 500);
  const b = textB.substring(0, 500);
  const N = 3;

  const ngramA = new Set();
  const ngramB = new Set();

  for (let i = 0; i <= a.length - N; i++) ngramA.add(a.substring(i, i + N));
  for (let i = 0; i <= b.length - N; i++) ngramB.add(b.substring(i, i + N));

  let intersection = 0;
  for (const gram of ngramA) {
    if (ngramB.has(gram)) intersection++;
  }

  const union = ngramA.size + ngramB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * DB 결과를 소스 형태로 포맷
 */
function formatSources(chunks) {
  return chunks.map(row => {
    const meta = row.section_metadata || {};
    const source = {
      text: row.chunk_text,
      documentTitle: row.document_title,
      documentId: row.document_id,
      category: row.category,
      label: meta.label || '',
      chapter: meta.chapter || '',
      articleNumber: meta.articleNumber || '',
      articleTitle: meta.articleTitle || '',
      similarity: parseFloat(row.similarity || 0).toFixed(4),
    };
    // 가중 합산 점수가 있으면 포함 (디버깅/분석용)
    if (row.final_score !== undefined) source.finalScore = row.final_score.toFixed(4);
    if (row.relevance_score !== undefined) source.relevanceScore = row.relevance_score.toFixed(4);
    return source;
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
