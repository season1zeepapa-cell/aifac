// API 호출 추적, 일일 한도 체크, 토큰 소진 감지 모듈
const { query } = require('../api/db');

// 비용 단가 ($ per 1M tokens)
const COST_TABLE = {
  'openai:text-embedding-3-small': { in: 0.02, out: 0 },
  'openai:gpt-4o': { in: 5.0, out: 15.0 },
  'anthropic:claude-opus-4-6': { in: 15.0, out: 75.0 },
  'anthropic:claude-sonnet-4-6': { in: 3.0, out: 15.0 },
  'gemini:gemini-2.0-flash': { in: 0, out: 0 }, // 무료 티어
};

// 토큰 소진 에러 패턴
const CREDIT_ERROR_PATTERNS = [
  'credit balance is too low',
  'insufficient_quota',
  'rate_limit_exceeded',
  'billing_hard_limit_reached',
  'exceeded your current quota',
  'Resource has been exhausted',
];

/**
 * 에러가 토큰/크레딧 소진인지 판별
 */
function isCreditError(error) {
  const msg = (error?.message || error?.toString() || '').toLowerCase();
  return CREDIT_ERROR_PATTERNS.some(pattern => msg.toLowerCase().includes(pattern.toLowerCase()));
}

/**
 * API 호출 기록 저장
 */
async function trackUsage({ provider, model, endpoint, tokensIn = 0, tokensOut = 0, status = 'success', errorMessage = null }) {
  try {
    const costKey = `${provider}:${model}`;
    const rates = COST_TABLE[costKey] || { in: 0, out: 0 };
    const costEstimate = (tokensIn * rates.in + tokensOut * rates.out) / 1_000_000;

    await query(
      `INSERT INTO api_usage (provider, model, endpoint, tokens_in, tokens_out, cost_estimate, status, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [provider, model, endpoint, tokensIn, tokensOut, costEstimate, status, errorMessage]
    );
  } catch (err) {
    // 추적 실패해도 메인 로직에 영향 주지 않음
    console.error('[API Tracker] 기록 실패:', err.message);
  }
}

/**
 * 키 상태 업데이트 (에러 발생 시)
 */
async function updateKeyStatus(provider, { isActive = true, lastError = null } = {}) {
  try {
    await query(
      `UPDATE api_key_status
       SET is_active = $2, last_checked = NOW(), last_error = $3, updated_at = NOW()
       WHERE provider = $1`,
      [provider, isActive, lastError]
    );
  } catch (err) {
    console.error('[API Tracker] 키 상태 업데이트 실패:', err.message);
  }
}

/**
 * 오늘 사용량 조회 (프로바이더별)
 */
async function getTodayUsage(provider) {
  try {
    const result = await query(
      `SELECT COUNT(*) AS call_count,
              COALESCE(SUM(tokens_in), 0) AS total_tokens_in,
              COALESCE(SUM(tokens_out), 0) AS total_tokens_out,
              COALESCE(SUM(cost_estimate), 0) AS total_cost
       FROM api_usage
       WHERE provider = $1
         AND status = 'success'
         AND created_at >= CURRENT_DATE`,
      [provider]
    );
    return result.rows[0];
  } catch (err) {
    return { call_count: 0, total_tokens_in: 0, total_tokens_out: 0, total_cost: 0 };
  }
}

/**
 * 일일 한도 초과 여부 확인
 * @returns {{ allowed: boolean, usage: number, limit: number }}
 */
async function checkDailyLimit(provider) {
  try {
    const status = await query(
      'SELECT daily_limit, is_active FROM api_key_status WHERE provider = $1',
      [provider]
    );
    if (status.rows.length === 0) return { allowed: true, usage: 0, limit: 0 };

    const { daily_limit, is_active } = status.rows[0];

    // 키가 비활성 상태면 차단
    if (!is_active) return { allowed: false, usage: 0, limit: daily_limit, reason: 'key_disabled' };

    // 한도가 0이면 무제한
    if (!daily_limit || daily_limit === 0) return { allowed: true, usage: 0, limit: 0 };

    const usage = await getTodayUsage(provider);
    const callCount = parseInt(usage.call_count) || 0;

    return {
      allowed: callCount < daily_limit,
      usage: callCount,
      limit: daily_limit,
      reason: callCount >= daily_limit ? 'daily_limit_exceeded' : null,
    };
  } catch (err) {
    // 체크 실패 시 허용 (서비스 중단 방지)
    return { allowed: true, usage: 0, limit: 0 };
  }
}

/**
 * API 호출 래퍼 — 추적 + 한도 체크 + 에러 감지를 한 번에 처리
 * @param {Object} opts - { provider, model, endpoint }
 * @param {Function} apiFn - 실제 API 호출 함수 (async)
 * @returns {{ result, tracked, error, creditExhausted }}
 */
async function trackedApiCall({ provider, model, endpoint }, apiFn) {
  // 1) 일일 한도 체크
  const limitCheck = await checkDailyLimit(provider);
  if (!limitCheck.allowed) {
    const msg = limitCheck.reason === 'key_disabled'
      ? `${provider} API 키가 비활성 상태입니다.`
      : `${provider} 일일 호출 한도 초과 (${limitCheck.usage}/${limitCheck.limit})`;
    return { result: null, error: new Error(msg), creditExhausted: false, limitExceeded: true };
  }

  // 2) API 호출 실행
  try {
    const result = await apiFn();

    // 사용량 기록 (토큰 수는 호출자가 result에 포함시킬 수 있음)
    const tokensIn = result?._tokensIn || 0;
    const tokensOut = result?._tokensOut || 0;
    await trackUsage({ provider, model, endpoint, tokensIn, tokensOut, status: 'success' });
    await updateKeyStatus(provider, { isActive: true });

    return { result, error: null, creditExhausted: false };
  } catch (err) {
    const creditExhausted = isCreditError(err);
    const status = creditExhausted ? 'credit_exhausted' : 'error';

    // 에러 기록
    await trackUsage({ provider, model, endpoint, status, errorMessage: err.message });

    // 크레딧 소진이면 키 비활성화
    if (creditExhausted) {
      await updateKeyStatus(provider, { isActive: false, lastError: err.message });
    }

    return { result: null, error: err, creditExhausted };
  }
}

module.exports = {
  trackUsage,
  updateKeyStatus,
  getTodayUsage,
  checkDailyLimit,
  trackedApiCall,
  isCreditError,
  COST_TABLE,
};
