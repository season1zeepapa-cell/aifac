// Vercel 서버리스 함수 - 문제별 메모 API
const { query } = require('./db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query?.action || req.body?.action;

  try {
    // ── 메모 목록 조회 ──
    if (req.method === 'GET' && action === 'list') {
      const { question_id } = req.query;
      if (!question_id) return res.status(400).json({ error: 'question_id가 필요합니다.' });

      const result = await query(
        `SELECT id, question_id, content, created_at, updated_at
         FROM question_memos
         WHERE question_id = $1
         ORDER BY created_at DESC`,
        [question_id]
      );
      return res.json({ memos: result.rows });
    }

    // ── 여러 문제의 메모 개수 일괄 조회 ──
    if (req.method === 'GET' && action === 'counts') {
      const { question_ids } = req.query;
      if (!question_ids) return res.json({ counts: {} });

      const ids = question_ids.split(',').map(Number).filter(n => !isNaN(n));
      if (ids.length === 0) return res.json({ counts: {} });

      const result = await query(
        `SELECT question_id, COUNT(*)::int as count
         FROM question_memos
         WHERE question_id = ANY($1)
         GROUP BY question_id`,
        [ids]
      );
      const counts = {};
      result.rows.forEach(r => { counts[r.question_id] = r.count; });
      return res.json({ counts });
    }

    // ── 메모 저장 ──
    if (req.method === 'POST' && action === 'save') {
      const { question_id, content } = req.body;
      if (!question_id || !content?.trim()) {
        return res.status(400).json({ error: 'question_id와 content는 필수입니다.' });
      }

      const result = await query(
        `INSERT INTO question_memos (question_id, content)
         VALUES ($1, $2) RETURNING id, created_at`,
        [question_id, content.trim()]
      );
      return res.json({ id: result.rows[0].id, created_at: result.rows[0].created_at, message: '메모가 저장되었습니다.' });
    }

    // ── 메모 수정 ──
    if (req.method === 'POST' && action === 'update') {
      const { id, content } = req.body;
      if (!id || !content?.trim()) {
        return res.status(400).json({ error: 'id와 content는 필수입니다.' });
      }

      const result = await query(
        `UPDATE question_memos SET content = $1, updated_at = NOW() WHERE id = $2 RETURNING id, updated_at`,
        [content.trim(), id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: '메모를 찾을 수 없습니다.' });
      return res.json({ updated_at: result.rows[0].updated_at, message: '메모가 수정되었습니다.' });
    }

    // ── 메모 삭제 ──
    if (req.method === 'POST' && action === 'delete') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: '메모 ID가 필요합니다.' });

      const result = await query('DELETE FROM question_memos WHERE id = $1 RETURNING id', [id]);
      if (result.rows.length === 0) return res.status(404).json({ error: '메모를 찾을 수 없습니다.' });
      return res.json({ message: '메모가 삭제되었습니다.' });
    }

    res.status(400).json({ error: '알 수 없는 액션입니다.' });
  } catch (err) {
    console.error('[Memos] 에러:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
};
