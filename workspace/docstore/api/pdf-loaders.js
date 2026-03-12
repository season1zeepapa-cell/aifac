// PDF 로더 목록 API
// GET /api/pdf-loaders — 사용 가능한 PDF 로더 목록 + 상태 반환
//
// OCR 엔진 목록 API(api/api-usage.js)와 동일 패턴
const { getLoaderList } = require('../lib/pdf-loaders');
const { requireAuth } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { sendError } = require('../lib/error-handler');

module.exports = async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET만 허용됩니다.' });
  }

  // 인증 체크
  const { error: authError } = requireAuth(req);
  if (authError) return res.status(401).json({ error: authError });

  try {
    const loaders = getLoaderList();

    res.json({
      success: true,
      loaders,
      defaultLoader: 'pdf-parse',
    });
  } catch (err) {
    sendError(res, err, '[PDF 로더]');
  }
};
