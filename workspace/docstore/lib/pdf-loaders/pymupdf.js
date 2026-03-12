// PDF 로더 플러그인: PyMuPDF (fitz)
// 가장 빠른 PDF 처리 라이브러리, 대용량 문서에 최적
const { callPythonLoader, isPythonAvailable, isPythonPackageAvailable } = require('./python-bridge');

module.exports = {
  id: 'pymupdf',
  name: 'PyMuPDF (fitz)',
  type: 'python',
  description: '가장 빠름, 대용량 문서 최적',
  bestFor: ['대용량', '속도'],
  envKey: null,
  free: true,

  isAvailable() {
    return isPythonAvailable() && isPythonPackageAvailable('pymupdf');
  },

  async extract(pdfBuffer) {
    return callPythonLoader('pymupdf', pdfBuffer);
  },
};
