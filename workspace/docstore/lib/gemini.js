// 멀티 LLM 공통 호출 모듈
// Gemini / OpenAI / Claude 3개 프로바이더 지원
// 모델명·엔드포인트를 한 곳에서 관리
const https = require('https');

// ── 프로바이더별 모델 설정 ──
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const LLM_PROVIDERS = {
  gemini: {
    name: 'Gemini',
    model: GEMINI_MODEL,
    envKey: 'GEMINI_API_KEY',
    free: true,
  },
  openai: {
    name: 'OpenAI',
    model: 'gpt-4o-mini',
    envKey: 'OPENAI_API_KEY',
    free: false,
  },
  claude: {
    name: 'Claude',
    model: 'claude-sonnet-4-20250514',
    envKey: 'ANTHROPIC_API_KEY',
    free: false,
  },
};

// 사용 가능한 프로바이더 목록 반환
function getAvailableProviders() {
  return Object.entries(LLM_PROVIDERS)
    .filter(([, cfg]) => !!(process.env[cfg.envKey] || '').trim())
    .map(([id, cfg]) => ({ id, name: cfg.name, model: cfg.model, free: cfg.free }));
}

// ── Gemini 호출 ──
function callGemini(prompt, options = {}) {
  const apiKey = options.apiKey || (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return Promise.reject(new Error('GEMINI_API_KEY 미설정'));

  const { maxTokens = 1024, temperature = 0.2, timeout = 30000 } = options;
  const model = options.model || GEMINI_MODEL;

  const url = `${GEMINI_BASE_URL}/${model}:generateContent`;
  const genConfig = { temperature, maxOutputTokens: maxTokens };
  // Gemini 2.5 thinking budget 지원
  if (options.thinkingBudget && options.thinkingBudget > 0) {
    genConfig.thinkingConfig = { thinkingBudget: options.thinkingBudget };
  }
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: genConfig,
  });

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      timeout,
    }, (res) => {
      // Buffer 배열로 모아서 한 번에 UTF-8 디코딩 (멀티바이트 문자 깨짐 방지)
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const data = Buffer.concat(chunks).toString('utf8');
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

// ── OpenAI 호출 ──
function callOpenAI(prompt, options = {}) {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return Promise.reject(new Error('OPENAI_API_KEY 미설정'));

  const { maxTokens = 1024, temperature = 0.2, timeout = 30000 } = options;
  const model = options.model || LLM_PROVIDERS.openai.model;

  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature,
    max_tokens: maxTokens,
  });

  return new Promise((resolve, reject) => {
    const req = https.request('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      timeout,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const data = Buffer.concat(chunks).toString('utf8');
          const parsed = JSON.parse(data);
          if (res.statusCode !== 200) {
            reject(new Error(parsed.error?.message || `OpenAI API ${res.statusCode}`));
            return;
          }
          const text = parsed.choices?.[0]?.message?.content || '';
          resolve(text.trim());
        } catch {
          reject(new Error('OpenAI 응답 파싱 실패'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('OpenAI 요청 타임아웃')); });
    req.write(body);
    req.end();
  });
}

// ── Claude 호출 ──
function callClaude(prompt, options = {}) {
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) return Promise.reject(new Error('ANTHROPIC_API_KEY 미설정'));

  const { maxTokens = 1024, temperature = 0.2, timeout = 30000 } = options;
  const model = options.model || LLM_PROVIDERS.claude.model;

  const body = JSON.stringify({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
    temperature,
  });

  return new Promise((resolve, reject) => {
    const req = https.request('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      timeout,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const data = Buffer.concat(chunks).toString('utf8');
          const parsed = JSON.parse(data);
          if (res.statusCode !== 200) {
            reject(new Error(parsed.error?.message || `Claude API ${res.statusCode}`));
            return;
          }
          const text = parsed.content?.[0]?.text || '';
          resolve(text.trim());
        } catch {
          reject(new Error('Claude 응답 파싱 실패'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Claude 요청 타임아웃')); });
    req.write(body);
    req.end();
  });
}

// ── 통합 호출 함수 ──
// provider: 'gemini' | 'openai' | 'claude' (기본: gemini)
function callLLM(prompt, options = {}) {
  const provider = options.provider || 'gemini';
  switch (provider) {
    case 'openai': return callOpenAI(prompt, options);
    case 'claude': return callClaude(prompt, options);
    case 'gemini':
    default: return callGemini(prompt, options);
  }
}

module.exports = { callGemini, callLLM, getAvailableProviders, GEMINI_MODEL, LLM_PROVIDERS };
