// 표준 JWT 토큰 검증 유틸리티
const jwt = require('jsonwebtoken');

const TOKEN_SECRET = (process.env.AUTH_TOKEN_SECRET || 'error-study-default-secret-2026').trim();

// 토큰 검증 → 성공 시 payload 반환, 실패 시 null
function verifyToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, TOKEN_SECRET);
  } catch {
    return null;
  }
}

// req에서 토큰 추출 (Authorization: Bearer xxx 또는 쿼리 ?token=xxx)
function extractToken(req) {
  const authHeader = req.headers?.authorization || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  return req.query?.token || null;
}

module.exports = { verifyToken, extractToken };
