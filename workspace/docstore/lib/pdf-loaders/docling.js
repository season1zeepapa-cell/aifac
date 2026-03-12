// PDF 로더 플러그인: Docling (IBM)
// 문서 이해 AI 기반 구조화 추출
const { callPythonLoader, isPythonAvailable, isPythonPackageAvailable } = require('./python-bridge');

module.exports = {
  id: 'docling',
  name: 'Docling (IBM)',
  type: 'python',
  description: '문서 이해 AI, 구조화 추출',
  bestFor: ['구조화', 'AI 분석'],
  envKey: null,
  free: true,

  isAvailable() {
    return isPythonAvailable() && isPythonPackageAvailable('docling');
  },

  async extract(pdfBuffer) {
    return callPythonLoader('docling', pdfBuffer);
  },
};
