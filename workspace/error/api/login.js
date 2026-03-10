// Vercel 서버리스 함수 - 로그인 API (DB + JWT)
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { query } = require('./db');

const TOKEN_SECRET = (process.env.AUTH_TOKEN_SECRET || 'error-study-default-secret-2026').trim();

// 로그인 브루트포스 방어: IP 기준 1분 5회 제한
const loginAttempts = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginAttempts) { if (now > v.resetAt) loginAttempts.delete(k); }
}, 60000);

function checkLoginLimit(req, res) {
  const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
  const now = Date.now();
  let entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 60000 };
    loginAttempts.set(ip, entry);
  }
  entry.count++;
  if (entry.count > 5) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.status(429).json({ error: `로그인 시도가 너무 많습니다. ${retryAfter}초 후 다시 시도해주세요.` });
    return true;
  }
  return false;
}

// scrypt 파라미터 (signup.js와 동일)
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
const SCRYPT_KEYLEN = 64;

// 비밀번호 검증 — 저장 형식에 따라 자동 분기
//   신규: "scrypt:salt:hash" → scrypt 검증
//   레거시: "salt:sha256hex" → SHA-256 검증 (하위 호환)
function verifyPassword(inputPassword, storedHash) {
  if (storedHash.startsWith('scrypt:')) {
    const [, salt, hash] = storedHash.split(':');
    return new Promise((resolve, reject) => {
      crypto.scrypt(inputPassword, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS, (err, derived) => {
        if (err) return reject(err);
        const inputBuf = derived;
        const storedBuf = Buffer.from(hash, 'hex');
        if (inputBuf.length !== storedBuf.length) return resolve(false);
        resolve(crypto.timingSafeEqual(inputBuf, storedBuf));
      });
    });
  }
  // 레거시 SHA-256 형식
  const [salt, hash] = storedHash.split(':');
  const inputHash = crypto.createHash('sha256').update(salt + inputPassword).digest('hex');
  const inputBuf = Buffer.from(inputHash);
  const storedBuf = Buffer.from(hash);
  if (inputBuf.length !== storedBuf.length) return Promise.resolve(false);
  return Promise.resolve(crypto.timingSafeEqual(inputBuf, storedBuf));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  }

  // 브루트포스 방어: IP 기준 1분 5회 제한
  if (checkLoginLimit(req, res)) return;

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

    if (!await verifyPassword(password, user.password_hash)) {
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
