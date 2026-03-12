// Hybrid Search 모듈 (벡터 검색 + 전문 검색 + RRF 점수 합산)
//
// ┌─────────────┐    ┌─────────────┐
// │ 벡터 검색    │    │ 전문 검색    │
// │ (pgvector)  │    │ (tsvector)  │
// └──────┬──────┘    └──────┬──────┘
//        │                  │
//        └───────┬──────────┘
//                ▼
//        ┌──────────────┐
//        │  RRF 합산     │
//        │ (순위 기반)   │
//        └──────┬───────┘
//               ▼
//        정렬된 결과 반환
//
// RRF(Reciprocal Rank Fusion) 공식:
//   score(문서) = Σ 1 / (K + rank_i(문서))
//   K = 60 (업계 표준 상수)
//   rank_i = 각 검색 방식에서의 순위 (1부터 시작)

const { generateEmbedding } = require('./embeddings');
const { rerankResults } = require('./reranker');
const { buildTsquery, buildMorphemeTsquery } = require('./korean-tokenizer');

const RRF_K = 60; // RRF 상수 (값이 클수록 하위 순위의 영향이 커짐)

/**
 * 전문 검색 (Full-Text Search)
 * PostgreSQL의 tsvector/tsquery를 활용한 키워드 매칭
 *
 * @param {Function} dbQuery - DB 쿼리 함수
 * @param {string} queryText - 검색어
 * @param {Object} options - { topK, docIds }
 * @returns {Array} 검색 결과 (chunk 배열)
 */
async function ftsSearch(dbQuery, queryText, { topK = 20, docIds = [], orgId = null, useMorpheme = false }) {
  // 형태소 분석 모드 vs 기존 N-gram 모드 선택
  let tsqueryStr, expandedTerms = [];
  let ftsColumn = 'dc.fts_vector'; // 기본: N-gram 기반 tsvector

  if (useMorpheme) {
    // 형태소 분석 기반 검색
    const morphResult = await buildMorphemeTsquery(queryText, { mode: 'or', useSynonyms: true });
    tsqueryStr = morphResult.tsquery;
    if (morphResult.morphemeTokens.length > 0) {
      ftsColumn = 'dc.fts_morpheme_vector'; // 형태소 tsvector 컬럼 사용
      console.log(`[FTS 형태소] "${queryText}" → 토큰: ${morphResult.morphemeTokens.join(', ')}`);
    }
  } else {
    // 기존 N-gram + 동의어 방식
    const result = buildTsquery(queryText, { mode: 'or', useNgrams: true, useSynonyms: true });
    tsqueryStr = result.tsquery;
    expandedTerms = result.expandedTerms;
    if (expandedTerms.length > 0) {
      console.log(`[FTS] 쿼리 확장: "${queryText}" → +${expandedTerms.length}개 동의어`);
    }
  }

  if (!tsqueryStr) return [];

  let filterClause = `${ftsColumn} IS NOT NULL`;
  const params = [tsqueryStr];
  let paramIdx = 2;

  // 조직별 격리
  if (orgId !== null) {
    filterClause += ` AND d.org_id = $${paramIdx}`;
    params.push(orgId);
    paramIdx++;
  }

  if (docIds.length > 0) {
    filterClause += ` AND ds.document_id = ANY($${paramIdx})`;
    params.push(docIds);
    paramIdx++;
  }
  params.push(Math.min(topK, 30));

  // ts_rank_cd: Cover Density 점수화 (BM25와 유사)
  // - 매칭된 단어들이 서로 가까이 있을수록 높은 점수
  // - 32 플래그: 문서 길이로 정규화 (긴 문서가 불공정하게 유리하지 않도록)
  const result = await dbQuery(
    `SELECT
       dc.id AS chunk_id,
       dc.chunk_text,
       ds.section_type,
       ds.metadata AS section_metadata,
       ds.document_id,
       d.title AS document_title,
       d.category,
       ts_rank_cd(${ftsColumn}, to_tsquery('simple', $1), 32) AS fts_score,
       ts_headline('simple', dc.chunk_text, to_tsquery('simple', $1),
         'StartSel=<mark>, StopSel=</mark>, MaxWords=60, MinWords=20, MaxFragments=2'
       ) AS headline
     FROM document_chunks dc
     JOIN document_sections ds ON dc.section_id = ds.id
     JOIN documents d ON ds.document_id = d.id
     WHERE ${filterClause}
       AND ${ftsColumn} @@ to_tsquery('simple', $1)
       AND d.deleted_at IS NULL
     ORDER BY fts_score DESC
     LIMIT $${paramIdx}`,
    params
  );

  return result.rows;
}

/**
 * 벡터 유사도 검색
 * pgvector의 코사인 유사도를 활용한 의미 검색
 *
 * @param {Function} dbQuery - DB 쿼리 함수
 * @param {number[]} embedding - 질문 임베딩 벡터
 * @param {Object} options - { topK, docIds }
 * @returns {Array} 검색 결과 (chunk 배열)
 */
async function vectorSearch(dbQuery, embedding, { topK = 20, docIds = [], orgId = null }) {
  const vecStr = `[${embedding.join(',')}]`;
  let filterClause = 'dc.embedding IS NOT NULL';
  const params = [vecStr];
  let paramIdx = 2;

  // 조직별 격리
  if (orgId !== null) {
    filterClause += ` AND d.org_id = $${paramIdx}`;
    params.push(orgId);
    paramIdx++;
  }

  if (docIds.length > 0) {
    filterClause += ` AND ds.document_id = ANY($${paramIdx})`;
    params.push(docIds);
    paramIdx++;
  }
  params.push(Math.min(topK, 30));

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
       AND d.deleted_at IS NULL
     ORDER BY dc.embedding <=> $1::vector
     LIMIT $${paramIdx}`,
    params
  );

  return result.rows;
}

/**
 * RRF(Reciprocal Rank Fusion) 점수 합산
 *
 * 두 검색 방식의 결과를 순위 기반으로 합산하여 최종 순위를 결정
 * 예시:
 *   - 문서 A: 벡터 1위, FTS 3위 → 1/(60+1) + 1/(60+3) = 0.01639 + 0.01587 = 0.03226
 *   - 문서 B: 벡터 5위, FTS 1위 → 1/(60+5) + 1/(60+1) = 0.01538 + 0.01639 = 0.03177
 *   → 문서 A가 최종 1위 (둘 다 높은 순위에 있으므로)
 *
 * @param {Array} vectorResults - 벡터 검색 결과 (similarity 순)
 * @param {Array} ftsResults - 전문 검색 결과 (fts_score 순)
 * @param {number} topK - 최종 결과 개수
 * @returns {Array} RRF 점수 순으로 정렬된 결과
 */
function rrfFusion(vectorResults, ftsResults, topK = 10) {
  const scoreMap = new Map(); // chunk_id → { chunk데이터, rrfScore, ranks }

  // 벡터 검색 결과에 RRF 점수 부여
  vectorResults.forEach((row, idx) => {
    const rank = idx + 1; // 1부터 시작
    const rrfScore = 1 / (RRF_K + rank);
    const key = row.chunk_id;

    scoreMap.set(key, {
      ...row,
      rrf_score: rrfScore,
      vector_rank: rank,
      fts_rank: null,
      similarity: parseFloat(row.similarity || 0),
    });
  });

  // 전문 검색 결과에 RRF 점수 합산
  ftsResults.forEach((row, idx) => {
    const rank = idx + 1;
    const rrfScore = 1 / (RRF_K + rank);
    const key = row.chunk_id;

    if (scoreMap.has(key)) {
      // 양쪽 모두에서 발견 → 점수 합산 (보너스!)
      const existing = scoreMap.get(key);
      existing.rrf_score += rrfScore;
      existing.fts_rank = rank;
      // FTS 결과의 headline을 합침 (벡터 검색에는 없으므로)
      if (row.headline) existing.headline = row.headline;
    } else {
      // FTS에서만 발견
      scoreMap.set(key, {
        ...row,
        rrf_score: rrfScore,
        vector_rank: null,
        fts_rank: rank,
        similarity: 0,
      });
    }
  });

  // RRF 점수 내림차순 정렬 → 상위 topK개 반환
  const sorted = [...scoreMap.values()]
    .sort((a, b) => b.rrf_score - a.rrf_score)
    .slice(0, topK);

  return sorted;
}

/**
 * 하이브리드 검색 (메인 함수)
 * 벡터 검색 + 전문 검색을 동시에 실행하고 RRF로 합산
 *
 * @param {Function} dbQuery - DB 쿼리 함수
 * @param {string} question - 검색 질문
 * @param {Object} options - { topK, docIds }
 * @returns {Array} RRF 점수 순 결과
 */
async function hybridSearch(dbQuery, question, options = {}) {
  const { topK = 10, docIds = [], orgId = null, useMorpheme = false } = options;

  // 임베딩 생성
  const embedding = await generateEmbedding(question.trim());

  // 벡터 검색과 전문 검색을 병렬 실행 (성능 최적화, 조직별 격리)
  const [vecResults, ftsResults] = await Promise.all([
    vectorSearch(dbQuery, embedding, { topK: topK * 2, docIds, orgId }),
    ftsSearch(dbQuery, question, { topK: topK * 2, docIds, orgId, useMorpheme }),
  ]);

  // RRF로 두 결과를 합산하여 최종 순위 결정
  // rerank용 후보는 넉넉하게 확보 (topK * 2)
  const fused = rrfFusion(vecResults, ftsResults, topK * 2);

  // Cohere Rerank 적용 (COHERE_API_KEY 있을 때만, 없으면 RRF 순서 유지)
  const reranked = await rerankResults(question, fused, topK);

  return reranked;
}

module.exports = {
  hybridSearch,
  ftsSearch,
  vectorSearch,
  rrfFusion,
};
