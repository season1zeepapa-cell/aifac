// PDF 로더 플러그인: Unstructured
// 레이아웃/요소 분석 기반 정교한 전처리
const { callPythonLoader, isPythonAvailable, isPythonPackageAvailable } = require('./python-bridge');

module.exports = {
  id: 'unstructured',
  name: 'Unstructured',
  type: 'python',
  description: '레이아웃/요소 분석, 정교한 전처리',
  bestFor: ['레이아웃', '복합 문서'],
  envKey: null,
  free: true,

  isAvailable() {
    return isPythonAvailable() && isPythonPackageAvailable('unstructured');
  },

  async extract(pdfBuffer) {
    return callPythonLoader('unstructured', pdfBuffer);
  },
};
