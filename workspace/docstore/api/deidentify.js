// 비식별화 키워드 관리 API
// GET  /api/deidentify — 키워드 목록 조회
// POST /api/deidentify — 키워드 추가/삭제
const { query } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { sendError } = require('../lib/error-handler');

module.exports = async function handler(req, res) {
  if (setCors(req, res)) return;

  // 인증 체크
  const { error: authError } = requireAuth(req);
  if (authError) return res.status(401).json({ error: authError });

  try {
    // 테이블 자동 생성 (없으면)
    await query(`
      CREATE TABLE IF NOT EXISTS deidentify_words (
        id SERIAL PRIMARY KEY,
        keyword TEXT NOT NULL UNIQUE,
        replacement TEXT DEFAULT '***',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    if (req.method === 'GET') {
      const result = await query(
        'SELECT id, keyword, replacement, created_at FROM deidentify_words ORDER BY id DESC'
      );
      return res.json({ words: result.rows });
    }

    if (req.method === 'POST') {
      const { action, keyword, replacement, id } = req.body || {};

      // 키워드 추가
      if (action === 'add' && keyword) {
        const trimmed = keyword.trim();
        if (trimmed.length === 0) return res.status(400).json({ error: '키워드를 입력해주세요.' });
        if (trimmed.length > 100) return res.status(400).json({ error: '키워드는 100자 이내로 입력해주세요.' });

        const result = await query(
          `INSERT INTO deidentify_words (keyword, replacement)
           VALUES ($1, $2)
           ON CONFLICT (keyword) DO UPDATE SET replacement = $2
           RETURNING id, keyword, replacement`,
          [trimmed, (replacement || '***').trim()]
        );
        return res.json({ success: true, word: result.rows[0] });
      }

      // 키워드 삭제
      if (action === 'delete' && id) {
        await query('DELETE FROM deidentify_words WHERE id = $1', [id]);
        return res.json({ success: true });
      }

      // 일괄 추가 (여러 키워드를 한번에)
      if (action === 'bulkAdd' && Array.isArray(keyword)) {
        const rep = (replacement || '***').trim();
        let added = 0;
        for (const kw of keyword) {
          const trimmed = (kw || '').trim();
          if (trimmed.length === 0 || trimmed.length > 100) continue;
          await query(
            `INSERT INTO deidentify_words (keyword, replacement) VALUES ($1, $2) ON CONFLICT (keyword) DO NOTHING`,
            [trimmed, rep]
          );
          added++;
        }
        return res.json({ success: true, added });
      }

      return res.status(400).json({ error: '잘못된 요청입니다.' });
    }

    res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  } catch (err) {
    sendError(res, err, '[Deidentify]');
  }
};
