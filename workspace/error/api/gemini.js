// Vercel 서버리스 함수 - Gemini API 프록시 (SSE 스트리밍 지원)
const SYSTEM_PROMPT =
  '당신은 영상정보관리사 자격증 시험 전문 강사입니다. 주어진 문제를 분석하고 다음 형식으로 답변해주세요:\n\n' +
  '**정답**: [번호 및 내용]\n\n' +
  '**해설**: [상세한 해설]\n\n' +
  '**핵심 키워드**: [관련 법령, 용어 등]';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const ALLOWED_MODELS = [
  // Gemini 3.x
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
  // Gemini 2.5
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  // Gemini 2.0
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];
// Thinking 지원 모델
const THINKING_MODELS = ['gemini-3', 'gemini-2.5'];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용됩니다.' });

  try {
    const { text, imageBase64, mimeType, model, temperature, thinkingBudget, thinkingLevel, stream: useStream } = req.body;
    // 허용된 모델만 사용 (화이트리스트)
    const selectedModel = ALLOWED_MODELS.includes(model) ? model : DEFAULT_MODEL;
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' });

    // 파트 구성: 텍스트 + (선택적) 이미지
    const parts = [{ text: SYSTEM_PROMPT + '\n\n' + text }];
    if (imageBase64) {
      parts.push({ inline_data: { mime_type: mimeType || 'image/png', data: imageBase64 } });
    }

    // generationConfig 구성
    const generationConfig = {};
    if (temperature !== undefined && temperature !== null) {
      generationConfig.temperature = parseFloat(temperature);
    }
    // Thinking 설정: Gemini 3.x -> thinking_level, Gemini 2.5 -> thinkingBudget
    const isGemini3 = selectedModel.startsWith('gemini-3');
    const supportsThinking = THINKING_MODELS.some(prefix => selectedModel.startsWith(prefix));
    if (supportsThinking) {
      if (isGemini3 && thinkingLevel && ['low', 'medium', 'high'].includes(thinkingLevel)) {
        generationConfig.thinkingConfig = { thinkingLevel: thinkingLevel };
      } else if (!isGemini3) {
        const budget = parseInt(thinkingBudget) || 0;
        if (budget > 0) {
          generationConfig.thinkingConfig = { thinkingBudget: budget };
        }
      }
    }

    const reqBody = { contents: [{ parts }] };
    if (Object.keys(generationConfig).length > 0) reqBody.generationConfig = generationConfig;

    // ── 스트리밍 모드 ──
    if (useStream) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:streamGenerateContent?alt=sse&key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData?.error?.message || `HTTP ${response.status}`);
      }

      // Gemini SSE 스트림을 파싱하여 텍스트 청크만 전달
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE 이벤트 파싱: "data: {...}\n\n" 형식
        const lines = buffer.split('\n');
        buffer = '';
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.startsWith('data: ')) {
            try {
              const json = JSON.parse(line.slice(6));
              const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) {
                res.write(`data: ${JSON.stringify({ t: text })}\n\n`);
              }
            } catch (_) {
              // 불완전한 JSON -> 버퍼에 다시 저장
              buffer = lines.slice(i).join('\n');
              break;
            }
          }
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // ── 일반 모드 (하위 호환) ──
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || `HTTP ${response.status}`);
    }

    const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text || '응답 없음';
    res.json({ answer });
  } catch (err) {
    console.error('Gemini API 에러:', err);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: err.message });
    }
  }
};
