// Gemini Vision OCR 플러그인
const https = require('https');
const { GEMINI_MODEL } = require('../gemini');

module.exports = {
  id: 'gemini-vision',
  name: 'Gemini Vision',
  provider: 'gemini',
  envKey: 'GEMINI_API_KEY',
  free: true,
  bestFor: ['general', 'quiz'],
  description: '무료, 문맥 이해력 우수',

  isAvailable() {
    return !!(process.env.GEMINI_API_KEY || '').trim();
  },

  async execute(base64, mediaType, prompt) {
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
    const body = JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mediaType, data: base64 } },
          { text: prompt },
        ],
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
    });

    return new Promise((resolve, reject) => {
      const req = https.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        timeout: 30000,
      }, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString('utf8');
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode !== 200) {
              reject(new Error(parsed.error?.message || `Gemini ${res.statusCode}`));
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
      req.on('timeout', () => { req.destroy(); reject(new Error('Gemini 타임아웃')); });
      req.write(body);
      req.end();
    });
  },
};
