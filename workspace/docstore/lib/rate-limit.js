// 인메모리 Rate Limiting (서버리스 환경용)
// Vercel 서버리스에서는 인스턴스가 공유되므로 같은 인스턴스 내에서 유효
// 완벽하지 않지만 기본적인 남용 방지 역할

// 엔드포인트별 기본 설정
const LIMITS = {
  upload:     { windowMs: 60000, max: 10 },   // 1분 10건
  rag:        { windowMs: 60000, max: 20 },   // 1분 20건
  summary:    { windowMs: 60000, max: 15 },   // 1분 15건
  search:     { windowMs: 60000, max: 60 },   // 1분 60건
  lawImport:  { windowMs: 60000, max: 5 },    // 1분 5건
  urlImport:  { windowMs: 60000, max: 10 },   // 1분 10건
  default:    { windowMs: 60000, max: 30 },   // 1분 30건
};

// 인메모리 저장소: { key: { count, resetAt } }
const store = new Map();

// 만료된 항목 주기적 정리 (메모리 누수 방지)
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of store) {
    if (now > val.resetAt) store.delete(key);
  }
}, 60000);

/**
 * Rate limit 체크
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {string} endpoint - 엔드포인트 키 (upload, rag, summary 등)
 * @returns {boolean} true면 제한 초과 → 핸들러 종료 필요
 */
function checkRateLimit(req, res, endpoint = 'default') {
  const config = LIMITS[endpoint] || LIMITS.default;
  const now = Date.now();

  // 사용자 식별: 인증된 사용자 ID 또는 IP
  const userId = req.user?.sub || req.headers['x-forwarded-for'] || req.ip || 'unknown';
  const key = `${endpoint}:${userId}`;

  let entry = store.get(key);

  // 윈도우 만료 시 리셋
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + config.windowMs };
    store.set(key, entry);
  }

  entry.count++;

  // 남은 횟수 헤더 설정
  const remaining = Math.max(0, config.max - entry.count);
  res.setHeader('X-RateLimit-Limit', config.max);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

  if (entry.count > config.max) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader('Retry-After', retryAfter);
    res.status(429).json({
      error: `요청이 너무 많습니다. ${retryAfter}초 후 다시 시도해주세요.`,
    });
    return true;
  }

  return false;
}

module.exports = { checkRateLimit, LIMITS };
