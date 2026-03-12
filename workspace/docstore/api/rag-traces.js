// RAG 트레이스 조회/삭제 API
// GET /api/rag-traces          — 최근 트레이스 목록 (limit, offset, status 필터)
// GET /api/rag-traces?id=N     — 특정 트레이스 상세
// DELETE /api/rag-traces?id=N  — 특정 트레이스 삭제
// DELETE /api/rag-traces?all=true — 전체 삭제
const { query } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { setCors } = require('../lib/cors');

module.exports = async (req, res) => {
  if (setCors(req, res)) return;

  const { error: authError } = requireAuth(req);
  if (authError) return res.status(401).json({ error: authError });

  const method = req.method;

  // ── GET: 목록 또는 상세 ──
  if (method === 'GET') {
    const { id, limit = 50, offset = 0, status } = req.query || {};

    // 특정 트레이스 상세
    if (id) {
      const result = await query('SELECT * FROM rag_traces WHERE id = $1', [id]);
      if (result.rows.length === 0) return res.status(404).json({ error: '트레이스를 찾을 수 없습니다.' });
      return res.json(result.rows[0]);
    }

    // 목록 조회
    let sql = `
      SELECT id, question, user_id, provider, model, category,
             sources_count, hops, tokens_in, tokens_out, cost_estimate,
             parse_format, total_duration_ms, search_duration_ms, llm_duration_ms,
             status, error_message, created_at
      FROM rag_traces
    `;
    const params = [];
    if (status) {
      sql += ' WHERE status = $1';
      params.push(status);
    }
    sql += ' ORDER BY created_at DESC';
    sql += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(Math.min(parseInt(limit, 10) || 50, 200), parseInt(offset, 10) || 0);

    const result = await query(sql, params);

    // 전체 건수
    let countSql = 'SELECT COUNT(*) FROM rag_traces';
    const countParams = [];
    if (status) {
      countSql += ' WHERE status = $1';
      countParams.push(status);
    }
    const countResult = await query(countSql, countParams);

    return res.json({
      traces: result.rows,
      total: parseInt(countResult.rows[0].count, 10),
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });
  }

  // ── DELETE: 삭제 ──
  if (method === 'DELETE') {
    const { id } = req.query || {};
    const { all } = req.body || {};

    if (all === true || all === 'true') {
      const result = await query('DELETE FROM rag_traces');
      return res.json({ deleted: result.rowCount, message: '전체 트레이스 삭제 완료' });
    }

    if (id) {
      const result = await query('DELETE FROM rag_traces WHERE id = $1', [id]);
      if (result.rowCount === 0) return res.status(404).json({ error: '트레이스를 찾을 수 없습니다.' });
      return res.json({ deleted: 1, id: parseInt(id, 10) });
    }

    return res.status(400).json({ error: 'id 또는 all 파라미터가 필요합니다.' });
  }

  return res.status(405).json({ error: 'GET, DELETE만 허용' });
};
