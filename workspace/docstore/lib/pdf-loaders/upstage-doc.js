// PDF 로더 플러그인: Upstage Document Parse
// 표/차트/수식까지 구조화 추출 가능한 유료 API
// 기존 api/ocr.js의 callUpstageOcr() 패턴 재사용
const https = require('https');

module.exports = {
  id: 'upstage-doc',
  name: 'Upstage Document Parse',
  type: 'api',
  description: '표/차트/수식 구조화 추출 (유료 API)',
  bestFor: ['표', '차트', '수식', '구조화'],
  envKey: 'UPSTAGE_API_KEY',
  free: false,

  isAvailable() {
    return !!process.env.UPSTAGE_API_KEY;
  },

  /**
   * Upstage Document Parse API로 PDF 텍스트 추출
   * @param {Buffer} pdfBuffer - PDF 파일 버퍼
   * @returns {{ pages: Array, totalPages: number, fullText: string }}
   */
  async extract(pdfBuffer) {
    const apiKey = process.env.UPSTAGE_API_KEY;
    if (!apiKey) {
      throw new Error('UPSTAGE_API_KEY 환경변수가 설정되지 않았습니다.');
    }

    const result = await callUpstageDocParse(pdfBuffer, apiKey);

    // Upstage API 응답에서 페이지별 텍스트 추출
    const pages = [];
    let fullText = '';

    if (result.pages && Array.isArray(result.pages)) {
      // 페이지별 결과가 있는 경우
      for (let i = 0; i < result.pages.length; i++) {
        const pageData = result.pages[i];
        const text = pageData.text || '';
        pages.push({
          pageNumber: i + 1,
          text: text.trim(),
          isImagePage: text.trim().length < 50,
          method: 'upstage-doc',
        });
      }
      fullText = pages.map(p => p.text).join('\n\n');
    } else if (result.text) {
      // 전체 텍스트만 있는 경우 — 페이지 분리 시도
      fullText = result.text;
      const rawPages = fullText.split('\f');
      for (let i = 0; i < rawPages.length; i++) {
        pages.push({
          pageNumber: i + 1,
          text: rawPages[i].trim(),
          isImagePage: rawPages[i].trim().length < 50,
          method: 'upstage-doc',
        });
      }
    } else if (result.content && result.content.text) {
      // content.text 형식 (document-digitization 응답)
      fullText = result.content.text;
      const rawPages = fullText.split('\f');
      for (let i = 0; i < rawPages.length; i++) {
        pages.push({
          pageNumber: i + 1,
          text: rawPages[i].trim(),
          isImagePage: rawPages[i].trim().length < 50,
          method: 'upstage-doc',
        });
      }
    }

    return {
      pages: pages.length > 0 ? pages : [{ pageNumber: 1, text: fullText, isImagePage: false, method: 'upstage-doc' }],
      totalPages: pages.length || 1,
      fullText,
    };
  },
};

/**
 * Upstage Document Parse API 호출
 * multipart/form-data로 PDF 전송
 */
function callUpstageDocParse(pdfBuffer, apiKey) {
  return new Promise((resolve, reject) => {
    const boundary = `----FormBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;

    // document 필드 (PDF 파일)
    const fileHeader = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="document"; filename="document.pdf"\r\n` +
      `Content-Type: application/pdf\r\n\r\n`
    );
    // model 필드
    const modelField = Buffer.from(
      `\r\n--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n` +
      `document-parse`
    );
    const ending = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([fileHeader, pdfBuffer, modelField, ending]);

    const options = {
      hostname: 'api.upstage.ai',
      path: '/v1/document-digitization',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      timeout: 120000,
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');
        try {
          const json = JSON.parse(data);
          if (res.statusCode !== 200) {
            reject(new Error(json.message || json.error || `Upstage API 오류: HTTP ${res.statusCode}`));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error(`Upstage API 응답 파싱 실패: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Upstage Document Parse API 요청 시간 초과 (120초)'));
    });

    req.write(body);
    req.end();
  });
}
