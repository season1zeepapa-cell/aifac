// Vercel 서버리스 함수 - 로그인 API (DB + JWT)
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { query } = require('./db');

const TOKEN_SECRET = (process.env.AUTH_TOKEN_SECRET || 'error-study-default-secret-2026').trim();

// 비밀번호 검증
function verifyPassword(inputPassword, storedHash) {
  const [salt, hash] = storedHash.split(':');
  const inputHash = crypto.createHash('sha256').update(salt + inputPassword).digest('hex');

  const inputBuf = Buffer.from(inputHash);
  const storedBuf = Buffer.from(hash);
  if (inputBuf.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(inputBuf, storedBuf);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  }

  const { id, password } = req.body || {};

  if (!id || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요.' });
  }

  try {
    const result = await query(
      'SELECT id, username, password_hash, name, is_admin FROM public.users WHERE username = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }

    const user = result.rows[0];

    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }

    // 표준 JWT 발급 (관리자 여부 포함)
    const token = jwt.sign(
      { sub: user.username, uid: user.id, name: user.name, admin: !!user.is_admin },
      TOKEN_SECRET,
      { expiresIn: '7d' }
    );

    console.log(`[Auth] 로그인 성공: ${user.username} (${user.name}) admin=${!!user.is_admin}`);
    res.json({ token, name: user.name, admin: !!user.is_admin });
  } catch (err) {
    console.error('[Auth] 로그인 에러:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
};
