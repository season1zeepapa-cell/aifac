// PDF 로더 플러그인: PyPDF
// 가볍고 표준적인 Python PDF 라이브러리, 텍스트 위주 문서에 적합
const { callPythonLoader, isPythonAvailable, isPythonPackageAvailable } = require('./python-bridge');

module.exports = {
  id: 'pypdf',
  name: 'PyPDF',
  type: 'python',
  description: '가볍고 표준적, 텍스트 위주',
  bestFor: ['텍스트 PDF', '가벼운 처리'],
  envKey: null,
  free: true,

  isAvailable() {
    return isPythonAvailable() && isPythonPackageAvailable('pypdf');
  },

  async extract(pdfBuffer) {
    return callPythonLoader('pypdf', pdfBuffer);
  },
};
