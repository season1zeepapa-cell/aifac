// 크롤링 소스 CRUD + 제외 패턴 관리 API
// GET  /api/crawl-sources              → 소스 목록
// POST /api/crawl-sources              → 소스 추가
// PUT  /api/crawl-sources?id=N         → 소스 수정
// DELETE /api/crawl-sources?id=N       → 소스 삭제
// GET  /api/crawl-sources?exclusions=1 → 제외 패턴 목록
// POST /api/crawl-sources?exclusion=1  → 제외 패턴 추가
// PUT  /api/crawl-sources?exclusionId=N → 제외 패턴 수정
// DELETE /api/crawl-sources?exclusionId=N → 제외 패턴 삭제
const { query } = require('../lib/db');
const { requireAuth, orgFilter } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { sendError } = require('../lib/error-handler');

module.exports = async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, PUT, DELETE, OPTIONS' })) return;

  const { user, orgId, error: authError } = requireAuth(req);
  if (authError) return res.status(401).json({ error: authError });

  try {
    // ── 제외 패턴 관리 ──
    if (req.query.exclusions !== undefined || req.query.exclusion !== undefined || req.query.exclusionId) {
      if (req.method === 'GET') {
        const { clause, params } = orgFilter(orgId, 'e', 1);
        const where = clause ? `WHERE ${clause}` : '';
        const result = await query(
          `SELECT id, url_pattern, reason, created_at FROM crawl_exclusions e ${where} ORDER BY created_at DESC`,
          params
        );
        return res.json({ exclusions: result.rows });
      }
      if (req.method === 'POST') {
        const { urlPattern, reason } = req.body || {};
        if (!urlPattern) return res.status(400).json({ error: 'urlPattern이 필요합니다.' });
        const result = await query(
          `INSERT INTO crawl_exclusions (url_pattern, reason, org_id) VALUES ($1, $2, $3) RETURNING *`,
          [urlPattern, reason || '', orgId]
        );
        return res.json({ exclusion: result.rows[0] });
      }
      if (req.method === 'PUT') {
        const id = parseInt(req.query.exclusionId);
        if (!id) return res.status(400).json({ error: 'exclusionId가 필요합니다.' });
        const { urlPattern, reason } = req.body || {};
        const result = await query(
          `UPDATE crawl_exclusions
           SET url_pattern = COALESCE($1, url_pattern),
               reason = COALESCE($2, reason)
           WHERE id = $3 RETURNING *`,
          [urlPattern, reason, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: '제외 패턴을 찾을 수 없습니다.' });
        return res.json({ exclusion: result.rows[0] });
      }
      if (req.method === 'DELETE') {
        const id = parseInt(req.query.exclusionId);
        if (!id) return res.status(400).json({ error: 'exclusionId가 필요합니다.' });
        await query('DELETE FROM crawl_exclusions WHERE id = $1', [id]);
        return res.json({ success: true });
      }
    }

    // ── 크롤링 소스 CRUD ──
    if (req.method === 'GET') {
      const { clause, params } = orgFilter(orgId, 's', 1);
      const where = clause ? `WHERE ${clause}` : '';
      const result = await query(
        `SELECT id, name, base_url, board_url, site_type, css_selectors, is_active, COALESCE(importance, 1.0) as importance, created_at, updated_at
         FROM crawl_sources s ${where} ORDER BY created_at DESC`,
        params
      );
      return res.json({ sources: result.rows });
    }

    if (req.method === 'POST') {
      const { name, baseUrl, boardUrl, siteType, cssSelectors } = req.body || {};
      if (!name || !boardUrl) return res.status(400).json({ error: 'name과 boardUrl이 필요합니다.' });
      const result = await query(
        `INSERT INTO crawl_sources (name, base_url, board_url, site_type, css_selectors, org_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [name, baseUrl || '', boardUrl, siteType || 'board', JSON.stringify(cssSelectors || {}), orgId]
      );
      return res.json({ source: result.rows[0] });
    }

    if (req.method === 'PUT') {
      const id = parseInt(req.query.id);
      if (!id) return res.status(400).json({ error: 'id가 필요합니다.' });
      const { name, baseUrl, boardUrl, siteType, cssSelectors, isActive, importance } = req.body || {};
      const result = await query(
        `UPDATE crawl_sources
         SET name = COALESCE($1, name),
             base_url = COALESCE($2, base_url),
             board_url = COALESCE($3, board_url),
             site_type = COALESCE($4, site_type),
             css_selectors = COALESCE($5, css_selectors),
             is_active = COALESCE($6, is_active),
             importance = COALESCE($7, importance),
             updated_at = NOW()
         WHERE id = $8 RETURNING *`,
        [name, baseUrl, boardUrl, siteType, cssSelectors ? JSON.stringify(cssSelectors) : null, isActive, importance != null ? parseFloat(importance) : null, id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: '소스를 찾을 수 없습니다.' });
      return res.json({ source: result.rows[0] });
    }

    if (req.method === 'DELETE') {
      const id = parseInt(req.query.id);
      if (!id) return res.status(400).json({ error: 'id가 필요합니다.' });
      await query('DELETE FROM crawl_sources WHERE id = $1', [id]);
      return res.json({ success: true });
    }

    return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  } catch (err) {
    sendError(res, err, '[CrawlSources]');
  }
};
