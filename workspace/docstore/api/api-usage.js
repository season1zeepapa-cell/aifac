// API 사용량 조회 및 키 관리 + OCR 설정 API
// GET /api/api-usage — 사용량 통계 + 키 상태
// GET /api/api-usage?type=ocr — OCR 엔진 설정 조회
// POST /api/api-usage — 키/OCR 설정 변경
const https = require('https');
const { query } = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { sendError } = require('../lib/error-handler');

module.exports = async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return;

  // 인증 체크
  const { error: authError } = requireAdmin(req);
  if (authError) return res.status(401).json({ error: authError });

  try {
    // ── GET: 대시보드 데이터 ──
    if (req.method === 'GET') {
      // OCR 엔진 설정 조회
      if (req.query.type === 'ocr') {
        const { getEngineList } = require('../lib/ocr');
        const engines = await getEngineList();
        return res.json({ engines });
      }

      // LLM 프로바이더 목록 조회
      if (req.query.type === 'llm') {
        const { getAvailableProviders } = require('../lib/gemini');
        return res.json({ providers: getAvailableProviders() });
      }

      const { range = 'today' } = req.query;

      // 1) 키 상태 조회 (upstage 행 자동 생성)
      await query(`
        INSERT INTO api_key_status (provider, daily_limit) VALUES ('upstage', 100)
        ON CONFLICT (provider) DO NOTHING
      `);
      const keyStatus = await query('SELECT * FROM api_key_status ORDER BY provider');

      // 키 설정 여부 확인 (환경변수에 있는지)
      const keyConfig = {
        openai: !!process.env.OPENAI_API_KEY,
        anthropic: !!process.env.ANTHROPIC_API_KEY,
        gemini: !!process.env.GEMINI_API_KEY,
        cohere: !!process.env.COHERE_API_KEY,
        upstage: !!process.env.UPSTAGE_API_KEY,
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

      // 7) 전일 비교 데이터 (오늘 vs 어제)
      const prevComparison = await query(`
        SELECT
          'today' AS period,
          COUNT(*) AS call_count,
          COALESCE(SUM(cost_estimate), 0) AS total_cost,
          COUNT(*) FILTER (WHERE status != 'success') AS error_count
        FROM api_usage WHERE created_at >= CURRENT_DATE
        UNION ALL
        SELECT
          'yesterday' AS period,
          COUNT(*) AS call_count,
          COALESCE(SUM(cost_estimate), 0) AS total_cost,
          COUNT(*) FILTER (WHERE status != 'success') AS error_count
        FROM api_usage WHERE created_at >= CURRENT_DATE - INTERVAL '1 day' AND created_at < CURRENT_DATE
      `);

      // 8) OCR 엔진별 사용 통계 (최근 7일)
      const ocrStats = await query(`
        SELECT
          model AS engine,
          COUNT(*) AS call_count,
          COUNT(*) FILTER (WHERE status = 'success') AS success_count,
          COUNT(*) FILTER (WHERE status != 'success') AS error_count
        FROM api_usage
        WHERE endpoint = 'ocr' AND created_at >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY model
        ORDER BY call_count DESC
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
        prevComparison: prevComparison.rows,
        ocrStats: ocrStats.rows,
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
            const url = 'https://generativelanguage.googleapis.com/v1beta/models';
            await new Promise((resolve, reject) => {
              https.get(url, { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY }, timeout: 10000 }, (r) => {
                let d = '';
                r.on('data', c => d += c);
                r.on('end', () => r.statusCode === 200 ? resolve() : reject(new Error(`HTTP ${r.statusCode}: ${d.substring(0, 200)}`)));
              }).on('error', reject);
            });
          } else if (provider === 'upstage' && process.env.UPSTAGE_API_KEY) {
            // Upstage OCR API 간단 테스트
            await new Promise((resolve, reject) => {
              const testReq = https.request({
                hostname: 'api.upstage.ai',
                path: '/v1/document-digitization',
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${process.env.UPSTAGE_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                timeout: 10000,
              }, (r) => {
                let d = '';
                r.on('data', c => d += c);
                r.on('end', () => {
                  // 400 = 파일 없음 (키는 유효), 401 = 키 무효
                  if (r.statusCode === 401 || r.statusCode === 403) {
                    reject(new Error('API 키가 유효하지 않습니다.'));
                  } else {
                    resolve(); // 400도 키 자체는 유효
                  }
                });
              });
              testReq.on('error', reject);
              testReq.on('timeout', () => { testReq.destroy(); reject(new Error('시간 초과')); });
              testReq.write('{}');
              testReq.end();
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

      // ── OCR 설정 액션 ──

      // OCR 테이블 자동 생성
      if (['ocrUpdatePriority', 'ocrToggleEngine', 'ocrTestEngine'].includes(action)) {
        await ensureOcrTable();
      }

      // OCR 우선순위 변경
      if (action === 'ocrUpdatePriority') {
        const { order } = req.body;
        if (!Array.isArray(order)) return res.status(400).json({ error: 'order 배열이 필요합니다.' });
        for (let i = 0; i < order.length; i++) {
          await query(
            'UPDATE ocr_engine_config SET priority_order = $1, updated_at = NOW() WHERE engine_id = $2',
            [i + 1, order[i]]
          );
        }
        const { invalidateCache } = require('../lib/ocr');
        invalidateCache();
        return res.json({ success: true, message: '우선순위가 변경되었습니다.' });
      }

      // OCR 엔진 활성/비활성
      if (action === 'ocrToggleEngine') {
        const { engineId, enabled } = req.body;
        if (!engineId) return res.status(400).json({ error: 'engineId가 필요합니다.' });
        await query(
          'UPDATE ocr_engine_config SET is_enabled = $1, updated_at = NOW() WHERE engine_id = $2',
          [!!enabled, engineId]
        );
        const { invalidateCache } = require('../lib/ocr');
        invalidateCache();
        return res.json({ success: true, enabled: !!enabled });
      }

      // OCR 엔진 테스트
      if (action === 'ocrTestEngine') {
        const { engineId } = req.body;
        const { ALL_ENGINES } = require('../lib/ocr');
        const engine = ALL_ENGINES[engineId];
        if (!engine) return res.status(400).json({ error: '존재하지 않는 엔진입니다.' });
        if (!engine.isAvailable()) return res.json({ success: false, message: `${engine.envKey} 환경변수가 설정되지 않았습니다.` });
        try {
          // 100x30 흰색 PNG (작은 이미지는 OpenAI 등에서 거부)
          const testBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAGQAAAAeCAIAAABVOSykAAAAWUlEQVR4nO3QQQ0AIAzAwPk3DRbWFyG5U9B0DmvzOuAnZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgVmBWYFZgUXwywG5umITk4AAAAASUVORK5CYII=';
          await engine.execute(testBase64, 'image/png', '이 이미지에 텍스트가 있으면 추출해주세요.');
          return res.json({ success: true, message: `${engine.name} 연결 성공!` });
        } catch (err) {
          // 빈 이미지라 텍스트 없음/형식 에러/지원 안 됨 = API 연결 자체는 성공한 것
          const msg = (err.message || '').toLowerCase();
          const apiConnected = msg.includes('텍스트가 추출되지 않았') ||
            msg.includes('빈 결과') ||
            msg.includes('file type') ||
            msg.includes('unable to recognize') ||
            msg.includes('no text') ||
            msg.includes('empty') ||
            msg.includes('unsupported image') ||
            msg.includes('could not process') ||
            msg.includes('invalid image');
          if (apiConnected) {
            return res.json({ success: true, message: `${engine.name} 연결 성공! (테스트 이미지에 텍스트 없음)` });
          }
          // 크레딧 부족 등 실제 에러
          return res.json({ success: false, message: `${engine.name}: ${(err.message || '').substring(0, 150)}` });
        }
      }

      return res.status(400).json({ error: '잘못된 요청입니다.' });
    }

    res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  } catch (err) {
    sendError(res, err, '[API Usage]');
  }
};

// OCR 설정 테이블 자동 생성
async function ensureOcrTable() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS ocr_engine_config (
        id SERIAL PRIMARY KEY,
        engine_id VARCHAR(50) NOT NULL UNIQUE,
        display_name VARCHAR(100) NOT NULL,
        provider VARCHAR(50) NOT NULL,
        is_enabled BOOLEAN DEFAULT true,
        priority_order INT DEFAULT 99,
        config JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    const defaults = [
      ['upstage-ocr', 'Upstage OCR', 'upstage', true, 1],
      ['gemini-vision', 'Gemini Vision', 'gemini', true, 2],
      ['claude-vision', 'Claude Vision', 'anthropic', true, 3],
      ['openai-vision', 'OpenAI Vision', 'openai', true, 4],
      ['naver-clova', '네이버 CLOVA OCR', 'naver', true, 5],
      ['ocr-space', 'OCR.space', 'ocr-space', true, 6],
      ['aws-textract', 'AWS Textract', 'aws', true, 7],
    ];
    for (const [id, name, provider, enabled, order] of defaults) {
      await query(
        `INSERT INTO ocr_engine_config (engine_id, display_name, provider, is_enabled, priority_order)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (engine_id) DO NOTHING`,
        [id, name, provider, enabled, order]
      );
    }
  } catch (err) {
    console.error('[OCR] 테이블 생성 실패:', err.message);
  }
}
