// Vercel 서버리스 함수 - OpenAI API 프록시 (SSE 스트리밍)
const OpenAI = require('openai');

const SYSTEM_PROMPT =
  '당신은 영상정보관리사 자격증 시험 전문 강사입니다. 주어진 문제를 분석하고 다음 형식으로 답변해주세요:\n\n' +
  '**정답**: [번호 및 내용]\n\n' +
  '**해설**: [상세한 해설]\n\n' +
  '**핵심 키워드**: [관련 법령, 용어 등]';

const DEFAULT_MODEL = 'gpt-4o';
const ALLOWED_MODELS = [
  // GPT-5.4 (최신 플래그십)
  'gpt-5.4',
  // GPT-5.3 (ChatGPT 최신)
  'gpt-5.3-chat-latest',
  // GPT-5.x
  'gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano',
  // o-시리즈
  'o3-pro', 'o4-mini', 'o3', 'o3-mini', 'o1-mini', 'o1',
  // GPT-4.1 / GPT-4o
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
  'gpt-4o', 'gpt-4o-mini',
];
// o-시리즈 + GPT-5.4: temperature 미지원, reasoning_effort 지원
const O_SERIES = ['gpt-5.4', 'o3-pro', 'o4-mini', 'o3', 'o3-mini', 'o1-mini', 'o1'];
// GPT-5 계열: max_tokens 대신 max_completion_tokens 사용
const GPT5_SERIES = ['gpt-5.3-chat-latest', 'gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano'];

module.exports = async (req, res) => {
  // CORS 허용
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  }

  try {
    const { text, imageBase64, mimeType, model, temperature, reasoningEffort, stream: useStream } = req.body;
    // 허용된 모델만 사용 (화이트리스트)
    const selectedModel = ALLOWED_MODELS.includes(model) ? model : DEFAULT_MODEL;
    const isOSeries = O_SERIES.includes(selectedModel);
    const isGPT5 = GPT5_SERIES.includes(selectedModel);
    const apiKey = (process.env.OPENAI_API_KEY || '').trim();

    if (!apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY가 설정되지 않았습니다.' });
    }

    const openai = new OpenAI({ apiKey });

    const userContent = imageBase64
      ? [
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType || 'image/png'};base64,${imageBase64}` },
          },
          { type: 'text', text },
        ]
      : text;

    // 완성 파라미터 구성
    const completionParams = {
      model: selectedModel,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    };

    if (isOSeries) {
      if (reasoningEffort && ['low', 'medium', 'high', 'xhigh'].includes(reasoningEffort)) {
        completionParams.reasoning_effort = reasoningEffort;
      }
      delete completionParams.max_tokens;
      completionParams.max_completion_tokens = 4000;
    } else if (isGPT5) {
      delete completionParams.max_tokens;
      completionParams.max_completion_tokens = 2000;
      if (temperature !== undefined && temperature !== null) {
        completionParams.temperature = parseFloat(temperature);
      }
    } else {
      if (temperature !== undefined && temperature !== null) {
        completionParams.temperature = parseFloat(temperature);
      }
    }

    // ── 스트리밍 모드 ──
    if (useStream) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      completionParams.stream = true;
      const stream = await openai.chat.completions.create(completionParams);

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          res.write(`data: ${JSON.stringify({ t: delta })}\n\n`);
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // ── 일반 모드 (하위 호환) ──
    const completion = await openai.chat.completions.create(completionParams);
    const answer = completion.choices[0].message.content;
    res.json({ answer });
  } catch (err) {
    console.error('OpenAI API 에러:', err);
    // 스트리밍 중 에러 시 SSE 형식으로 전송
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: err.message });
    }
  }
};
