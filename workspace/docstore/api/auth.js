// DocStore 인증 유틸리티
// workspace/error의 users 테이블을 공유하며, 관리자(is_admin)만 허용
const crypto = require('crypto');

// AUTH_TOKEN_SECRET 필수 — 미설정 시 서버 시작 거부
const TOKEN_SECRET = (process.env.AUTH_TOKEN_SECRET || '').trim();
if (!TOKEN_SECRET) {
  console.error('[Auth] AUTH_TOKEN_SECRET 환경변수가 설정되지 않았습니다.');
  // Vercel 서버리스에서는 즉시 중단하지 않고 런타임에 에러 반환
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
  if (!token || !TOKEN_SECRET) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // 서명 검증
    const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET).update(parts[0] + '.' + parts[1]).digest('base64')
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    if (expectedSig !== parts[2]) return null;

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

// 비밀번호 검증
function verifyPassword(inputPassword, storedHash) {
  const [salt, hash] = storedHash.split(':');
  const inputHash = crypto.createHash('sha256').update(salt + inputPassword).digest('hex');
  const inputBuf = Buffer.from(inputHash);
  const storedBuf = Buffer.from(hash);
  if (inputBuf.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(inputBuf, storedBuf);
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

module.exports = { signToken, verifyToken, extractToken, verifyPassword, requireAdmin, TOKEN_SECRET };
