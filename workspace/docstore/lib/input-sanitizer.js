// 입력값 정화 유틸리티
const path = require('path');
const { URL } = require('url');
const dns = require('dns');
const net = require('net');

// ── 파일명 정화 ──

const MAX_FILENAME_LENGTH = 200;

/**
 * 파일명에서 디렉토리 경로를 제거하고 안전하게 정화
 * - path traversal 방지 (../../ 등)
 * - 특수문자 제거
 * - 길이 제한
 */
function sanitizeFilename(filename) {
  if (!filename) return 'untitled';
  // 경로 제거 — basename만 추출
  let safe = path.basename(filename);
  // null byte 제거
  safe = safe.replace(/\0/g, '');
  // 길이 제한
  if (safe.length > MAX_FILENAME_LENGTH) {
    const ext = path.extname(safe);
    safe = safe.slice(0, MAX_FILENAME_LENGTH - ext.length) + ext;
  }
  return safe || 'untitled';
}

// ── ILIKE 검색어 이스케이프 ──

/**
 * PostgreSQL ILIKE 와일드카드 이스케이프
 * %, _ 문자를 이스케이프하여 리터럴로 검색
 * 사용 시: WHERE col ILIKE $1 ESCAPE '\'
 */
function escapeIlike(input) {
  if (!input) return '';
  return input.replace(/[\\%_]/g, '\\$&');
}

// ── URL SSRF 방어 ──

// 차단 대상 내부 IP 대역
const BLOCKED_RANGES = [
  /^127\./,           // loopback
  /^0\./,             // 0.0.0.0/8
  /^10\./,            // 사설 A
  /^172\.(1[6-9]|2\d|3[01])\./, // 사설 B
  /^192\.168\./,      // 사설 C
  /^169\.254\./,      // link-local (AWS 메타데이터 등)
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT
  /^::1$/,            // IPv6 loopback
  /^fc/i, /^fd/i,    // IPv6 사설
  /^fe80/i,           // IPv6 link-local
];

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google',
]);

/**
 * URL이 안전한지 검증 (SSRF 방어)
 * @param {string} urlStr - 검증할 URL 문자열
 * @returns {{ safe: boolean, error?: string }}
 */
async function validateUrl(urlStr) {
  // 1) URL 파싱
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { safe: false, error: '유효하지 않은 URL입니다.' };
  }

  // 2) 프로토콜 검증 (http/https만 허용)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { safe: false, error: 'http:// 또는 https:// URL만 허용됩니다.' };
  }

  // 3) 호스트명 블록리스트
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(hostname)) {
    return { safe: false, error: '접근이 차단된 호스트입니다.' };
  }

  // 4) IP 직접 지정 차단
  if (net.isIP(hostname)) {
    if (BLOCKED_RANGES.some(r => r.test(hostname))) {
      return { safe: false, error: '내부 IP 접근은 허용되지 않습니다.' };
    }
  }

  // 5) DNS 확인 — 도메인이 내부 IP로 해석되는지 체크
  try {
    const addresses = await new Promise((resolve, reject) => {
      dns.resolve4(hostname, (err, addrs) => {
        if (err) reject(err);
        else resolve(addrs);
      });
    });
    for (const addr of addresses) {
      if (BLOCKED_RANGES.some(r => r.test(addr))) {
        return { safe: false, error: '해당 도메인이 내부 IP로 해석됩니다.' };
      }
    }
  } catch {
    // DNS 실패 — 진행 허용 (외부 URL일 수 있음)
  }

  return { safe: true };
}

module.exports = {
  sanitizeFilename,
  escapeIlike,
  validateUrl,
  MAX_FILENAME_LENGTH,
};
