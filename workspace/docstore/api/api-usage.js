// API 사용량 조회 및 키 관리 API
// GET /api/api-usage — 사용량 통계 + 키 상태
// POST /api/api-usage — 키 상태 변경 (활성/비활성, 한도 변경)
const { query } = require('./db');
const { requireAdmin } = require('./auth');

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 인증 체크
  const { error: authError } = requireAdmin(req);
  if (authError) return res.status(401).json({ error: authError });

  try {
    // ── GET: 대시보드 데이터 ──
    if (req.method === 'GET') {
      const { range = 'today' } = req.query;

      // 1) 키 상태 조회
      const keyStatus = await query('SELECT * FROM api_key_status ORDER BY provider');

      // 키 설정 여부 확인 (환경변수에 있는지)
      const keyConfig = {
        openai: !!process.env.OPENAI_API_KEY,
        anthropic: !!process.env.ANTHROPIC_API_KEY,
        gemini: !!process.env.GEMINI_API_KEY,
      };

      // 2) 사용량 기간 설정
      let dateFilter;
      if (range === 'week') {
        dateFilter = "created_at >= CURRENT_DATE - INTERVAL '7 days'";
      } else if (range === 'month') {
        dateFilter = "created_at >= CURRENT_DATE - INTERVAL '30 days'";
      } else {
        dateFilter = "created_at >= CURRENT_DATE";
      }

      // 3) 프로바이더별 사용량 집계
      const usageByProvider = await query(`
        SELECT
          provider,
          COUNT(*) AS call_count,
          COUNT(*) FILTER (WHERE status = 'success') AS success_count,
          COUNT(*) FILTER (WHERE status != 'success') AS error_count,
          COUNT(*) FILTER (WHERE status = 'credit_exhausted') AS credit_error_count,
          COALESCE(SUM(tokens_in), 0) AS total_tokens_in,
          COALESCE(SUM(tokens_out), 0) AS total_tokens_out,
          COALESCE(SUM(cost_estimate), 0) AS total_cost
        FROM api_usage
        WHERE ${dateFilter}
        GROUP BY provider
        ORDER BY provider
      `);

      // 4) 모델별 사용량 집계
      const usageByModel = await query(`
        SELECT
          provider,
          model,
          endpoint,
          COUNT(*) AS call_count,
          COALESCE(SUM(tokens_in), 0) AS total_tokens_in,
          COALESCE(SUM(tokens_out), 0) AS total_tokens_out,
          COALESCE(SUM(cost_estimate), 0) AS total_cost
        FROM api_usage
        WHERE ${dateFilter} AND status = 'success'
        GROUP BY provider, model, endpoint
        ORDER BY total_cost DESC
      `);

      // 5) 일별 추이 (최근 7일)
      const dailyTrend = await query(`
        SELECT
          DATE(created_at) AS date,
          provider,
          COUNT(*) AS call_count,
          COALESCE(SUM(cost_estimate), 0) AS total_cost
        FROM api_usage
        WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
          AND status = 'success'
        GROUP BY DATE(created_at), provider
        ORDER BY date
      `);

      // 6) 최근 에러 로그 (10건)
      const recentErrors = await query(`
        SELECT provider, model, endpoint, status, error_message, created_at
        FROM api_usage
        WHERE status != 'success'
        ORDER BY created_at DESC
        LIMIT 10
      `);

      return res.json({
        keys: keyStatus.rows.map(k => ({
          ...k,
          configured: keyConfig[k.provider] || false,
        })),
        usageByProvider: usageByProvider.rows,
        usageByModel: usageByModel.rows,
        dailyTrend: dailyTrend.rows,
        recentErrors: recentErrors.rows,
        range,
      });
    }

    // ── POST: 키 상태/한도 변경 ──
    if (req.method === 'POST') {
      const { action, provider, dailyLimit, isActive } = req.body;

      if (action === 'updateLimit' && provider) {
        await query(
          'UPDATE api_key_status SET daily_limit = $2, updated_at = NOW() WHERE provider = $1',
          [provider, parseInt(dailyLimit) || 0]
        );
        return res.json({ success: true, message: `${provider} 일일 한도가 ${dailyLimit}로 변경되었습니다.` });
      }

      if (action === 'toggleKey' && provider) {
        await query(
          'UPDATE api_key_status SET is_active = $2, last_error = NULL, updated_at = NOW() WHERE provider = $1',
          [provider, isActive !== false]
        );
        return res.json({ success: true, message: `${provider} 키가 ${isActive !== false ? '활성화' : '비활성화'}되었습니다.` });
      }

      if (action === 'testKey' && provider) {
        // 키 테스트 (간단한 API 호출)
        try {
          if (provider === 'openai' && process.env.OPENAI_API_KEY) {
            const OpenAI = require('openai');
            const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
            await openai.models.list();
          } else if (provider === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
            const Anthropic = require('@anthropic-ai/sdk').default;
            const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
            await client.messages.create({
              model: 'claude-sonnet-4-6',
              max_tokens: 10,
              messages: [{ role: 'user', content: 'test' }],
            });
          } else if (provider === 'gemini' && process.env.GEMINI_API_KEY) {
            const https = require('https');
            const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`;
            await new Promise((resolve, reject) => {
              https.get(url, { timeout: 10000 }, (r) => {
                let d = '';
                r.on('data', c => d += c);
                r.on('end', () => r.statusCode === 200 ? resolve() : reject(new Error(`HTTP ${r.statusCode}: ${d.substring(0, 200)}`)));
              }).on('error', reject);
            });
          } else {
            return res.json({ success: false, message: `${provider} API 키가 설정되지 않았습니다.` });
          }

          await query(
            'UPDATE api_key_status SET is_active = true, last_checked = NOW(), last_error = NULL, updated_at = NOW() WHERE provider = $1',
            [provider]
          );
          return res.json({ success: true, message: `${provider} 키 테스트 성공!` });
        } catch (testErr) {
          const errMsg = testErr.message || '알 수 없는 에러';
          await query(
            'UPDATE api_key_status SET last_checked = NOW(), last_error = $2, updated_at = NOW() WHERE provider = $1',
            [provider, errMsg]
          );
          // 크레딧 소진이면 비활성화
          const { isCreditError } = require('../lib/api-tracker');
          if (isCreditError(testErr)) {
            await query('UPDATE api_key_status SET is_active = false WHERE provider = $1', [provider]);
          }
          return res.json({ success: false, message: errMsg });
        }
      }

      return res.status(400).json({ error: '잘못된 요청입니다.' });
    }

    res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  } catch (err) {
    console.error('[API Usage] 에러:', err);
    res.status(500).json({ error: err.message });
  }
};
