// Vercel 서버리스 함수 - 관리자 API
const { query } = require('./db');
const { verifyToken, extractToken } = require('./auth');

// 관리자 권한 확인 미들웨어
function requireAdmin(req) {
  const token = extractToken(req);
  const payload = verifyToken(token);
  if (!payload) return { error: '인증이 필요합니다.', status: 401 };
  if (!payload.admin) return { error: '관리자 권한이 필요합니다.', status: 403 };
  return { payload };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = requireAdmin(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const { action } = req.body || req.query || {};

  try {
    // 회원 목록 조회
    if (req.method === 'GET' || action === 'list') {
      const result = await query(
        'SELECT id, username, name, is_admin, created_at FROM public.users ORDER BY created_at DESC'
      );
      return res.json({ users: result.rows });
    }

    // 관리자 권한 토글
    if (action === 'toggleAdmin') {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: '사용자 ID가 필요합니다.' });

      // 자기 자신의 관리자 권한은 해제 불가
      if (userId === auth.payload.uid) {
        return res.status(400).json({ error: '자신의 관리자 권한은 변경할 수 없습니다.' });
      }

      const result = await query(
        'UPDATE public.users SET is_admin = NOT is_admin WHERE id = $1 RETURNING id, username, name, is_admin',
        [userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
      }
      const u = result.rows[0];
      console.log(`[Admin] 권한 변경: ${u.username} → admin=${u.is_admin} (by ${auth.payload.sub})`);
      return res.json({ user: u });
    }

    // 회원 삭제
    if (action === 'delete') {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: '사용자 ID가 필요합니다.' });

      if (userId === auth.payload.uid) {
        return res.status(400).json({ error: '자기 자신은 삭제할 수 없습니다.' });
      }

      const result = await query(
        'DELETE FROM public.users WHERE id = $1 RETURNING username, name',
        [userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
      }
      console.log(`[Admin] 회원 삭제: ${result.rows[0].username} (by ${auth.payload.sub})`);
      return res.json({ deleted: result.rows[0] });
    }

    res.status(400).json({ error: '알 수 없는 액션입니다.' });
  } catch (err) {
    console.error('[Admin] 에러:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
};
