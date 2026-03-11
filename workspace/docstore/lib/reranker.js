// Cohere Rerank API 연동 모듈 (선택적)
//
// COHERE_API_KEY 환경변수가 설정되어 있을 때만 동작
// 키가 없으면 null을 반환 → 호출측에서 기존 순서 유지
//
// Cohere Rerank v3.5:
//   - 다국어 지원 (한국어 포함)
//   - 무료 플랜: 월 1,000회
//   - 응답 시간: ~200ms (20개 문서 기준)
//   - 문서당 최대 4,096 토큰
const https = require('https');

const RERANK_MODEL = 'rerank-v3.5';
const RERANK_URL = 'https://api.cohere.com/v2/rerank';

/**
 * Cohere Rerank API로 검색 결과를 질문 관련도 순으로 재정렬
 *
 * @param {string} query - 사용자 질문
 * @param {Array<{chunk_text: string}>} documents - 검색 결과 배열 (chunk_text 필드 필요)
 * @param {Object} options
 * @param {number} options.topN - 반환할 상위 문서 수 (기본 10)
 * @returns {Promise<Array|null>} 재정렬된 결과 또는 null (키 미설정 시)
 *   각 항목: { index (원본 배열 인덱스), relevance_score (0~1) }
 */
async function rerank(query, documents, options = {}) {
  const apiKey = (process.env.COHERE_API_KEY || '').trim();
  if (!apiKey) return null; // 키 없으면 스킵

  if (!documents || documents.length === 0) return null;

  const { topN = 10 } = options;

  // 문서 텍스트 추출 (chunk_text 필드 사용, 4096자 제한)
  const docTexts = documents.map(d => {
    const text = (typeof d === 'string' ? d : d.chunk_text) || '';
    return text.substring(0, 4096);
  });

  const body = JSON.stringify({
    model: RERANK_MODEL,
    query: query,
    documents: docTexts,
    top_n: Math.min(topN, documents.length),
  });

  return new Promise((resolve, reject) => {
    const req = https.request(RERANK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      timeout: 10000, // 10초 타임아웃
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (res.statusCode !== 200) {
            console.warn('[Reranker] Cohere API 오류:', data.message || res.statusCode);
            resolve(null); // 오류 시 null 반환 (fallback)
            return;
          }
          // data.results: [{ index, relevance_score }]
          resolve(data.results || []);
        } catch (err) {
          console.warn('[Reranker] 응답 파싱 실패:', err.message);
          resolve(null);
        }
      });
    });

    req.on('error', (err) => {
      console.warn('[Reranker] 네트워크 오류:', err.message);
      resolve(null); // 네트워크 오류도 graceful fallback
    });
    req.on('timeout', () => {
      req.destroy();
      console.warn('[Reranker] 타임아웃');
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}

/**
 * 검색 결과 배열에 Cohere rerank 적용
 * API 키가 없거나 오류 시 원본 배열을 그대로 반환
 *
 * @param {string} query - 사용자 질문
 * @param {Array} results - 검색 결과 배열 (chunk_text 필드 필요)
 * @param {number} topN - 상위 N개 반환
 * @returns {Promise<Array>} 재정렬된 결과 (relevance_score 필드 추가)
 */
async function rerankResults(query, results, topN = 10) {
  if (!results || results.length === 0) return results;

  const ranked = await rerank(query, results, { topN });

  if (!ranked) {
    // Cohere 미사용 → 원본 순서 유지
    return results.slice(0, topN);
  }

  // rerank 결과를 원본 배열에 매핑
  return ranked.map(r => ({
    ...results[r.index],
    relevance_score: r.relevance_score,
  }));
}

module.exports = { rerank, rerankResults };
