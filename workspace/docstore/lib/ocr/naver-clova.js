// Naver CLOVA OCR 플러그인
// 한국어 문서, 영수증, 공문서에 최적화
const https = require('https');

module.exports = {
  id: 'naver-clova',
  name: 'Naver CLOVA OCR',
  provider: 'naver',
  envKey: 'CLOVA_OCR_SECRET',
  free: false,
  bestFor: ['korean', 'receipt', 'document'],
  description: '한국어 최강, 영수증/공문서 특화',

  isAvailable() {
    return !!(process.env.CLOVA_OCR_SECRET || '').trim() &&
           !!(process.env.CLOVA_OCR_URL || '').trim();
  },

  async execute(base64, mediaType, prompt) {
    const apiUrl = process.env.CLOVA_OCR_URL;
    const secret = process.env.CLOVA_OCR_SECRET;

    const body = JSON.stringify({
      version: 'V2',
      requestId: `docstore-${Date.now()}`,
      timestamp: Date.now(),
      lang: 'ko',
      images: [{
        format: mediaType.split('/')[1] || 'png',
        data: base64,
        name: 'image',
      }],
    });

    return new Promise((resolve, reject) => {
      const parsed = new URL(apiUrl);
      const req = https.request({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OCR-SECRET': secret,
        },
        timeout: 30000,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode !== 200) {
              reject(new Error(parsed.message || `CLOVA OCR ${res.statusCode}`));
              return;
            }
            // CLOVA OCR 응답에서 텍스트 추출
            const fields = parsed.images?.[0]?.fields || [];
            const text = fields.map(f => f.inferText).join(' ');
            resolve(text.trim());
          } catch {
            reject(new Error('CLOVA OCR 응답 파싱 실패'));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('CLOVA OCR 타임아웃')); });
      req.write(body);
      req.end();
    });
  },
};
