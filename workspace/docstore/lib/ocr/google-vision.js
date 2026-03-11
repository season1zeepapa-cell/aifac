// Google Cloud Vision OCR 플러그인
// 전 세계 최고 수준의 인식률, 필기체 지원
const https = require('https');

module.exports = {
  id: 'google-vision',
  name: 'Google Cloud Vision',
  provider: 'google-vision',
  envKey: 'GOOGLE_VISION_API_KEY',
  free: false,
  bestFor: ['general', 'handwriting', 'multilang'],
  description: '최고 정확도, 필기체/다국어 인식',

  isAvailable() {
    return !!(process.env.GOOGLE_VISION_API_KEY || '').trim();
  },

  async execute(base64, mediaType, prompt) {
    const apiKey = process.env.GOOGLE_VISION_API_KEY;
    const url = 'https://vision.googleapis.com/v1/images:annotate';

    const body = JSON.stringify({
      requests: [{
        image: { content: base64 },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
        imageContext: { languageHints: ['ko', 'en'] },
      }],
    });

    return new Promise((resolve, reject) => {
      const parsed = new URL(`${url}?key=${apiKey}`);
      const req = https.request({
        hostname: parsed.hostname,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      }, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString('utf8');
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode !== 200) {
              reject(new Error(parsed.error?.message || `Google Vision ${res.statusCode}`));
              return;
            }
            const annotation = parsed.responses?.[0]?.fullTextAnnotation;
            const text = annotation?.text || '';
            resolve(text.trim());
          } catch {
            reject(new Error('Google Vision 응답 파싱 실패'));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Google Vision 타임아웃')); });
      req.write(body);
      req.end();
    });
  },
};
