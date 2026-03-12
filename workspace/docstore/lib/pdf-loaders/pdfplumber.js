// PDF 로더 플러그인: PDFPlumber
// 표 추출 최강, 한글 PDF에 최적화
const { callPythonLoader, isPythonAvailable, isPythonPackageAvailable } = require('./python-bridge');

module.exports = {
  id: 'pdfplumber',
  name: 'PDFPlumber',
  type: 'python',
  description: '표 추출 최강, 한글 최적화',
  bestFor: ['표', '한글 PDF'],
  envKey: null,
  free: true,

  isAvailable() {
    return isPythonAvailable() && isPythonPackageAvailable('pdfplumber');
  },

  async extract(pdfBuffer) {
    return callPythonLoader('pdfplumber', pdfBuffer);
  },
};
