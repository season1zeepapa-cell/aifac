// Few-shot 자동 매칭 매니저
//
// rag_traces 테이블에서 과거 성공한 Q&A를 검색하여
// 현재 질문과 유사한 예시를 자동으로 선정한다.
//
// 동작 방식:
//   1. rag_traces에서 성공한 Q&A(conclusion 있음) 조회
//   2. 키워드 기반 유사도 점수 계산
//   3. 상위 N개를 few-shot 예시 형태로 반환
//   4. prompt-manager의 formatFewShotExamples()와 호환
//
// 사용법:
//   const { findRelevantFewShots } = require('./few-shot-manager');
//   const examples = await findRelevantFewShots(query, question, { category, maxExamples: 3 });

/**
 * 텍스트에서 핵심 키워드 추출 (한국어 + 영어)
 * 불용어를 제거하고 2자 이상의 의미 있는 단어만 반환
 *
 * @param {string} text - 입력 텍스트
 * @returns {string[]} 키워드 배열
 */
function extractKeywords(text) {
  if (!text) return [];

  // 한국어 불용어
  const stopwords = new Set([
    '이', '가', '은', '는', '을', '를', '의', '에', '에서', '로', '으로',
    '와', '과', '도', '만', '까지', '부터', '에게', '한테', '께',
    '이다', '있다', '없다', '하다', '되다', '이런', '그런', '저런',
    '것', '수', '때', '등', '및', '또는', '그리고', '하지만', '그러나',
    '대해', '대한', '관련', '통해', '위해', '따라', '대하여',
    '무엇', '어떻게', '왜', '어디', '누구', '언제', '어떤',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'can', 'could', 'should', 'may', 'might', 'must',
    'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
    'what', 'how', 'why', 'when', 'where', 'who', 'which',
  ]);

  // 한국어 어미/조사 패턴 (단어 끝에서 제거)
  const suffixes = [
    '에서는', '으로서', '에서', '으로', '에게', '한테',
    '부터', '까지', '에는', '와는', '과는',
    '이란', '란', '이라', '라고',
    '는', '은', '를', '을', '의', '에', '로', '와', '과',
    '가', '이', '도', '만', '요',
  ];

  // 단어 분리 (한국어 + 영어 + 숫자)
  const words = text
    .replace(/[^\w가-힣\s]/g, ' ')
    .split(/\s+/)
    .map(w => {
      let word = w.trim().toLowerCase();
      // 한국어 조사/어미 제거 (긴 것부터 매칭)
      for (const suf of suffixes) {
        if (word.length > suf.length + 1 && word.endsWith(suf)) {
          word = word.slice(0, -suf.length);
          break;
        }
      }
      return word;
    })
    .filter(w => w.length >= 2 && !stopwords.has(w));

  return [...new Set(words)];
}

/**
 * 두 키워드 배열 간 유사도 점수 계산 (Jaccard + 가중치)
 *
 * @param {string[]} keywords1 - 질문 키워드
 * @param {string[]} keywords2 - 과거 Q&A 키워드
 * @returns {number} 0~1 사이 유사도 점수
 */
function keywordSimilarity(keywords1, keywords2) {
  if (keywords1.length === 0 || keywords2.length === 0) return 0;

  const set1 = new Set(keywords1);
  const set2 = new Set(keywords2);

  // 정확 매칭 + 부분 매칭 (한국어 복합어 대응)
  let exactMatch = 0;
  let partialMatch = 0;
  for (const w1 of set1) {
    if (set2.has(w1)) {
      exactMatch++;
    } else {
      // 부분 매칭: "개인정보" ↔ "개인정보보호법" 등
      for (const w2 of set2) {
        if ((w1.length >= 2 && w2.includes(w1)) || (w2.length >= 2 && w1.includes(w2))) {
          partialMatch += 0.5;
          break;
        }
      }
    }
  }

  const totalMatch = exactMatch + partialMatch;
  if (totalMatch === 0) return 0;

  // 합집합 크기
  const union = new Set([...set1, ...set2]).size;

  // Jaccard 유사도 + 커버리지 보너스
  const jaccard = totalMatch / union;
  const coverage = totalMatch / set1.size;

  return jaccard * 0.4 + coverage * 0.6;
}

/**
 * rag_traces에서 현재 질문과 유사한 과거 Q&A를 찾아 few-shot 예시로 반환
 *
 * @param {Function} dbQuery - DB 쿼리 함수
 * @param {string} question - 현재 사용자 질문
 * @param {Object} [options]
 * @param {string} [options.category] - 문서 카테고리 필터 (선택)
 * @param {number} [options.maxExamples=2] - 반환할 최대 예시 수
 * @param {number} [options.minScore=0.15] - 최소 유사도 점수
 * @param {number} [options.candidateLimit=50] - DB에서 가져올 후보 수
 * @param {number} [options.maxDays=90] - 최근 N일 이내 데이터만 사용
 * @returns {Promise<{ examples: Array<{input, output}>, meta: Object }>}
 */
async function findRelevantFewShots(dbQuery, question, options = {}) {
  const {
    category,
    maxExamples = 2,
    minScore = 0.15,
    candidateLimit = 50,
    maxDays = 90,
  } = options;

  // 질문 키워드 추출
  const queryKeywords = extractKeywords(question);
  if (queryKeywords.length === 0) {
    return { examples: [], meta: { reason: '키워드 없음' } };
  }

  try {
    // DB에서 성공한 과거 Q&A 후보 조회
    // conclusion이 있고, status가 success인 것만
    let sql = `
      SELECT id, question, conclusion, category, created_at
      FROM rag_traces
      WHERE status = 'success'
        AND conclusion IS NOT NULL
        AND LENGTH(conclusion) > 20
        AND created_at > NOW() - INTERVAL '${maxDays} days'
    `;
    const params = [];

    // 카테고리 필터 (선택)
    if (category && category !== 'default') {
      params.push(category);
      sql += ` AND category = $${params.length}`;
    }

    sql += ` ORDER BY created_at DESC LIMIT ${candidateLimit}`;

    const result = await dbQuery(sql, params);
    if (result.rows.length === 0) {
      return { examples: [], meta: { reason: '과거 데이터 없음', candidates: 0 } };
    }

    // 각 후보에 대해 유사도 점수 계산
    const scored = result.rows.map(row => {
      const rowKeywords = extractKeywords(row.question);
      const score = keywordSimilarity(queryKeywords, rowKeywords);
      return {
        id: row.id,
        question: row.question,
        conclusion: row.conclusion,
        category: row.category,
        score,
        keywords: rowKeywords,
      };
    });

    // 점수순 정렬 + 최소 점수 필터
    const filtered = scored
      .filter(s => s.score >= minScore)
      .sort((a, b) => b.score - a.score);

    // 같은 질문 중복 제거 (질문 텍스트 기준)
    const seen = new Set();
    const deduped = [];
    for (const item of filtered) {
      const normalizedQ = item.question.replace(/\s+/g, '').toLowerCase();
      if (!seen.has(normalizedQ)) {
        seen.add(normalizedQ);
        deduped.push(item);
      }
      if (deduped.length >= maxExamples) break;
    }

    // few-shot 형태로 변환 (prompt-manager 호환)
    const examples = deduped.map(d => ({
      input: d.question,
      output: d.conclusion,
    }));

    return {
      examples,
      meta: {
        candidates: result.rows.length,
        filtered: filtered.length,
        selected: examples.length,
        scores: deduped.map(d => ({ question: d.question.substring(0, 50), score: d.score.toFixed(3) })),
        queryKeywords,
      },
    };
  } catch (err) {
    console.warn('[FewShotManager] 조회 실패:', err.message);
    return { examples: [], meta: { error: err.message } };
  }
}

/**
 * 검색 UI용: 유사한 과거 질문 목록 반환
 * (few-shot이 아닌, 사용자에게 "이런 질문도 있었어요" 형태로 표시)
 *
 * @param {Function} dbQuery - DB 쿼리 함수
 * @param {string} question - 현재 질문 (또는 검색어)
 * @param {Object} [options]
 * @param {number} [options.maxResults=5] - 최대 반환 수
 * @param {number} [options.minScore=0.1] - 최소 유사도
 * @returns {Promise<Array<{question, conclusion, score, category, createdAt}>>}
 */
async function findSimilarQuestions(dbQuery, question, options = {}) {
  const { maxResults = 5, minScore = 0.1 } = options;

  const queryKeywords = extractKeywords(question);
  if (queryKeywords.length === 0) return [];

  try {
    const result = await dbQuery(`
      SELECT id, question, conclusion, category, created_at
      FROM rag_traces
      WHERE status = 'success'
        AND conclusion IS NOT NULL
        AND LENGTH(conclusion) > 20
        AND created_at > NOW() - INTERVAL '90 days'
      ORDER BY created_at DESC
      LIMIT 100
    `);

    if (result.rows.length === 0) return [];

    const scored = result.rows.map(row => {
      const rowKeywords = extractKeywords(row.question);
      const score = keywordSimilarity(queryKeywords, rowKeywords);
      return {
        id: row.id,
        question: row.question,
        conclusion: row.conclusion,
        category: row.category,
        createdAt: row.created_at,
        score,
      };
    });

    // 중복 제거 + 정렬
    const seen = new Set();
    return scored
      .filter(s => s.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .filter(s => {
        const key = s.question.replace(/\s+/g, '').toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, maxResults)
      .map(s => ({
        id: s.id,
        question: s.question,
        conclusion: s.conclusion?.substring(0, 200),
        score: parseFloat(s.score.toFixed(3)),
        category: s.category,
        createdAt: s.createdAt,
      }));
  } catch (err) {
    console.warn('[FewShotManager] 유사 질문 검색 실패:', err.message);
    return [];
  }
}

module.exports = {
  findRelevantFewShots,
  findSimilarQuestions,
  extractKeywords,
  keywordSimilarity,
};
