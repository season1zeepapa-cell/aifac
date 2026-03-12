// PDF 로더 플러그인: Unstructured
// 레이아웃/요소 분석 기반 정교한 전처리
// 주의: 패키지 크기가 매우 커서 Vercel 서버리스(250MB)에서는 사용 불가 → 로컬 전용
const { callPythonLoader, isPythonAvailable, isPythonPackageAvailable } = require('./python-bridge');

module.exports = {
  id: 'unstructured',
  name: 'Unstructured',
  type: 'python',
  description: '레이아웃/요소 분석, 정교한 전처리 (로컬 전용)',
  bestFor: ['레이아웃', '복합 문서'],
  envKey: null,
  free: true,

  isAvailable() {
    // Vercel 서버리스 환경에서는 패키지 크기 제한(250MB)으로 사용 불가
    if (process.env.VERCEL) return false;
    return isPythonAvailable() && isPythonPackageAvailable('unstructured');
  },

  async extract(pdfBuffer) {
    return callPythonLoader('unstructured', pdfBuffer);
  },
};
