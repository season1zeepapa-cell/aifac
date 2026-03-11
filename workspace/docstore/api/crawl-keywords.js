// 크롤링 키워드 CRUD + 점수 가중치 관리 API
// GET    /api/crawl-keywords          → 키워드 목록
// POST   /api/crawl-keywords          → 키워드 추가
// PUT    /api/crawl-keywords?id=N     → 키워드 수정 (가중치 등)
// DELETE /api/crawl-keywords?id=N     → 키워드 삭제
const { query } = require('../lib/db');
const { requireAuth, orgFilter } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { sendError } = require('../lib/error-handler');

module.exports = async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, PUT, DELETE, OPTIONS' })) return;

  const { user, orgId, error: authError } = requireAuth(req);
  if (authError) return res.status(401).json({ error: authError });

  try {
    if (req.method === 'GET') {
      const { clause, params } = orgFilter(orgId, 'k', 1);
      const where = clause ? `WHERE ${clause}` : '';
      const result = await query(
        `SELECT id, keyword, max_results, title_weight, content_weight, is_active, created_at, updated_at
         FROM crawl_keywords k ${where} ORDER BY created_at DESC`,
        params
      );
      return res.json({ keywords: result.rows });
    }

    if (req.method === 'POST') {
      const { keyword, maxResults, titleWeight, contentWeight } = req.body || {};
      if (!keyword || keyword.trim().length === 0) return res.status(400).json({ error: 'keyword가 필요합니다.' });
      const result = await query(
        `INSERT INTO crawl_keywords (keyword, max_results, title_weight, content_weight, org_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
          keyword.trim(),
          Math.min(parseInt(maxResults) || 20, 100),
          parseFloat(titleWeight) || 10.0,
          parseFloat(contentWeight) || 3.0,
          orgId,
        ]
      );
      return res.json({ keyword: result.rows[0] });
    }

    if (req.method === 'PUT') {
      const id = parseInt(req.query.id);
      if (!id) return res.status(400).json({ error: 'id가 필요합니다.' });
      const { keyword, maxResults, titleWeight, contentWeight, isActive } = req.body || {};
      const result = await query(
        `UPDATE crawl_keywords
         SET keyword = COALESCE($1, keyword),
             max_results = COALESCE($2, max_results),
             title_weight = COALESCE($3, title_weight),
             content_weight = COALESCE($4, content_weight),
             is_active = COALESCE($5, is_active),
             updated_at = NOW()
         WHERE id = $6 RETURNING *`,
        [
          keyword || null,
          maxResults ? Math.min(parseInt(maxResults), 100) : null,
          titleWeight ? parseFloat(titleWeight) : null,
          contentWeight ? parseFloat(contentWeight) : null,
          isActive !== undefined ? isActive : null,
          id,
        ]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: '키워드를 찾을 수 없습니다.' });
      return res.json({ keyword: result.rows[0] });
    }

    if (req.method === 'DELETE') {
      const id = parseInt(req.query.id);
      if (!id) return res.status(400).json({ error: 'id가 필요합니다.' });
      await query('DELETE FROM crawl_keywords WHERE id = $1', [id]);
      return res.json({ success: true });
    }

    return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  } catch (err) {
    sendError(res, err, '[CrawlKeywords]');
  }
};
