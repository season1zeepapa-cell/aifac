// 법제처 국가법령정보 API 프록시
// - action: 'search' → 법령명 검색
// - action: 'detail' → 조문 상세 조회
const { searchLaw, getLawDetail } = require('../lib/law-fetcher');
const { requireAdmin } = require('../lib/auth');
const { setCors } = require('../lib/cors');

module.exports = async (req, res) => {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return;

  // 인증 체크
  const { error: authError } = requireAdmin(req);
  if (authError) return res.status(401).json({ error: authError });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  const OC = (process.env.LAW_API_OC || '').trim();
  if (!OC) return res.status(500).json({ error: 'LAW_API_OC가 설정되지 않았습니다.' });

  const { action, query, lawId } = req.body;

  try {
    if (action === 'search') {
      if (!query) return res.status(400).json({ error: '검색어(query)가 필요합니다.' });
      const result = await searchLaw(query, OC);
      return res.json(result);
    }

    if (action === 'detail') {
      if (!lawId) return res.status(400).json({ error: '법령ID(lawId)가 필요합니다.' });
      const result = await getLawDetail(lawId, OC);
      return res.json(result);
    }

    return res.status(400).json({ error: 'action은 search 또는 detail이어야 합니다.' });
  } catch (err) {
    const { sendError } = require('../lib/error-handler');
    sendError(res, err, '[Law]');
  }
};
