// Few-shot 자동 매칭 API
// GET /api/few-shot?q=질문&category=법령    — 유사한 과거 Q&A 검색
// GET /api/few-shot?mode=examples&q=질문    — RAG용 few-shot 예시 반환
const { query } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { sendError } = require('../lib/error-handler');
const { findRelevantFewShots, findSimilarQuestions } = require('../lib/few-shot-manager');

module.exports = async (req, res) => {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return;

  const { error: authError } = requireAuth(req);
  if (authError) return res.status(401).json({ error: authError });

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET만 허용' });
  }

  try {
    const { q, category, mode, max } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: '질문(q)이 필요합니다 (2자 이상)' });
    }

    const question = q.trim();
    const maxResults = Math.min(parseInt(max, 10) || 5, 10);

    // mode=examples: RAG 파이프라인용 few-shot 예시
    if (mode === 'examples') {
      const result = await findRelevantFewShots(query, question, {
        category: category || undefined,
        maxExamples: Math.min(maxResults, 3),
      });

      return res.json({
        examples: result.examples,
        meta: result.meta,
      });
    }

    // 기본: 유사 질문 목록 (UI 표시용)
    const similar = await findSimilarQuestions(query, question, {
      maxResults,
    });

    return res.json({
      similar,
      count: similar.length,
    });
  } catch (err) {
    sendError(res, err, '[FewShot]');
  }
};
