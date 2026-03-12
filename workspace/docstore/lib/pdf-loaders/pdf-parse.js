// PDF 로더 플러그인: pdf-parse
// 기존 pdf-extractor.js에서 분리한 텍스트 추출 로직
// 가볍고 빠르지만, 표/레이아웃 PDF에서는 품질이 떨어짐
const pdfParse = require('pdf-parse');

module.exports = {
  id: 'pdf-parse',
  name: 'pdf-parse',
  type: 'node',
  description: '기본 PDF 텍스트 추출 (가볍고 빠름)',
  bestFor: ['텍스트 PDF', '빠른 처리'],
  envKey: null,
  free: true,

  // pdf-parse는 npm 의존성이므로 항상 사용 가능
  isAvailable() {
    try {
      require.resolve('pdf-parse');
      return true;
    } catch {
      return false;
    }
  },

  /**
   * PDF 버퍼에서 텍스트 추출
   * @param {Buffer} pdfBuffer - PDF 파일 버퍼
   * @returns {{ pages: Array, totalPages: number, fullText: string }}
   */
  async extract(pdfBuffer) {
    const parsed = await pdfParse(pdfBuffer);
    const totalPages = parsed.numpages;

    // 페이지 분리: pdf-parse는 form feed(\f) 문자로 페이지를 구분
    const rawPages = parsed.text.split('\f');

    const pages = rawPages.map((text, index) => ({
      pageNumber: index + 1,
      text: text.trim(),
      // 텍스트가 50자 미만이면 이미지 페이지로 판단
      isImagePage: text.trim().length < 50,
      method: 'pdf-parse',
    }));

    return {
      pages,
      totalPages,
      fullText: parsed.text,
    };
  },
};
