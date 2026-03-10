// OCR 엔진 매니저 — 우선순위별 엔진 시도 + 자동 폴백
// text-extractor.js, api-usage.js 에서 사용
//
// 사용법:
//   const { runOcr } = require('./ocr');
//   const { text, engine, fallbackUsed } = await runOcr(base64, mediaType, prompt);

const https = require('https');
const { query } = require('./db');

// ════════════════════════════════════════
// 엔진 정의 — 각 엔진의 실행 로직
// ════════════════════════════════════════

const ALL_ENGINES = {
  // ── Upstage Document OCR (전용 OCR 모델) ──
  'upstage-ocr': {
    name: 'Upstage OCR',
    description: '한국어 문서에 특화된 OCR 엔진 (표, 한글, 수식 인식 우수)',
    provider: 'upstage',
    envKey: 'UPSTAGE_API_KEY',
    free: true,
    isAvailable() { return !!process.env.UPSTAGE_API_KEY; },
    async execute(base64, mediaType, prompt) {
      // Upstage Document Digitization API 호출
      const fileBuffer = Buffer.from(base64, 'base64');
      const boundary = `----FormBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;

      // 확장자 추론
      const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/bmp': 'bmp', 'image/tiff': 'tiff', 'application/pdf': 'pdf' };
      const ext = extMap[mediaType] || 'png';
      const filename = `document.${ext}`;

      // multipart/form-data 수동 생성
      const fileHeader = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="document"; filename="${filename}"\r\n` +
        `Content-Type: ${mediaType}\r\n\r\n`
      );
      const modelField = Buffer.from(
        `\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model"\r\n\r\n` +
        `ocr`
      );
      const ending = Buffer.from(`\r\n--${boundary}--\r\n`);
      const body = Buffer.concat([fileHeader, fileBuffer, modelField, ending]);

      return new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.upstage.ai',
          path: '/v1/document-digitization',
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.UPSTAGE_API_KEY}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length,
          },
          timeout: 60000,
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (res.statusCode !== 200) {
                reject(new Error(json.message || json.error || `Upstage API 오류: HTTP ${res.statusCode}`));
                return;
              }
              // Upstage는 content 또는 text 필드에 결과를 반환
              const text = json.content || json.text || '';
              if (!text.trim()) reject(new Error('텍스트가 추출되지 않았습니다.'));
              else resolve(text);
            } catch (e) {
              reject(new Error(`Upstage API 응답 파싱 실패`));
            }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Upstage OCR 시간 초과 (60초)')); });
        req.write(body);
        req.end();
      });
    },
  },

  // ── Gemini Vision (다목적 비전 모델) ──
  'gemini-vision': {
    name: 'Gemini Vision',
    description: 'Google Gemini 비전 모델 (범용 이미지 인식)',
    provider: 'gemini',
    envKey: 'GEMINI_API_KEY',
    free: false,
    isAvailable() { return !!process.env.GEMINI_API_KEY; },
    async execute(base64, mediaType, prompt) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
      const body = JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mediaType, data: base64 } },
          ],
        }],
      });

      return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = https.request({
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000,
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (res.statusCode !== 200) {
                reject(new Error(json.error?.message || `Gemini API 오류: HTTP ${res.statusCode}`));
                return;
              }
              const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
              if (!text.trim()) reject(new Error('텍스트가 추출되지 않았습니다.'));
              else resolve(text);
            } catch (e) {
              reject(new Error('Gemini API 응답 파싱 실패'));
            }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Gemini Vision 시간 초과')); });
        req.write(body);
        req.end();
      });
    },
  },

  // ── Claude Vision (Anthropic) ──
  'claude-vision': {
    name: 'Claude Vision',
    description: 'Anthropic Claude 비전 모델 (정교한 문서 분석)',
    provider: 'anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    free: false,
    isAvailable() { return !!process.env.ANTHROPIC_API_KEY; },
    async execute(base64, mediaType, prompt) {
      const body = JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: prompt },
          ],
        }],
      });

      return new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (res.statusCode !== 200) {
                reject(new Error(json.error?.message || `Anthropic API 오류: HTTP ${res.statusCode}`));
                return;
              }
              const text = json.content?.[0]?.text || '';
              if (!text.trim()) reject(new Error('텍스트가 추출되지 않았습니다.'));
              else resolve(text);
            } catch (e) {
              reject(new Error('Anthropic API 응답 파싱 실패'));
            }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Claude Vision 시간 초과')); });
        req.write(body);
        req.end();
      });
    },
  },

  // ── OpenAI Vision (GPT-4o) ──
  'openai-vision': {
    name: 'OpenAI Vision',
    description: 'GPT-4o 비전 모델 (범용 이미지 인식)',
    provider: 'openai',
    envKey: 'OPENAI_API_KEY',
    free: false,
    isAvailable() { return !!process.env.OPENAI_API_KEY; },
    async execute(base64, mediaType, prompt) {
      const body = JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
          ],
        }],
        max_tokens: 4096,
      });

      return new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.openai.com',
          path: '/v1/chat/completions',
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (res.statusCode !== 200) {
                reject(new Error(json.error?.message || `OpenAI API 오류: HTTP ${res.statusCode}`));
                return;
              }
              const text = json.choices?.[0]?.message?.content || '';
              if (!text.trim()) reject(new Error('텍스트가 추출되지 않았습니다.'));
              else resolve(text);
            } catch (e) {
              reject(new Error('OpenAI API 응답 파싱 실패'));
            }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('OpenAI Vision 시간 초과')); });
        req.write(body);
        req.end();
      });
    },
  },

  // ── OCR.space (무료 OCR API) ──
  'ocr-space': {
    name: 'OCR.space',
    description: '무료 일 500건, 한국어 지원 (API 키 무료 발급)',
    provider: 'ocr-space',
    envKey: 'OCR_SPACE_API_KEY',
    free: true,
    isAvailable() { return !!process.env.OCR_SPACE_API_KEY; },
    async execute(base64, mediaType, prompt) {
      const body = JSON.stringify({
        base64Image: `data:${mediaType};base64,${base64}`,
        language: 'kor',
        isOverlayRequired: false,
        OCREngine: 2,
      });
      return new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.ocr.space',
          path: '/parse/image',
          method: 'POST',
          headers: {
            'apikey': process.env.OCR_SPACE_API_KEY,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (json.IsErroredOnProcessing) {
                reject(new Error(json.ErrorMessage?.[0] || 'OCR.space 처리 오류'));
                return;
              }
              const text = json.ParsedResults?.map(r => r.ParsedText).join('\n') || '';
              if (!text.trim()) reject(new Error('텍스트가 추출되지 않았습니다.'));
              else resolve(text);
            } catch (e) {
              reject(new Error('OCR.space 응답 파싱 실패'));
            }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('OCR.space 시간 초과')); });
        req.write(body);
        req.end();
      });
    },
  },

  // ── AWS Textract (표/양식 특화) ──
  'aws-textract': {
    name: 'AWS Textract',
    description: '표/양식 특화 OCR (AWS 계정 필요)',
    provider: 'aws',
    envKey: 'AWS_ACCESS_KEY_ID',
    free: false,
    isAvailable() { return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY); },
    async execute(base64, mediaType, prompt) {
      // AWS SDK 필요 — 미설치 시 안내
      throw new Error('AWS Textract는 aws-sdk 패키지 설치가 필요합니다. npm install @aws-sdk/client-textract');
    },
  },

  // ── 네이버 CLOVA OCR (한국어 최강) ──
  'naver-clova': {
    name: '네이버 CLOVA OCR',
    description: '한국어 인식 최강 (네이버 클라우드 API 키 필요)',
    provider: 'naver',
    envKey: 'NAVER_CLOVA_OCR_SECRET',
    free: false,
    isAvailable() { return !!(process.env.NAVER_CLOVA_OCR_SECRET && process.env.NAVER_CLOVA_OCR_URL); },
    async execute(base64, mediaType, prompt) {
      const body = JSON.stringify({
        version: 'V2',
        requestId: `ocr-${Date.now()}`,
        timestamp: Date.now(),
        images: [{ format: mediaType.split('/')[1] || 'png', data: base64, name: 'image' }],
      });
      const apiUrl = new URL(process.env.NAVER_CLOVA_OCR_URL);
      return new Promise((resolve, reject) => {
        const req = https.request({
          hostname: apiUrl.hostname,
          path: apiUrl.pathname,
          method: 'POST',
          headers: {
            'X-OCR-SECRET': process.env.NAVER_CLOVA_OCR_SECRET,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (res.statusCode !== 200) {
                reject(new Error(json.message || `CLOVA OCR 오류: HTTP ${res.statusCode}`));
                return;
              }
              const text = json.images?.[0]?.fields?.map(f => f.inferText).join(' ') || '';
              if (!text.trim()) reject(new Error('텍스트가 추출되지 않았습니다.'));
              else resolve(text);
            } catch (e) {
              reject(new Error('CLOVA OCR 응답 파싱 실패'));
            }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('CLOVA OCR 시간 초과')); });
        req.write(body);
        req.end();
      });
    },
  },
};

// ════════════════════════════════════════
// 엔진 설정 캐시 (DB 조회 최소화)
// ════════════════════════════════════════

let engineCache = null;
let cacheTime = 0;
const CACHE_TTL = 60000; // 1분

function invalidateCache() {
  engineCache = null;
  cacheTime = 0;
}

/**
 * DB에서 엔진 설정 조회 (캐시 적용)
 * DB 테이블이 없으면 기본 우선순위 반환
 */
async function getEngineConfig() {
  if (engineCache && Date.now() - cacheTime < CACHE_TTL) {
    return engineCache;
  }

  try {
    const result = await query(
      'SELECT engine_id, is_enabled, priority_order FROM ocr_engine_config ORDER BY priority_order'
    );
    if (result.rows.length > 0) {
      engineCache = result.rows;
      cacheTime = Date.now();
      return engineCache;
    }
  } catch {
    // 테이블이 없는 경우 — 기본값 사용
  }

  // 기본 우선순위 (DB 없을 때)
  const defaults = [
    { engine_id: 'upstage-ocr', is_enabled: true, priority_order: 1 },
    { engine_id: 'gemini-vision', is_enabled: true, priority_order: 2 },
    { engine_id: 'claude-vision', is_enabled: true, priority_order: 3 },
    { engine_id: 'openai-vision', is_enabled: true, priority_order: 4 },
  ];
  engineCache = defaults;
  cacheTime = Date.now();
  return defaults;
}

/**
 * 설정 UI용 엔진 목록 반환
 * ALL_ENGINES에 정의된 모든 엔진을 항상 반환 (DB에 없어도 표시)
 * 각 엔진의 상태(사용 가능 여부, 활성/비활성, 우선순위)를 포함
 */
async function getEngineList() {
  // DB에서 저장된 설정 조회
  let dbConfig = [];
  try {
    const result = await query(
      'SELECT engine_id, is_enabled, priority_order FROM ocr_engine_config ORDER BY priority_order'
    );
    dbConfig = result.rows || [];
  } catch {
    // 테이블 없음 — 무시
  }

  const configMap = {};
  for (const c of dbConfig) {
    configMap[c.engine_id] = c;
  }

  // ALL_ENGINES 기준으로 전체 목록 생성 (DB에 없는 엔진도 항상 포함)
  const engineIds = Object.keys(ALL_ENGINES);
  const defaultOrders = { 'upstage-ocr': 1, 'gemini-vision': 2, 'claude-vision': 3, 'openai-vision': 4, 'naver-clova': 5, 'ocr-space': 6, 'aws-textract': 7 };

  const result = engineIds.map(id => {
    const engine = ALL_ENGINES[id];
    const conf = configMap[id] || { is_enabled: true, priority_order: defaultOrders[id] || 99 };
    return {
      engine_id: id,
      name: engine.name,
      description: engine.description,
      provider: engine.provider,
      envKey: engine.envKey,
      free: engine.free || false,
      is_available: engine.isAvailable(),
      is_enabled: conf.is_enabled !== false,
      priority_order: conf.priority_order,
    };
  });

  // 우선순위 순 정렬
  result.sort((a, b) => a.priority_order - b.priority_order);
  return result;
}

/**
 * OCR 실행 — 우선순위대로 엔진 시도, 실패 시 자동 폴백
 * @param {string} base64 - 이미지 base64 데이터
 * @param {string} mediaType - MIME 타입 (image/jpeg 등)
 * @param {string} prompt - OCR 프롬프트
 * @returns {Promise<{text: string, engine: string, fallbackUsed: boolean}>}
 */
async function runOcr(base64, mediaType, prompt) {
  const config = await getEngineConfig();

  // 활성화 + 사용 가능한 엔진만 우선순위 순으로 필터
  const activeEngines = config
    .filter(c => c.is_enabled && ALL_ENGINES[c.engine_id]?.isAvailable())
    .sort((a, b) => a.priority_order - b.priority_order);

  if (activeEngines.length === 0) {
    throw new Error('사용 가능한 OCR 엔진이 없습니다. 관리 탭에서 엔진 설정을 확인해주세요.');
  }

  let lastError = null;
  for (let i = 0; i < activeEngines.length; i++) {
    const { engine_id } = activeEngines[i];
    const engine = ALL_ENGINES[engine_id];
    try {
      console.log(`[OCR] ${engine.name} 시도 중...`);
      const text = await engine.execute(base64, mediaType, prompt);
      return {
        text,
        engine: engine_id,
        fallbackUsed: i > 0, // 첫 번째가 아니면 폴백 사용
      };
    } catch (err) {
      console.warn(`[OCR] ${engine.name} 실패: ${err.message}`);
      lastError = err;
    }
  }

  throw new Error(`모든 OCR 엔진이 실패했습니다. 마지막 오류: ${lastError?.message}`);
}

module.exports = {
  ALL_ENGINES,
  getEngineList,
  getEngineConfig,
  runOcr,
  invalidateCache,
};
