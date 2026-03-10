// CORS + 보안 헤더 공통 헬퍼
// 모든 API 핸들러에서 호출하여 중복 제거 + 도메인 제한

// 허용 도메인 목록 (환경변수로 설정 가능)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

// 기본 허용 도메인 (Vercel + 로컬)
const DEFAULT_ORIGINS = [
  'https://docstore-eight.vercel.app',
  'http://localhost:3001',
  'http://localhost:3000',
];

/**
 * CORS + 보안 헤더 설정
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {object} options - { methods: 'GET, POST' }
 * @returns {boolean} true면 OPTIONS 요청이므로 핸들러 종료 필요
 */
function setCors(req, res, options = {}) {
  const { methods = 'GET, POST, OPTIONS' } = options;
  const origin = req.headers.origin || '';

  // 허용 도메인 체크
  const allowed = [...DEFAULT_ORIGINS, ...ALLOWED_ORIGINS];
  if (allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    // 같은 도메인 요청 (Vercel 서버리스 내부 호출 등)
    res.setHeader('Access-Control-Allow-Origin', DEFAULT_ORIGINS[0]);
  }
  // 허용되지 않은 도메인이면 CORS 헤더를 설정하지 않음 → 브라우저가 차단

  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400'); // preflight 캐시 24시간

  // 보안 헤더
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // OPTIONS preflight 처리
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }

  return false;
}

module.exports = { setCors };
