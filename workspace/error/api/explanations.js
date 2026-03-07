// Vercel 서버리스 함수 - AI 해설 관리 API
const { query } = require('./db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query?.action || req.body?.action;

  try {
    // ── 해설 목록 조회 (question_id 기준) ──
    if (req.method === 'GET' && action === 'list') {
      const { question_id } = req.query;
      if (!question_id) return res.status(400).json({ error: 'question_id가 필요합니다.' });

      const result = await query(
        `SELECT id, question_id, provider, model, content, extra_prompt, created_at
         FROM question_explanations
         WHERE question_id = $1
         ORDER BY created_at DESC`,
        [question_id]
      );
      return res.json({ explanations: result.rows });
    }

    // ── 여러 문제의 해설 개수 일괄 조회 ──
    if (req.method === 'GET' && action === 'counts') {
      const { question_ids } = req.query;
      if (!question_ids) return res.json({ counts: {} });

      const ids = question_ids.split(',').map(Number).filter(n => !isNaN(n));
      if (ids.length === 0) return res.json({ counts: {} });

      const result = await query(
        `SELECT question_id, COUNT(*)::int as count
         FROM question_explanations
         WHERE question_id = ANY($1)
         GROUP BY question_id`,
        [ids]
      );
      const counts = {};
      result.rows.forEach(r => { counts[r.question_id] = r.count; });
      return res.json({ counts });
    }

    // ── 해설 저장 ──
    if (req.method === 'POST' && action === 'save') {
      const { question_id, provider, model, content, extra_prompt } = req.body;
      if (!question_id || !provider || !model || !content) {
        return res.status(400).json({ error: 'question_id, provider, model, content는 필수입니다.' });
      }

      const result = await query(
        `INSERT INTO question_explanations (question_id, provider, model, content, extra_prompt)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
        [question_id, provider, model, content, extra_prompt || null]
      );
      return res.json({ id: result.rows[0].id, created_at: result.rows[0].created_at, message: '해설이 저장되었습니다.' });
    }

    // ── 해설 삭제 ──
    if (req.method === 'POST' && action === 'delete') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: '해설 ID가 필요합니다.' });

      const result = await query('DELETE FROM question_explanations WHERE id = $1 RETURNING id', [id]);
      if (result.rows.length === 0) return res.status(404).json({ error: '해설을 찾을 수 없습니다.' });
      return res.json({ message: '해설이 삭제되었습니다.' });
    }

    res.status(400).json({ error: '알 수 없는 액션입니다.' });
  } catch (err) {
    console.error('[Explanations] 에러:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
};
