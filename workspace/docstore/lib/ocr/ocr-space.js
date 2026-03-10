// OCR.space 무료 OCR 플러그인
// 일 500건 / 월 25,000건 무료, 한국어 지원
const https = require('https');

module.exports = {
  id: 'ocr-space',
  name: 'OCR.space (무료)',
  provider: 'ocr-space',
  envKey: 'OCR_SPACE_API_KEY',
  free: true,
  bestFor: ['general', 'korean', 'document'],
  description: '무료 일500건, 한국어 지원, REST API',

  isAvailable() {
    return !!(process.env.OCR_SPACE_API_KEY || '').trim();
  },

  async execute(base64, mediaType, prompt) {
    const apiKey = (process.env.OCR_SPACE_API_KEY || '').trim();

    // 프롬프트에서 언어 힌트 추출
    const isKorean = /한국|korean|추출|문제|보기/i.test(prompt);
    const language = isKorean ? 'kor' : 'eng';

    // OCR.space는 multipart/form-data로 전송
    const boundary = `----FormBoundary${Date.now()}`;
    const parts = [];

    // base64 이미지 데이터
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="base64Image"\r\n\r\ndata:${mediaType};base64,${base64}`);
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${language}`);
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="isOverlayRequired"\r\n\r\nfalse`);
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="OCREngine"\r\n\r\n1`);
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="scale"\r\n\r\ntrue`);
    parts.push(`--${boundary}--`);

    const body = parts.join('\r\n');

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.ocr.space',
        path: '/parse/image',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'apikey': apiKey,
        },
        timeout: 30000,
      }, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString('utf8');
          try {
            const parsed = JSON.parse(data);

            // 에러 체크
            if (parsed.IsErroredOnProcessing) {
              const errMsg = parsed.ErrorMessage?.join(', ') || 'OCR.space 처리 에러';
              reject(new Error(errMsg));
              return;
            }

            // 결과 추출
            const results = parsed.ParsedResults || [];
            const text = results
              .map(r => r.ParsedText || '')
              .join('\n')
              .trim();

            if (!text) {
              reject(new Error('텍스트가 추출되지 않았습니다.'));
              return;
            }

            resolve(text);
          } catch {
            reject(new Error('OCR.space 응답 파싱 실패'));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('OCR.space 타임아웃')); });
      req.write(body);
      req.end();
    });
  },
};
