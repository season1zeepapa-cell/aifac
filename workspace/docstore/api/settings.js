// 앱 설정 관리 API (카테고리, 임베딩 모델 등)
// GET  /api/settings?key=categories       → 설정값 조회
// GET  /api/settings?key=embeddingModel   → 임베딩 모델 설정 + 사용 가능 목록
// POST /api/settings { key, value }       → 설정값 저장
const { query } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { getAvailableModels, resetModelCache } = require('../lib/embeddings');

// 기본 카테고리 (테이블/데이터가 없을 때 사용)
const DEFAULT_CATEGORIES = [
  { value: '법령', label: '법령' },
  { value: '기출', label: '기출' },
  { value: '규정', label: '규정' },
  { value: '크롤링', label: '크롤링' },
  { value: '기타', label: '기타' },
];

// 테이블 자동 생성 (없으면)
async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

module.exports = async function handler(req, res) {
  if (setCors(req, res)) return;

  const { error: authError } = requireAuth(req);
  if (authError) return res.status(401).json({ error: authError });

  try {
    await ensureTable();

    // GET: 설정값 조회
    if (req.method === 'GET') {
      const key = req.query.key;

      if (!key) {
        return res.status(400).json({ error: 'key 파라미터가 필요합니다.' });
      }

      const result = await query(
        'SELECT value FROM app_settings WHERE key = $1', [key]
      );

      if (result.rows.length === 0) {
        // 기본값 반환
        if (key === 'categories') {
          return res.json({ key, value: DEFAULT_CATEGORIES });
        }
        if (key === 'embeddingModel') {
          return res.json({
            key,
            value: 'openai',
            availableModels: getAvailableModels(),
          });
        }
        return res.json({ key, value: null });
      }

      // 임베딩 모델 조회 시 사용 가능한 모델 목록도 함께 반환
      if (key === 'embeddingModel') {
        return res.json({
          key,
          value: result.rows[0].value,
          availableModels: getAvailableModels(),
        });
      }

      return res.json({ key, value: result.rows[0].value });
    }

    // POST: 설정값 저장
    if (req.method === 'POST') {
      const { key, value } = req.body;

      if (!key) {
        return res.status(400).json({ error: 'key가 필요합니다.' });
      }

      if (value === undefined || value === null) {
        return res.status(400).json({ error: 'value가 필요합니다.' });
      }

      // 임베딩 모델 변경 시 캐시 초기화
      if (key === 'embeddingModel') {
        const validIds = ['openai', 'upstage', 'cohere'];
        if (!validIds.includes(value)) {
          return res.status(400).json({ error: `유효하지 않은 모델입니다. 사용 가능: ${validIds.join(', ')}` });
        }
        resetModelCache();
      }

      // 카테고리 유효성 검증
      if (key === 'categories') {
        if (!Array.isArray(value)) {
          return res.status(400).json({ error: '카테고리는 배열이어야 합니다.' });
        }
        for (const cat of value) {
          if (!cat.value || !cat.label) {
            return res.status(400).json({ error: '각 카테고리에는 value와 label이 필요합니다.' });
          }
        }
      }

      // UPSERT
      await query(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
      `, [key, JSON.stringify(value)]);

      return res.json({ success: true, key, value });
    }

    return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  } catch (err) {
    console.error('[Settings] 에러:', err);
    return res.status(500).json({ error: err.message });
  }
};
