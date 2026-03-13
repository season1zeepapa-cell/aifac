// Hybrid Search 모듈 (벡터 검색 + BM25 전문 검색 + RRF 점수 합산)
//
// ┌─────────────┐    ┌─────────────┐
// │ 벡터 검색    │    │ BM25 검색   │
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
// BM25 공식:
//   score(q, D) = Σ IDF(t) × (tf(t,D) × (k1+1)) / (tf(t,D) + k1 × (1 - b + b × |D|/avgDL))
//   k1 = 1.2 (용어 빈도 포화 속도, 높으면 TF 영향 증가)
//   b  = 0.75 (문서 길이 보정 강도, 0이면 길이 무시, 1이면 완전 보정)
//   IDF(t) = ln((N - n(t) + 0.5) / (n(t) + 0.5) + 1)
//   N = 전체 문서 수, n(t) = 용어 t가 포함된 문서 수
//
// RRF(Reciprocal Rank Fusion) 공식:
//   score(문서) = Σ 1 / (K + rank_i(문서))
//   K = 60 (업계 표준 상수)
//   rank_i = 각 검색 방식에서의 순위 (1부터 시작)

const { generateEmbedding } = require('./embeddings');
const { rerankResults } = require('./reranker');
const { buildTsquery, buildMorphemeTsquery } = require('./korean-tokenizer');

const RRF_K = 60; // RRF 상수 (값이 클수록 하위 순위의 영향이 커짐)

// ── BM25 파라미터 ──
const BM25_K1 = 1.2;  // TF 포화 속도 (높으면 용어 빈도 영향 증가, 보통 1.2~2.0)
const BM25_B = 0.75;   // 문서 길이 보정 강도 (0=무시, 1=완전보정, 보통 0.75)

/**
 * BM25 전문 검색 (Full-Text Search with BM25 Scoring)
 *
 * PostgreSQL의 tsvector/tsquery로 후보를 필터링한 뒤,
 * 애플리케이션 레벨에서 BM25 공식을 적용하여 정확한 스코어링을 수행합니다.
 *
 * [BM25 vs ts_rank_cd 차이]
 * - ts_rank_cd: 커버 밀도 기반, IDF 미반영, TF 포화 없음
 * - BM25: IDF(희귀 용어 가중) + TF 포화(반복 감쇠) + 문서 길이 보정
 *
 * @param {Function} dbQuery - DB 쿼리 함수
 * @param {string} queryText - 검색어
 * @param {Object} options - { topK, docIds, orgId, useMorpheme }
 * @returns {Array} BM25 점수 순 검색 결과
 */
async function ftsSearch(dbQuery, queryText, { topK = 20, docIds = [], orgId = null, useMorpheme = false }) {
  // 형태소 분석 모드 vs 기존 N-gram 모드 선택
  let tsqueryStr, expandedTerms = [];
  let queryTokens = []; // BM25 계산용 개별 토큰
  let ftsColumn = 'dc.fts_vector';

  if (useMorpheme) {
    const morphResult = await buildMorphemeTsquery(queryText, { mode: 'or', useSynonyms: true });
    tsqueryStr = morphResult.tsquery;
    queryTokens = morphResult.morphemeTokens || [];
    if (morphResult.morphemeTokens.length > 0) {
      ftsColumn = 'dc.fts_morpheme_vector';
      console.log(`[BM25 형태소] "${queryText}" → 토큰: ${queryTokens.join(', ')}`);
    }
  } else {
    const result = buildTsquery(queryText, { mode: 'or', useNgrams: true, useSynonyms: true });
    tsqueryStr = result.tsquery;
    expandedTerms = result.expandedTerms;
    // tsquery에서 개별 토큰 추출 (OR 연결된 단어들)
    queryTokens = _extractTokensFromTsquery(tsqueryStr);
    if (expandedTerms.length > 0) {
      console.log(`[BM25] 쿼리 확장: "${queryText}" → +${expandedTerms.length}개 동의어`);
    }
  }

  if (!tsqueryStr || queryTokens.length === 0) return [];

  let filterClause = `${ftsColumn} IS NOT NULL`;
  const params = [tsqueryStr];
  let paramIdx = 2;

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

  // BM25에서는 후보를 넉넉히 가져옴 (앱 레벨 재정렬)
  const candidateLimit = Math.min(topK * 3, 60);
  params.push(candidateLimit);

  // 1단계: tsvector 매칭으로 후보 필터링 + chunk_text 길이 가져오기
  const result = await dbQuery(
    `SELECT
       dc.id AS chunk_id,
       dc.chunk_text,
       ds.section_type,
       ds.metadata AS section_metadata,
       ds.document_id,
       d.title AS document_title,
       d.category,
       length(dc.chunk_text) AS doc_len,
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

  const candidates = result.rows;
  if (candidates.length === 0) return [];

  // 2단계: 전체 문서 통계 조회 (BM25 IDF 계산용)
  //   N = 전체 청크 수, avgDL = 평균 청크 길이
  let totalDocs, avgDocLen;
  try {
    const statsResult = await dbQuery(
      `SELECT COUNT(*) AS total_docs, COALESCE(AVG(length(chunk_text)), 400) AS avg_doc_len
       FROM document_chunks WHERE ${ftsColumn.replace('dc.', '')} IS NOT NULL`
    );
    totalDocs = parseInt(statsResult.rows[0].total_docs) || 1;
    avgDocLen = parseFloat(statsResult.rows[0].avg_doc_len) || 400;
  } catch {
    totalDocs = candidates.length;
    avgDocLen = 400;
  }

  // 3단계: 각 쿼리 토큰의 DF(문서 빈도) 조회 — IDF 계산용
  const dfMap = await _getDocumentFrequencies(dbQuery, queryTokens, ftsColumn);

  // 4단계: 각 후보에 BM25 스코어 계산
  for (const row of candidates) {
    row.bm25_score = _calculateBM25(
      row.chunk_text,
      queryTokens,
      dfMap,
      totalDocs,
      avgDocLen,
      parseInt(row.doc_len) || row.chunk_text.length
    );
    // fts_score도 보존 (디버깅용)
    row.fts_score = parseFloat(row.fts_score) || 0;
  }

  // 5단계: BM25 점수로 재정렬
  candidates.sort((a, b) => b.bm25_score - a.bm25_score);

  console.log(`[BM25] ${candidates.length}개 후보, 상위 점수: ${candidates.slice(0, 3).map(r => r.bm25_score.toFixed(3)).join(', ')}`);

  return candidates.slice(0, Math.min(topK, 30));
}

/**
 * tsquery 문자열에서 개별 토큰을 추출
 * 예: "'개인' | '정보' | '개인정' | '인정보'" → ['개인', '정보', '개인정', '인정보']
 */
function _extractTokensFromTsquery(tsqueryStr) {
  if (!tsqueryStr) return [];
  const matches = tsqueryStr.match(/'([^']+)'/g);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.replace(/'/g, '')))];
}

/**
 * 각 쿼리 토큰의 문서 빈도(DF)를 조회
 * IDF = ln((N - df + 0.5) / (df + 0.5) + 1)
 *
 * @param {Function} dbQuery - DB 쿼리 함수
 * @param {string[]} tokens - 쿼리 토큰 배열
 * @param {string} ftsColumn - FTS 컬럼명
 * @returns {Map<string, number>} 토큰 → DF 매핑
 */
async function _getDocumentFrequencies(dbQuery, tokens, ftsColumn) {
  const dfMap = new Map();
  // 배치 쿼리로 각 토큰의 DF를 한번에 조회
  // 토큰이 너무 많으면 상위 10개만 사용 (성능 보호)
  const limitedTokens = tokens.slice(0, 10);

  for (const token of limitedTokens) {
    try {
      const sanitized = token.replace(/'/g, "''");
      const result = await dbQuery(
        `SELECT COUNT(*) AS df FROM document_chunks
         WHERE ${ftsColumn.replace('dc.', '')} @@ to_tsquery('simple', $1)`,
        [sanitized]
      );
      dfMap.set(token, parseInt(result.rows[0].df) || 0);
    } catch {
      dfMap.set(token, 0);
    }
  }

  return dfMap;
}

/**
 * BM25 스코어 계산
 *
 * 공식: score(q, D) = Σ IDF(t) × (tf × (k1+1)) / (tf + k1 × (1 - b + b × |D|/avgDL))
 *
 * 비유로 설명:
 * - IDF: 희귀한 단어일수록 높은 점수 (모든 문서에 있는 "하다"는 낮음, "영상정보처리기기"는 높음)
 * - TF 포화: 단어가 3번 나오면 좋지만, 30번 나온다고 10배 좋진 않음 (수확 체감)
 * - 길이 보정: 짧은 문서에서 매칭되면 더 관련성 높음 (긴 문서는 아무거나 포함할 수 있으니까)
 *
 * @param {string} text - 문서 텍스트
 * @param {string[]} queryTokens - 쿼리 토큰들
 * @param {Map} dfMap - 토큰→문서빈도 맵
 * @param {number} totalDocs - 전체 문서 수 (N)
 * @param {number} avgDocLen - 평균 문서 길이 (avgDL)
 * @param {number} docLen - 현재 문서 길이 (|D|)
 * @returns {number} BM25 점수
 */
function _calculateBM25(text, queryTokens, dfMap, totalDocs, avgDocLen, docLen) {
  let score = 0;
  const textLower = text.toLowerCase();

  for (const token of queryTokens) {
    // TF: 해당 토큰이 문서에 몇 번 등장하는지
    const tf = _countOccurrences(textLower, token.toLowerCase());
    if (tf === 0) continue;

    // IDF: ln((N - df + 0.5) / (df + 0.5) + 1)
    //   희귀한 용어(df 작음) → IDF 높음 → 가중치 큼
    const df = dfMap.get(token) || 0;
    const idf = Math.log(((totalDocs - df + 0.5) / (df + 0.5)) + 1);

    // BM25 TF 포화: tf × (k1+1) / (tf + k1 × (1 - b + b × |D|/avgDL))
    //   tf가 커져도 (k1+1)에 수렴 → 포화 효과
    //   문서가 평균보다 길면 분모가 커져서 점수 감소 → 길이 보정
    const tfNorm = (tf * (BM25_K1 + 1)) /
      (tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / avgDocLen)));

    score += idf * tfNorm;
  }

  return score;
}

/**
 * 문자열에서 특정 패턴의 출현 횟수를 세는 함수
 * @param {string} text - 대상 텍스트 (소문자)
 * @param {string} token - 찾을 토큰 (소문자)
 * @returns {number} 출현 횟수
 */
function _countOccurrences(text, token) {
  if (!token || token.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(token, pos)) !== -1) {
    count++;
    pos += token.length;
  }
  return count;
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
 * @param {Array} ftsResults - 전문 검색 결과 (bm25_score 순)
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
