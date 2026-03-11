// 조직(Organization) 관리 API — 슈퍼 어드민 전용
// GET    /api/organizations           — 조직 목록 조회
// POST   /api/organizations           — 조직 생성/수정/삭제
const { query } = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { sendError } = require('../lib/error-handler');

module.exports = async (req, res) => {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return;

  // 슈퍼 어드민만 접근 가능
  const { user, error: authError } = requireAdmin(req);
  if (authError) return res.status(401).json({ error: authError });

  try {
    // GET: 조직 목록 + 통계
    if (req.method === 'GET') {
      const result = await query(
        `SELECT o.id, o.name, o.slug, o.created_at,
                COUNT(DISTINCT u.id) AS user_count,
                COUNT(DISTINCT d.id) AS document_count
         FROM organizations o
         LEFT JOIN public.users u ON u.org_id = o.id
         LEFT JOIN documents d ON d.org_id = o.id AND d.deleted_at IS NULL
         GROUP BY o.id
         ORDER BY o.id`
      );
      return res.json({ organizations: result.rows });
    }

    // POST: 생성/수정/삭제
    if (req.method === 'POST') {
      const { action, id, name, slug } = req.body || {};

      // 조직 생성
      if (action === 'create' && name) {
        const orgSlug = (slug || name).trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9가-힣-]/g, '');
        if (!orgSlug) return res.status(400).json({ error: '유효한 슬러그를 생성할 수 없습니다.' });

        const result = await query(
          `INSERT INTO organizations (name, slug)
           VALUES ($1, $2)
           ON CONFLICT (slug) DO NOTHING
           RETURNING id, name, slug`,
          [name.trim(), orgSlug]
        );
        if (result.rows.length === 0) {
          return res.status(409).json({ error: `이미 존재하는 슬러그입니다: ${orgSlug}` });
        }
        return res.json({ success: true, organization: result.rows[0] });
      }

      // 조직 수정
      if (action === 'update' && id && name) {
        const result = await query(
          'UPDATE organizations SET name = $1 WHERE id = $2 RETURNING id, name, slug',
          [name.trim(), id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: '조직을 찾을 수 없습니다.' });
        return res.json({ success: true, organization: result.rows[0] });
      }

      // 조직 삭제 (소속 사용자/문서가 없는 경우만)
      if (action === 'delete' && id) {
        const check = await query(
          `SELECT
            (SELECT COUNT(*) FROM public.users WHERE org_id = $1) AS user_count,
            (SELECT COUNT(*) FROM documents WHERE org_id = $1) AS doc_count`,
          [id]
        );
        const { user_count, doc_count } = check.rows[0];
        if (parseInt(user_count) > 0 || parseInt(doc_count) > 0) {
          return res.status(400).json({
            error: `소속 사용자(${user_count}명) 또는 문서(${doc_count}건)가 있어 삭제할 수 없습니다. 먼저 이동 또는 삭제해주세요.`,
          });
        }
        await query('DELETE FROM organizations WHERE id = $1', [id]);
        return res.json({ success: true });
      }

      return res.status(400).json({ error: '잘못된 요청입니다.' });
    }

    return res.status(405).json({ error: 'GET 또는 POST만 허용' });
  } catch (err) {
    sendError(res, err, '[Organizations]');
  }
};
