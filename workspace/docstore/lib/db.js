// Supabase PostgreSQL 연결 유틸리티
const { Pool } = require('pg');

// 커넥션 풀 (서버리스 환경에서 재사용)
let pool;

function getPool() {
  if (!pool) {
    // SSL 설정:
    // - Supabase 커넥션 풀러(pgBouncer)는 자체 서명 CA를 사용하므로 기본 false
    // - DB_CA_CERT 환경변수로 CA 인증서를 제공하면 엄격한 검증 활성화 (MITM 방어)
    // - DB_SSL_VERIFY=true 설정 시 기본 CA로 검증 시도 (Let's Encrypt 등)
    const sslConfig = { rejectUnauthorized: false };
    if (process.env.DB_CA_CERT) {
      // CA 인증서가 제공된 경우: 엄격한 검증 활성화
      sslConfig.rejectUnauthorized = true;
      sslConfig.ca = process.env.DB_CA_CERT;
    } else if (process.env.DB_SSL_VERIFY === 'true') {
      sslConfig.rejectUnauthorized = true;
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslConfig,
      max: 2,                             // 서버리스 환경 최소 연결
      idleTimeoutMillis: 30000,           // 유휴 연결 30초 후 해제
      connectionTimeoutMillis: 10000,     // 연결 타임아웃 10초
    });
    // 유휴 클라이언트 에러 처리 — 미처리 시 프로세스 크래시 가능
    pool.on('error', (err) => {
      console.error('[DB] 유휴 커넥션 에러:', err.message);
    });
  }
  return pool;
}

// 쿼리 실행 헬퍼
async function query(text, params) {
  const client = await getPool().connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

module.exports = { getPool, query };
