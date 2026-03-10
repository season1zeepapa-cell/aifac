// Gemini API 공통 호출 모듈
// 모델명·엔드포인트를 한 곳에서 관리하여 변경 시 1곳만 수정
const https = require('https');

// ── 모델 설정 (변경 시 이 상수만 수정) ──
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Gemini API 텍스트 생성 호출
 * @param {string} prompt - 프롬프트 텍스트
 * @param {object} options - 선택 옵션
 * @param {number} options.maxTokens - 최대 출력 토큰 (기본 1024)
 * @param {number} options.temperature - 생성 온도 (기본 0.2)
 * @param {number} options.timeout - 요청 타임아웃 ms (기본 30000)
 * @param {string} options.apiKey - API 키 (미지정 시 환경변수 사용)
 * @returns {Promise<string>} 생성된 텍스트 (trim 적용)
 */
function callGemini(prompt, options = {}) {
  const apiKey = options.apiKey || (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return Promise.reject(new Error('GEMINI_API_KEY 미설정'));

  const {
    maxTokens = 1024,
    temperature = 0.2,
    timeout = 30000,
  } = options;

  const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  });

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode !== 200) {
            reject(new Error(parsed.error?.message || `Gemini API ${res.statusCode}`));
            return;
          }
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
          resolve(text.trim());
        } catch {
          reject(new Error('Gemini 응답 파싱 실패'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Gemini 요청 타임아웃')); });
    req.write(body);
    req.end();
  });
}

module.exports = { callGemini, GEMINI_MODEL };
