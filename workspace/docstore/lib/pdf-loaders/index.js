// PDF 로더 플러그인 레지스트리
// OCR 엔진 매니저(lib/ocr/index.js) 패턴을 재사용
//
// 역할:
// 1. 모든 PDF 로더 플러그인을 등록
// 2. 사용 가능한 로더 목록 조회 (UI용)
// 3. 선택된 로더로 PDF 텍스트 추출 실행

// ── 로더 레지스트리 (8개 플러그인 로드) ──
const ALL_LOADERS = {
  'pdf-parse': require('./pdf-parse'),
  'pdfjs': require('./pdfjs'),
  'upstage-doc': require('./upstage-doc'),
  'pymupdf': require('./pymupdf'),
  'pypdf': require('./pypdf'),
  'pdfplumber': require('./pdfplumber'),
  'unstructured': require('./unstructured'),
  'docling': require('./docling'),
};

// 기본 로더: 항상 사용 가능한 pdf-parse
const DEFAULT_LOADER = 'pdf-parse';

/**
 * 사용 가능한 로더 목록 조회 (UI 드롭다운용)
 * 각 로더의 메타 정보 + 설치/가용 상태를 반환
 * @returns {Array} 로더 목록
 */
function getLoaderList() {
  return Object.values(ALL_LOADERS).map(loader => ({
    id: loader.id,
    name: loader.name,
    type: loader.type,
    description: loader.description,
    bestFor: loader.bestFor,
    envKey: loader.envKey,
    free: loader.free,
    is_available: loader.isAvailable(),
  }));
}

/**
 * 선택된 로더로 PDF 텍스트 추출
 * 로더가 사용 불가능하면 기본 로더(pdf-parse)로 폴백
 *
 * @param {string} loaderId - 로더 ID
 * @param {Buffer} pdfBuffer - PDF 파일 버퍼
 * @param {Object} options - 추출 옵션 (로더별 추가 옵션)
 * @returns {{ pages: Array, totalPages: number, fullText: string }}
 */
async function extractWithLoader(loaderId, pdfBuffer, options = {}) {
  const loader = ALL_LOADERS[loaderId];

  // 로더가 존재하지 않으면 기본 로더로 폴백
  if (!loader) {
    console.warn(`[PDF 로더] 알 수 없는 로더 "${loaderId}" → 기본 로더(pdf-parse) 사용`);
    return ALL_LOADERS[DEFAULT_LOADER].extract(pdfBuffer, options);
  }

  // 로더가 사용 불가능하면 에러 (폴백하지 않음 — 사용자가 의도적으로 선택했으므로)
  if (!loader.isAvailable()) {
    const reason = loader.envKey
      ? `${loader.envKey} 환경변수가 설정되지 않았습니다.`
      : loader.type === 'python'
        ? `Python 또는 ${loader.name} 패키지가 설치되지 않았습니다.`
        : `${loader.name}이(가) 설치되지 않았습니다.`;
    throw new Error(`PDF 로더 "${loader.name}" 사용 불가: ${reason}`);
  }

  console.log(`[PDF 로더] ${loader.name} (${loader.type}) 으로 추출 시작...`);

  try {
    const result = await loader.extract(pdfBuffer, options);
    console.log(`[PDF 로더] ${loader.name} 완료: ${result.totalPages}페이지, ${result.fullText?.length || 0}자`);
    return result;
  } catch (err) {
    console.error(`[PDF 로더] ${loader.name} 실패:`, err.message);
    throw err;
  }
}

module.exports = {
  ALL_LOADERS,
  DEFAULT_LOADER,
  getLoaderList,
  extractWithLoader,
};
