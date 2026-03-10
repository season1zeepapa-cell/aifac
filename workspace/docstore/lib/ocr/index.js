// OCR 엔진 매니저 — 플러그인 레지스트리 + 우선순위 폴백
const { query } = require('../db');

// ── 엔진 레지스트리 (모든 플러그인 로드) ──
const ALL_ENGINES = {
  'naver-clova': require('./naver-clova'),
  'google-vision': require('./google-vision'),
  'gemini-vision': require('./gemini-vision'),
  'claude-vision': require('./claude-vision'),
  'aws-textract': require('./aws-textract'),
  'ocr-space': require('./ocr-space'),
};

// DB 설정이 없을 때 사용하는 기본 우선순위
const DEFAULT_PRIORITY = [
  'gemini-vision',    // 무료, 현재 동작 중
  'naver-clova',      // 한국어 최강
  'google-vision',    // 정확도 최고
  'claude-vision',    // 문맥 분석 우수
  'aws-textract',     // 표/양식 특화
  'ocr-space',        // 무료 일500건, 한국어 지원
];

// ── 설정 캐시 (서버리스 환경에서 인스턴스 내 재사용) ──
let cachedConfig = null;
let cacheTime = 0;
const CACHE_TTL = 60000; // 1분

/**
 * DB에서 OCR 설정 로드 (캐시 포함)
 * 테이블이 없거나 설정이 비어 있으면 기본값 반환
 */
async function loadOcrConfig() {
  if (cachedConfig && Date.now() - cacheTime < CACHE_TTL) {
    return cachedConfig;
  }

  try {
    const result = await query(
      'SELECT engine_id, is_enabled, priority_order FROM ocr_engine_config ORDER BY priority_order'
    );
    if (result.rows.length > 0) {
      cachedConfig = result.rows;
      cacheTime = Date.now();
      return cachedConfig;
    }
  } catch (err) {
    // 테이블이 없으면 기본 설정 사용
    console.warn('[OCR] 설정 테이블 없음 → 기본 설정 사용');
  }

  // 기본 설정: 모든 엔진 활성, DEFAULT_PRIORITY 순서
  cachedConfig = DEFAULT_PRIORITY.map((id, i) => ({
    engine_id: id,
    is_enabled: true,
    priority_order: i + 1,
  }));
  cacheTime = Date.now();
  return cachedConfig;
}

/**
 * 설정 캐시 무효화 (설정 변경 시 호출)
 */
function invalidateCache() {
  cachedConfig = null;
  cacheTime = 0;
}

/**
 * 사용 가능한 엔진 목록 조회 (설정 UI용)
 */
async function getEngineList() {
  const config = await loadOcrConfig();
  return Object.values(ALL_ENGINES).map(engine => {
    const cfg = config.find(c => c.engine_id === engine.id);
    return {
      engine_id: engine.id,
      name: engine.name,
      provider: engine.provider,
      description: engine.description,
      free: engine.free,
      bestFor: engine.bestFor,
      envKey: engine.envKey,
      is_available: engine.isAvailable(),
      is_enabled: cfg ? cfg.is_enabled : true,
      priority_order: cfg ? cfg.priority_order : 99,
    };
  }).sort((a, b) => a.priority_order - b.priority_order);
}

/**
 * 메인 OCR 실행 — 우선순위대로 시도, 실패 시 자동 폴백
 * @param {string} base64 - 이미지 base64
 * @param {string} mediaType - MIME 타입
 * @param {string} prompt - OCR 프롬프트
 * @returns {{ text: string, engine: string, fallbackUsed: boolean, errors: Array }}
 */
async function runOcr(base64, mediaType, prompt) {
  const config = await loadOcrConfig();

  // 활성 + 환경변수 설정된 엔진만 우선순위 순으로
  const activeEngines = config
    .filter(c => c.is_enabled)
    .map(c => ALL_ENGINES[c.engine_id])
    .filter(e => e && e.isAvailable());

  if (activeEngines.length === 0) {
    throw new Error('사용 가능한 OCR 엔진이 없습니다. API 키를 설정해주세요.');
  }

  const errors = [];

  for (const engine of activeEngines) {
    try {
      console.log(`[OCR] ${engine.name} 시도 중...`);
      const text = await engine.execute(base64, mediaType, prompt);

      if (text && text.trim()) {
        console.log(`[OCR] ${engine.name} 성공 (${text.length}자)`);
        return {
          text: text.trim(),
          engine: engine.id,
          fallbackUsed: errors.length > 0,
          errors,
        };
      }

      errors.push({ engine: engine.id, error: '빈 결과 반환' });
    } catch (err) {
      const msg = err.message?.substring(0, 150) || '알 수 없는 에러';
      console.warn(`[OCR] ${engine.name} 실패: ${msg}`);
      errors.push({ engine: engine.id, error: msg });
    }
  }

  const summary = errors.map(e => `${e.engine}(${e.error})`).join(', ');
  throw new Error(`모든 OCR 엔진 실패: ${summary}`);
}

module.exports = {
  runOcr,
  getEngineList,
  invalidateCache,
  ALL_ENGINES,
  DEFAULT_PRIORITY,
};
