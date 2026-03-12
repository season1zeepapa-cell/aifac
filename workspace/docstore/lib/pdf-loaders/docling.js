// PDF 로더 플러그인: Docling (IBM)
// 문서 이해 AI 기반 구조화 추출
// 주의: 패키지 크기가 매우 커서 Vercel 서버리스(250MB)에서는 사용 불가 → 로컬 전용
const { callPythonLoader, isPythonAvailable, isPythonPackageAvailable } = require('./python-bridge');

module.exports = {
  id: 'docling',
  name: 'Docling (IBM)',
  type: 'python',
  description: '문서 이해 AI, 구조화 추출 (로컬 전용)',
  bestFor: ['구조화', 'AI 분석'],
  envKey: null,
  free: true,

  isAvailable() {
    // Vercel 서버리스 환경에서는 패키지 크기 제한(250MB)으로 사용 불가
    if (process.env.VERCEL) return false;
    return isPythonAvailable() && isPythonPackageAvailable('docling');
  },

  async extract(pdfBuffer) {
    return callPythonLoader('docling', pdfBuffer);
  },
};
