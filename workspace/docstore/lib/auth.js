// DocStore 인증 유틸리티
// workspace/error의 users 테이블을 공유하며, 관리자(is_admin)만 허용
const crypto = require('crypto');

// AUTH_TOKEN_SECRET 필수 — 32자 이상 필수 (예측 불가능한 서명 보장)
const TOKEN_SECRET = (process.env.AUTH_TOKEN_SECRET || '').trim();
const TOKEN_SECRET_VALID = TOKEN_SECRET.length >= 32;
if (!TOKEN_SECRET_VALID) {
  console.error('[Auth] AUTH_TOKEN_SECRET이 설정되지 않았거나 32자 미만입니다.');
  console.error('[Auth] 최소 32자 이상의 랜덤 문자열을 환경변수로 설정해주세요.');
  // Vercel 서버리스에서는 즉시 중단하지 않고, 토큰 생성/검증 시 거부
}

// JWT 구현 (jsonwebtoken 패키지 없이 직접 구현 — 의존성 최소화)
// HMAC-SHA256 기반
function base64url(str) {
  return Buffer.from(str).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString();
}

function signToken(payload, secret, expiresIn = '7d') {
  // 시크릿 유효성 검증 — 빈 문자열이나 짧은 키로 서명 방지
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_TOKEN_SECRET이 32자 미만입니다. 토큰 서명을 거부합니다.');
  }
  const header = { alg: 'HS256', typ: 'JWT' };
  // 만료 시간 계산
  const match = expiresIn.match(/^(\d+)([dhms])$/);
  if (match) {
    const num = parseInt(match[1]);
    const unit = { d: 86400, h: 3600, m: 60, s: 1 }[match[2]];
    payload.exp = Math.floor(Date.now() / 1000) + num * unit;
  }
  payload.iat = Math.floor(Date.now() / 1000);

  const segments = [
    base64url(JSON.stringify(header)),
    base64url(JSON.stringify(payload)),
  ];
  const signature = crypto.createHmac('sha256', secret).update(segments.join('.')).digest('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  segments.push(signature);
  return segments.join('.');
}

function verifyToken(token) {
  if (!token || !TOKEN_SECRET_VALID) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // 서명 검증
    const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET).update(parts[0] + '.' + parts[1]).digest('base64')
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    // 타이밍 공격 방어: 일정 시간 비교 (길이가 다르면 즉시 거부)
    const expectedBuf = Buffer.from(expectedSig);
    const actualBuf = Buffer.from(parts[2]);
    if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) return null;

    const payload = JSON.parse(base64urlDecode(parts[1]));

    // 만료 체크
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

// req에서 토큰 추출 (Authorization 헤더만 허용 — URL 파라미터 노출 방지)
function extractToken(req) {
  const authHeader = req.headers?.authorization || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  return null;
}

// ── 비밀번호 해싱 (scrypt — GPU brute-force 내성) ──
// scrypt 파라미터: N=16384, r=8, p=1, keyLen=64
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
const SCRYPT_KEYLEN = 64;

/**
 * 비밀번호를 scrypt로 해싱
 * @returns {Promise<string>} "scrypt:salt:hash" 형식
 */
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS, (err, derived) => {
      if (err) return reject(err);
      resolve(`scrypt:${salt}:${derived.toString('hex')}`);
    });
  });
}

/**
 * 비밀번호 검증 — 저장 형식에 따라 자동 분기
 *   신규: "scrypt:salt:hash" → scrypt 검증
 *   레거시: "salt:sha256hex" → SHA-256 검증 (하위 호환)
 * @returns {Promise<boolean>}
 */
function verifyPassword(inputPassword, storedHash) {
  // 신규 scrypt 형식
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
  // 레거시 SHA-256 형식 (기존 사용자 하위 호환)
  const [salt, hash] = storedHash.split(':');
  const inputHash = crypto.createHash('sha256').update(salt + inputPassword).digest('hex');
  const inputBuf = Buffer.from(inputHash);
  const storedBuf = Buffer.from(hash);
  if (inputBuf.length !== storedBuf.length) return Promise.resolve(false);
  return Promise.resolve(crypto.timingSafeEqual(inputBuf, storedBuf));
}

/**
 * 인증 미들웨어 — 관리자 토큰 필수
 * @returns {{ user, error }} user가 있으면 인증 성공
 */
function requireAdmin(req) {
  const token = extractToken(req);
  if (!token) return { user: null, error: '로그인이 필요합니다.' };

  const payload = verifyToken(token);
  if (!payload) return { user: null, error: '인증 토큰이 만료되었거나 유효하지 않습니다.' };

  if (!payload.admin) return { user: null, error: '관리자 권한이 필요합니다.' };

  return { user: payload, error: null };
}

module.exports = { signToken, verifyToken, extractToken, hashPassword, verifyPassword, requireAdmin, TOKEN_SECRET };
