// PDF 로더 플러그인: pdfjs-dist (PDF.js)
// Mozilla의 PDF.js 라이브러리 — 텍스트 위치/좌표 정보로 레이아웃 복원 가능
const path = require('path');

module.exports = {
  id: 'pdfjs',
  name: 'PDF.js (pdfjs-dist)',
  type: 'node',
  description: '텍스트 위치/좌표 기반 레이아웃 복원',
  bestFor: ['레이아웃 복원', '좌표 기반 추출'],
  envKey: null,
  free: true,

  isAvailable() {
    try {
      require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
      return true;
    } catch {
      return false;
    }
  },

  /**
   * PDF.js로 페이지별 텍스트 추출
   * 텍스트 아이템의 좌표를 활용하여 레이아웃을 더 정확하게 복원
   * @param {Buffer} pdfBuffer - PDF 파일 버퍼
   * @returns {{ pages: Array, totalPages: number, fullText: string }}
   */
  async extract(pdfBuffer) {
    // pdfjs-dist의 legacy 빌드 사용 (Node.js 호환)
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

    // ArrayBuffer로 변환하여 PDF 문서 로드
    const uint8Array = new Uint8Array(pdfBuffer);
    const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
    const doc = await loadingTask.promise;

    const totalPages = doc.numPages;
    const pages = [];
    const allTexts = [];

    // 각 페이지에서 텍스트 콘텐츠 추출
    for (let i = 1; i <= totalPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();

      // 텍스트 아이템들을 Y좌표 기준으로 그룹핑하여 줄 단위로 조합
      const lines = groupTextItemsByLine(textContent.items);
      const pageText = lines.join('\n');

      pages.push({
        pageNumber: i,
        text: pageText.trim(),
        isImagePage: pageText.trim().length < 50,
        method: 'pdfjs',
      });

      allTexts.push(pageText);
    }

    return {
      pages,
      totalPages,
      fullText: allTexts.join('\n\n'),
    };
  },
};

/**
 * 텍스트 아이템들을 Y좌표 기준으로 그룹핑하여 줄 단위로 조합
 * PDF.js의 텍스트 아이템은 각각 위치(transform)와 텍스트(str)를 가짐
 * 같은 Y좌표(±2px)에 있는 아이템들을 한 줄로 묶고, X좌표 순으로 정렬
 */
function groupTextItemsByLine(items) {
  if (!items || items.length === 0) return [];

  // Y좌표 기준으로 그룹핑 (transform[5]가 Y좌표)
  const lineMap = new Map();
  const Y_TOLERANCE = 2; // 2px 이내는 같은 줄로 판단

  for (const item of items) {
    if (!item.str || !item.transform) continue;

    const y = Math.round(item.transform[5] / Y_TOLERANCE) * Y_TOLERANCE;
    const x = item.transform[4];

    if (!lineMap.has(y)) {
      lineMap.set(y, []);
    }
    lineMap.get(y).push({ x, text: item.str });
  }

  // Y좌표 내림차순 정렬 (PDF는 아래→위 좌표계이므로 큰 Y가 먼저)
  const sortedYs = [...lineMap.keys()].sort((a, b) => b - a);

  // 각 줄 내에서 X좌표 오름차순 정렬 후 텍스트 결합
  return sortedYs.map(y => {
    const items = lineMap.get(y).sort((a, b) => a.x - b.x);
    return items.map(i => i.text).join('');
  });
}
