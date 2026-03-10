// OCR 엔진 설정 API
// GET  /api/ocr-settings — 엔진 목록 + 우선순위 + 상태
// POST /api/ocr-settings — 우선순위 변경, 활성/비활성 토글, 테스트
const { query } = require('./db');
const { requireAdmin } = require('./auth');
const { getEngineList, invalidateCache, ALL_ENGINES } = require('../lib/ocr');

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 인증 체크
  const { error: authError } = requireAdmin(req);
  if (authError) return res.status(401).json({ error: authError });

  try {
    // ── GET: 엔진 목록 조회 ──
    if (req.method === 'GET') {
      const engines = await getEngineList();
      return res.json({ engines });
    }

    // ── POST: 설정 변경 ──
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'GET/POST만 허용' });
    }

    const { action } = req.body;

    // 테이블 자동 생성 (없으면)
    await ensureTable();

    // 우선순위 변경
    if (action === 'updatePriority') {
      const { order } = req.body; // ['gemini-vision', 'google-vision', ...]
      if (!Array.isArray(order)) return res.status(400).json({ error: 'order 배열이 필요합니다.' });

      for (let i = 0; i < order.length; i++) {
        await query(
          `UPDATE ocr_engine_config SET priority_order = $1, updated_at = NOW() WHERE engine_id = $2`,
          [i + 1, order[i]]
        );
      }
      invalidateCache();
      return res.json({ success: true, message: '우선순위가 변경되었습니다.' });
    }

    // 활성/비활성 토글
    if (action === 'toggleEngine') {
      const { engineId, enabled } = req.body;
      if (!engineId) return res.status(400).json({ error: 'engineId가 필요합니다.' });

      await query(
        `UPDATE ocr_engine_config SET is_enabled = $1, updated_at = NOW() WHERE engine_id = $2`,
        [!!enabled, engineId]
      );
      invalidateCache();
      return res.json({ success: true, enabled: !!enabled });
    }

    // 엔진 테스트 (간단한 텍스트 이미지로 OCR 테스트)
    if (action === 'testEngine') {
      const { engineId } = req.body;
      const engine = ALL_ENGINES[engineId];
      if (!engine) return res.status(400).json({ error: '존재하지 않는 엔진입니다.' });
      if (!engine.isAvailable()) return res.status(400).json({ error: `${engine.envKey} 환경변수가 설정되지 않았습니다.` });

      try {
        // 1x1 투명 PNG로 기본 연결 테스트
        const testBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        await engine.execute(testBase64, 'image/png', '이 이미지에 텍스트가 있으면 추출해주세요. 없으면 "텍스트 없음"이라고 답해주세요.');
        return res.json({ success: true, message: `${engine.name} 연결 성공` });
      } catch (err) {
        return res.json({ success: false, message: `${engine.name} 오류: ${err.message?.substring(0, 100)}` });
      }
    }

    return res.status(400).json({ error: '알 수 없는 action입니다.' });
  } catch (err) {
    console.error('[OCR Settings] 에러:', err);
    res.status(500).json({ error: err.message });
  }
};

// ocr_engine_config 테이블 자동 생성
async function ensureTable() {
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

    // 기본 데이터 삽입 (없는 것만)
    const defaults = [
      ['gemini-vision', 'Gemini Vision', 'gemini', true, 1],
      ['naver-clova', 'Naver CLOVA OCR', 'naver', true, 2],
      ['google-vision', 'Google Cloud Vision', 'google-vision', true, 3],
      ['claude-vision', 'Claude Vision', 'anthropic', true, 4],
      ['aws-textract', 'AWS Textract', 'aws', true, 5],
    ];

    for (const [id, name, provider, enabled, order] of defaults) {
      await query(
        `INSERT INTO ocr_engine_config (engine_id, display_name, provider, is_enabled, priority_order)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (engine_id) DO NOTHING`,
        [id, name, provider, enabled, order]
      );
    }
  } catch (err) {
    console.error('[OCR Settings] 테이블 생성 실패:', err.message);
  }
}
