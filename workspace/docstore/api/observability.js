// LangFuse 관측성 상태 확인 API
// GET /api/observability → 연동 상태, 환경변수 설정 여부 반환
const { requireAuth } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { isLangfuseEnabled } = require('../lib/langfuse');

module.exports = async function handler(req, res) {
  if (setCors(req, res)) return;

  const { error: authError } = requireAuth(req);
  if (authError) return res.status(401).json({ error: authError });

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET만 허용' });
  }

  const publicKey = (process.env.LANGFUSE_PUBLIC_KEY || '').trim();
  const secretKey = (process.env.LANGFUSE_SECRET_KEY || '').trim();
  const baseUrl = (process.env.LANGFUSE_BASE_URL || '').trim() || 'https://cloud.langfuse.com';

  res.json({
    enabled: isLangfuseEnabled(),
    baseUrl: publicKey && secretKey ? baseUrl : null,
    keys: {
      public: !!publicKey,
      secret: !!secretKey,
    },
  });
};
