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
  // Thinking 설정: Gemini 3.x → thinkingLevel, Gemini 2.5 → thinkingBudget
  const isGemini3 = model.startsWith('gemini-3');
  if (isGemini3 && options.thinkingLevel && ['low', 'medium', 'high'].includes(options.thinkingLevel)) {
    genConfig.thinkingConfig = { thinkingLevel: options.thinkingLevel };
  } else if (options.thinkingBudget && options.thinkingBudget > 0) {
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

// o-시리즈 + GPT-5.4: temperature 미지원, reasoning_effort 지원
const O_SERIES = ['gpt-5.4', 'o3-pro', 'o4-mini', 'o3', 'o3-mini', 'o1-mini', 'o1'];
// GPT-5 계열: max_tokens 대신 max_completion_tokens 사용
const GPT5_SERIES = ['gpt-5.3-chat-latest', 'gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano'];

// ── OpenAI 호출 ──
function callOpenAI(prompt, options = {}) {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return Promise.reject(new Error('OPENAI_API_KEY 미설정'));

  const { maxTokens = 1024, temperature = 0.2, timeout = 30000 } = options;
  const model = options.model || LLM_PROVIDERS.openai.model;
  const isOSeries = O_SERIES.includes(model);
  const isGPT5 = GPT5_SERIES.includes(model);

  // 모델별 파라미터 구성
  const params = {
    model,
    messages: [{ role: 'user', content: prompt }],
  };

  if (isOSeries) {
    // o-시리즈: reasoning_effort 사용, temperature 미지원
    const VALID_EFFORT = { low: 'low', medium: 'medium', high: 'high' };
    params.reasoning_effort = VALID_EFFORT[options.reasoningEffort] || 'medium';
    params.max_completion_tokens = maxTokens;
  } else if (isGPT5) {
    // GPT-5 계열: max_completion_tokens 사용
    params.max_completion_tokens = maxTokens;
    params.temperature = temperature;
  } else {
    // 일반 모델: max_tokens + temperature
    params.max_tokens = maxTokens;
    params.temperature = temperature;
  }

  const body = JSON.stringify(params);

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

// ══════════════════════════════════════════════════════
// SSE 스트리밍 호출 함수들
// onToken(textChunk) 콜백을 토큰 도착마다 호출
// ══════════════════════════════════════════════════════

// ── Gemini 스트리밍 ──
// 엔드포인트: streamGenerateContent?alt=sse
// SSE 형식: data: { "candidates": [{ "content": { "parts": [{ "text": "..." }] } }] }
function callGeminiStream(prompt, options = {}, onToken) {
  const apiKey = options.apiKey || (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return Promise.reject(new Error('GEMINI_API_KEY 미설정'));

  const { maxTokens = 1024, temperature = 0.2, timeout = 60000 } = options;
  const model = options.model || GEMINI_MODEL;

  const url = `${GEMINI_BASE_URL}/${model}:streamGenerateContent?alt=sse`;
  const genConfig = { temperature, maxOutputTokens: maxTokens };
  // Thinking 설정: Gemini 3.x → thinkingLevel, Gemini 2.5 → thinkingBudget
  const isGemini3 = model.startsWith('gemini-3');
  if (isGemini3 && options.thinkingLevel && ['low', 'medium', 'high'].includes(options.thinkingLevel)) {
    genConfig.thinkingConfig = { thinkingLevel: options.thinkingLevel };
  } else if (options.thinkingBudget && options.thinkingBudget > 0) {
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
      if (res.statusCode !== 200) {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const errText = Buffer.concat(chunks).toString('utf8');
          try { reject(new Error(JSON.parse(errText).error?.message || `Gemini ${res.statusCode}`)); }
          catch { reject(new Error(`Gemini 스트리밍 오류 ${res.statusCode}`)); }
        });
        return;
      }

      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        // SSE 이벤트 파싱: "data: {...}\n\n" 형식
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 마지막 미완성 줄 보존
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6);
          if (!jsonStr.trim()) continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (text && onToken) onToken(text);
          } catch { /* 파싱 불가 청크 무시 */ }
        }
      });
      res.on('end', () => resolve());
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Gemini 스트리밍 타임아웃')); });
    req.write(body);
    req.end();
  });
}

// ── OpenAI 스트리밍 ──
// stream: true → SSE 형식
// data: { "choices": [{ "delta": { "content": "..." } }] }
// 종료: data: [DONE]
function callOpenAIStream(prompt, options = {}, onToken) {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return Promise.reject(new Error('OPENAI_API_KEY 미설정'));

  const { maxTokens = 1024, temperature = 0.2, timeout = 60000 } = options;
  const model = options.model || LLM_PROVIDERS.openai.model;

  const isOSeries = O_SERIES.includes(model);
  const isGPT5 = GPT5_SERIES.includes(model);

  const params = {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
  };

  if (isOSeries) {
    const VALID_EFFORT = { low: 'low', medium: 'medium', high: 'high' };
    params.reasoning_effort = VALID_EFFORT[options.reasoningEffort] || 'medium';
    params.max_completion_tokens = maxTokens;
  } else if (isGPT5) {
    params.max_completion_tokens = maxTokens;
    params.temperature = temperature;
  } else {
    params.max_tokens = maxTokens;
    params.temperature = temperature;
  }

  const body = JSON.stringify(params);

  return new Promise((resolve, reject) => {
    const req = https.request('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      timeout,
    }, (res) => {
      if (res.statusCode !== 200) {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const errText = Buffer.concat(chunks).toString('utf8');
          try { reject(new Error(JSON.parse(errText).error?.message || `OpenAI ${res.statusCode}`)); }
          catch { reject(new Error(`OpenAI 스트리밍 오류 ${res.statusCode}`)); }
        });
        return;
      }

      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') continue;
          if (!jsonStr) continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const text = parsed.choices?.[0]?.delta?.content || '';
            if (text && onToken) onToken(text);
          } catch { /* 무시 */ }
        }
      });
      res.on('end', () => resolve());
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('OpenAI 스트리밍 타임아웃')); });
    req.write(body);
    req.end();
  });
}

// ── Claude 스트리밍 ──
// stream: true → SSE 형식
// event: content_block_delta → data: { "delta": { "text": "..." } }
// event: message_stop → 종료
function callClaudeStream(prompt, options = {}, onToken) {
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) return Promise.reject(new Error('ANTHROPIC_API_KEY 미설정'));

  const { maxTokens = 1024, temperature = 0.2, timeout = 60000 } = options;
  const model = options.model || LLM_PROVIDERS.claude.model;

  const body = JSON.stringify({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
    temperature,
    stream: true,
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
      if (res.statusCode !== 200) {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const errText = Buffer.concat(chunks).toString('utf8');
          try { reject(new Error(JSON.parse(errText).error?.message || `Claude ${res.statusCode}`)); }
          catch { reject(new Error(`Claude 스트리밍 오류 ${res.statusCode}`)); }
        });
        return;
      }

      let buffer = '';
      let currentEvent = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ') && currentEvent === 'content_block_delta') {
            try {
              const parsed = JSON.parse(line.slice(6));
              const text = parsed.delta?.text || '';
              if (text && onToken) onToken(text);
            } catch { /* 무시 */ }
          }
        }
      });
      res.on('end', () => resolve());
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Claude 스트리밍 타임아웃')); });
    req.write(body);
    req.end();
  });
}

// ── 통합 스트리밍 호출 ──
function callLLMStream(prompt, options = {}, onToken) {
  const provider = options.provider || 'gemini';
  switch (provider) {
    case 'openai': return callOpenAIStream(prompt, options, onToken);
    case 'claude': return callClaudeStream(prompt, options, onToken);
    case 'gemini':
    default: return callGeminiStream(prompt, options, onToken);
  }
}

module.exports = { callGemini, callLLM, callLLMStream, getAvailableProviders, GEMINI_MODEL, LLM_PROVIDERS };
