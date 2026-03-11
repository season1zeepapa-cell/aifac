// DocStore 로그인 API
// workspace/error의 users 테이블을 공유하며, 관리자(is_admin)만 로그인 허용
const { query } = require('../lib/db');
const { verifyPassword, signToken, TOKEN_SECRET } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { checkRateLimit } = require('../lib/rate-limit');

module.exports = async (req, res) => {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  }

  // 브루트포스 방어: IP 기준 1분 5회 제한
  if (await checkRateLimit(req, res, 'login')) return;

  const { id, password } = req.body || {};

  if (!id || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요.' });
  }

  try {
    // public.users 테이블에서 사용자 조회 (org_id 포함 — 멀티테넌시)
    const result = await query(
      'SELECT u.id, u.username, u.password_hash, u.name, u.is_admin, u.org_id, o.name AS org_name, o.slug AS org_slug FROM public.users u LEFT JOIN organizations o ON u.org_id = o.id WHERE u.username = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }

    const user = result.rows[0];

    // 비밀번호 검증 (scrypt 비동기)
    if (!await verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }

    // JWT 토큰 발급 (7일 유효) — orgId 포함
    const token = signToken(
      {
        sub: user.username,
        uid: user.id,
        name: user.name,
        admin: !!user.is_admin,
        orgId: user.org_id || null,
      },
      TOKEN_SECRET,
      '7d'
    );

    console.log(`[DocStore Auth] 로그인 성공: ${user.username} (${user.name}) [org: ${user.org_name || '슈퍼관리자'}]`);
    res.json({
      token,
      name: user.name,
      admin: !!user.is_admin,
      orgId: user.org_id || null,
      orgName: user.org_name || null,
    });
  } catch (err) {
    console.error('[DocStore Auth] 로그인 에러:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
};
