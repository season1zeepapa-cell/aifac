// DB 기반 Rate Limiting (서버리스 환경 대응)
// PostgreSQL에 카운터를 저장하여 Vercel 콜드 스타트 후에도 유지
// DB 장애 시 인메모리 폴백으로 서비스 중단 방지

const { getPool } = require('./db');

// 엔드포인트별 기본 설정
const LIMITS = {
  upload:     { windowMs: 60000, max: 10 },   // 1분 10건
  rag:        { windowMs: 60000, max: 20 },   // 1분 20건
  summary:    { windowMs: 60000, max: 15 },   // 1분 15건
  search:     { windowMs: 60000, max: 60 },   // 1분 60건
  login:      { windowMs: 60000, max: 5 },    // 1분 5회 (브루트포스 방어)
  lawImport:  { windowMs: 60000, max: 5 },    // 1분 5건
  urlImport:  { windowMs: 60000, max: 10 },   // 1분 10건
  ocr:        { windowMs: 60000, max: 10 },   // 1분 10건
  default:    { windowMs: 60000, max: 30 },   // 1분 30건
};

// 인메모리 폴백 (DB 장애 시 사용)
const memStore = new Map();

// 테이블 초기화 상태
let tableReady = false;

// rate_limits 테이블 자동 생성
async function ensureTable() {
  if (tableReady) return true;
  try {
    const pool = getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        key VARCHAR(255) PRIMARY KEY,
        count INT DEFAULT 1,
        window_start TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    tableReady = true;
    return true;
  } catch (err) {
    console.error('[RateLimit] 테이블 생성 실패, 인메모리 폴백:', err.message);
    return false;
  }
}

// 만료된 DB 레코드 정리 (최대 윈도우 기준)
async function cleanupExpired() {
  try {
    const pool = getPool();
    await pool.query(
      `DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '2 minutes'`
    );
  } catch { /* 정리 실패는 무시 */ }
}

// DB 기반 rate limit 체크 — 원자적 UPSERT로 카운트 증가
async function checkRateLimitDB(key, config) {
  const pool = getPool();
  const windowSec = config.windowMs / 1000;

  // 1) 윈도우 만료된 레코드 리셋 + 카운트 증가를 단일 쿼리로 처리
  const result = await pool.query(`
    INSERT INTO rate_limits (key, count, window_start)
    VALUES ($1, 1, NOW())
    ON CONFLICT (key) DO UPDATE SET
      count = CASE
        WHEN rate_limits.window_start < NOW() - INTERVAL '${windowSec} seconds'
        THEN 1
        ELSE rate_limits.count + 1
      END,
      window_start = CASE
        WHEN rate_limits.window_start < NOW() - INTERVAL '${windowSec} seconds'
        THEN NOW()
        ELSE rate_limits.window_start
      END
    RETURNING count, window_start
  `, [key]);

  const { count, window_start } = result.rows[0];
  const resetAt = new Date(window_start).getTime() + config.windowMs;

  return { count, resetAt };
}

// 인메모리 폴백 rate limit 체크
function checkRateLimitMem(key, config) {
  const now = Date.now();
  let entry = memStore.get(key);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + config.windowMs };
    memStore.set(key, entry);
  }

  entry.count++;
  return { count: entry.count, resetAt: entry.resetAt };
}

/**
 * Rate limit 체크 (비동기 — await 필수)
 * DB 기반으로 Vercel 서버리스 인스턴스 간 공유
 * DB 장애 시 인메모리로 자동 폴백
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {string} endpoint - 엔드포인트 키
 * @returns {Promise<boolean>} true면 제한 초과 → 핸들러 종료 필요
 */
async function checkRateLimit(req, res, endpoint = 'default') {
  const config = LIMITS[endpoint] || LIMITS.default;
  const now = Date.now();

  // 사용자 식별: 인증된 사용자 ID 또는 IP
  const userId = req.user?.sub || req.headers['x-forwarded-for'] || req.ip || 'unknown';
  const key = `${endpoint}:${userId}`;

  let count, resetAt;

  // DB 기반 시도 → 실패 시 인메모리 폴백
  const dbReady = await ensureTable();
  if (dbReady) {
    try {
      ({ count, resetAt } = await checkRateLimitDB(key, config));
      // 가끔 만료 레코드 정리 (10% 확률)
      if (Math.random() < 0.1) cleanupExpired().catch(() => {});
    } catch (err) {
      console.error('[RateLimit] DB 체크 실패, 인메모리 폴백:', err.message);
      ({ count, resetAt } = checkRateLimitMem(key, config));
    }
  } else {
    ({ count, resetAt } = checkRateLimitMem(key, config));
  }

  // 남은 횟수 헤더 설정
  const remaining = Math.max(0, config.max - count);
  res.setHeader('X-RateLimit-Limit', config.max);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt / 1000));

  if (count > config.max) {
    const retryAfter = Math.ceil((resetAt - now) / 1000);
    res.setHeader('Retry-After', retryAfter > 0 ? retryAfter : 1);
    res.status(429).json({
      error: `요청이 너무 많습니다. ${retryAfter > 0 ? retryAfter : 1}초 후 다시 시도해주세요.`,
    });
    return true;
  }

  return false;
}

module.exports = { checkRateLimit, LIMITS };
