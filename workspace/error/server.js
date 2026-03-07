require('dotenv').config();

const express = require('express');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

// 시스템 프롬프트 (Gemini, OpenAI 공통)
const SYSTEM_PROMPT =
  '당신은 영상정보관리사 자격증 시험 전문 강사입니다. 주어진 문제를 분석하고 다음 형식으로 답변해주세요:\n\n' +
  '**정답**: [번호 및 내용]\n\n' +
  '**해설**: [상세한 해설]\n\n' +
  '**핵심 키워드**: [관련 법령, 용어 등]';

// ── 미들웨어 ──────────────────────────────────────────
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname)));

// ── POST /api/gemini ──────────────────────────────────
app.post('/api/gemini', async (req, res) => {
  try {
    const { text, imageBase64, mimeType } = req.body;
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();

    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    // 요청 파트 구성
    const parts = [];

    // 시스템 프롬프트 + 사용자 텍스트
    parts.push({ text: SYSTEM_PROMPT + '\n\n' + text });

    // 이미지가 있으면 인라인 데이터로 추가
    if (imageBase64) {
      parts.push({
        inlineData: {
          mimeType: mimeType || 'image/png',
          data: imageBase64,
        },
      });
    }

    const result = await model.generateContent(parts);
    const response = await result.response;
    const answer = response.text();

    res.json({ answer });
  } catch (err) {
    console.error('Gemini API 에러:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/openai ──────────────────────────────────
app.post('/api/openai', async (req, res) => {
  try {
    const { text, imageBase64, mimeType, model, temperature, reasoningEffort } = req.body;
    const apiKey = (process.env.OPENAI_API_KEY || '').trim();

    if (!apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY가 설정되지 않았습니다.' });
    }

    const openai = new OpenAI({ apiKey });

    // 사용자 메시지 content 구성
    let userContent;

    if (imageBase64) {
      // Vision 형식: 이미지 + 텍스트
      userContent = [
        {
          type: 'image_url',
          image_url: {
            url: `data:${mimeType || 'image/png'};base64,${imageBase64}`,
          },
        },
        { type: 'text', text },
      ];
    } else {
      userContent = text;
    }

    const selectedModel = model || 'gpt-4o';
    const O_SERIES = ['o4-mini', 'o3', 'o3-mini', 'o1-mini', 'o1'];
    const GPT5_SERIES = ['gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano'];
    const isOSeries = O_SERIES.includes(selectedModel);
    const isGPT5 = GPT5_SERIES.includes(selectedModel);

    const completionParams = {
      model: selectedModel,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    };

    if (isOSeries) {
      delete completionParams.max_tokens;
      completionParams.max_completion_tokens = 4000;
      if (reasoningEffort && ['low', 'medium', 'high'].includes(reasoningEffort)) {
        completionParams.reasoning_effort = reasoningEffort;
      }
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

    const completion = await openai.chat.completions.create(completionParams);

    const answer = completion.choices[0].message.content;
    res.json({ answer });
  } catch (err) {
    console.error('OpenAI API 에러:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/signup ─────────────────────────────────
const signupHandler = require('./api/signup');
app.post('/api/signup', (req, res) => signupHandler(req, res));

// ── /api/admin (GET, POST) ──────────────────────────
const adminHandler = require('./api/admin');
app.get('/api/admin', (req, res) => adminHandler(req, res));
app.post('/api/admin', (req, res) => adminHandler(req, res));

// ── /api/questions (GET, POST) ──────────────────────
const questionsHandler = require('./api/questions');
app.get('/api/questions', (req, res) => questionsHandler(req, res));
app.post('/api/questions', (req, res) => questionsHandler(req, res));

// ── /api/explanations (GET, POST) ────────────────────
const explanationsHandler = require('./api/explanations');
app.get('/api/explanations', (req, res) => explanationsHandler(req, res));
app.post('/api/explanations', (req, res) => explanationsHandler(req, res));

// ── /api/memos (GET, POST) ───────────────────────────
const memosHandler = require('./api/memos');
app.get('/api/memos', (req, res) => memosHandler(req, res));
app.post('/api/memos', (req, res) => memosHandler(req, res));

// ── POST /api/law ────────────────────────────────────
const lawHandler = require('./api/law');
app.post('/api/law', (req, res) => lawHandler(req, res));

// ── 서버 시작 / Vercel 서버리스 export ────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`서버 실행 중: http://localhost:${PORT}`);
  });
}

module.exports = app;
