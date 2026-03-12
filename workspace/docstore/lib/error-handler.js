// 프로덕션 환경에서 내부 에러 메시지 노출 방지
// 개발 환경에서는 디버깅을 위해 상세 메시지 반환

const IS_PROD = process.env.NODE_ENV === 'production' || process.env.VERCEL;

// 사용자에게 보여줄 수 있는 안전한 에러 메시지 패턴
const SAFE_PATTERNS = [
  '허용되지 않는',
  '필요합니다',
  '찾을 수 없',
  '지원하지 않는',
  '유효한',
  '초과',
  '비활성',
  '이미 임포트',
  '추출할 수 없',
  '추출된 내용이 없',
  '설정되지 않',
  '파일이 저장되어 있지 않',
  '사용 가능한 OCR',
  '네이버 API',
  '크롤링',
  '검색 실패',
  '타임아웃',
  'Storage',
  'PDF 로더',
  '다운로드 실패',
  '사용 불가',
];

/**
 * 에러 응답 전송 — 프로덕션에서는 일반 메시지, 개발에서는 상세 메시지
 * @param {object} res - Express response
 * @param {Error} err - 에러 객체
 * @param {string} context - 로그용 컨텍스트 (예: '[Upload]')
 * @param {number} status - HTTP 상태 코드 (기본 500)
 */
function sendError(res, err, context = '', status = 500) {
  // 항상 서버 로그에 상세 기록
  console.error(`${context} 에러:`, err);

  const message = err.message || '';

  // 사용자 입력 오류(400번대)는 상세 메시지 반환
  if (status < 500) {
    return res.status(status).json({ error: message });
  }

  // 안전한 패턴에 해당하면 그대로 반환
  if (SAFE_PATTERNS.some(p => message.includes(p))) {
    return res.status(status).json({ error: message });
  }

  // 프로덕션: 일반 메시지 반환
  if (IS_PROD) {
    return res.status(status).json({ error: '서버 오류가 발생했습니다.' });
  }

  // 개발: 상세 메시지 반환
  return res.status(status).json({ error: message });
}

module.exports = { sendError };
