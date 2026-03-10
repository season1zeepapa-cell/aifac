// DocStore 로그인 API
// workspace/error의 users 테이블을 공유하며, 관리자(is_admin)만 로그인 허용
const { query } = require('./db');
const { verifyPassword, signToken, TOKEN_SECRET } = require('./auth');

const { setCors } = require('./cors');

module.exports = async (req, res) => {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  }

  const { id, password } = req.body || {};

  if (!id || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요.' });
  }

  try {
    // public.users 테이블에서 사용자 조회
    const result = await query(
      'SELECT id, username, password_hash, name, is_admin FROM public.users WHERE username = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }

    const user = result.rows[0];

    // 비밀번호 검증
    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }

    // 관리자 권한 체크
    if (!user.is_admin) {
      return res.status(403).json({ error: '관리자만 접근할 수 있습니다.' });
    }

    // JWT 토큰 발급 (7일 유효)
    const token = signToken(
      { sub: user.username, uid: user.id, name: user.name, admin: true },
      TOKEN_SECRET,
      '7d'
    );

    console.log(`[DocStore Auth] 로그인 성공: ${user.username} (${user.name})`);
    res.json({ token, name: user.name, admin: true });
  } catch (err) {
    console.error('[DocStore Auth] 로그인 에러:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
};
