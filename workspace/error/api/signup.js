// Vercel 서버리스 함수 - 회원가입 API
const crypto = require('crypto');
const { query } = require('./db');

// scrypt 파라미터: N=16384, r=8, p=1, keyLen=64
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
const SCRYPT_KEYLEN = 64;

// 비밀번호 해싱 (scrypt — GPU brute-force 내성)
// 저장 형식: "scrypt:salt:hash"
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS, (err, derived) => {
      if (err) return reject(err);
      resolve(`scrypt:${salt}:${derived.toString('hex')}`);
    });
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  }

  const { username, password, name } = req.body || {};

  // 입력값 검증
  if (!username || !password || !name) {
    return res.status(400).json({ error: '아이디, 비밀번호, 이름을 모두 입력해주세요.' });
  }

  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ error: '아이디는 3~20자로 입력해주세요.' });
  }

  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: '아이디는 영문, 숫자, 밑줄(_)만 사용할 수 있어요.' });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: '비밀번호는 4자 이상으로 입력해주세요.' });
  }

  if (name.length > 20) {
    return res.status(400).json({ error: '이름은 20자 이내로 입력해주세요.' });
  }

  try {
    // 아이디 중복 확인
    const existing = await query('SELECT id FROM public.users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: '이미 사용 중인 아이디입니다.' });
    }

    // 비밀번호 해싱 (scrypt)
    const passwordHash = await hashPassword(password);

    // DB에 저장
    await query(
      'INSERT INTO public.users (username, password_hash, name) VALUES ($1, $2, $3)',
      [username, passwordHash, name]
    );

    console.log(`[Auth] 회원가입 성공: ${username} (${name})`);
    res.json({ message: '회원가입이 완료되었습니다!' });
  } catch (err) {
    console.error('[Auth] 회원가입 에러:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
};
