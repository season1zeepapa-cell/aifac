// Supabase PostgreSQL 연결 유틸리티
const { Pool } = require('pg');

// 커넥션 풀 (서버리스 환경에서 재사용)
let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Supabase 필수
      max: 5,                             // 최대 연결 수
      idleTimeoutMillis: 30000,           // 유휴 연결 30초 후 해제
      connectionTimeoutMillis: 10000,     // 연결 타임아웃 10초
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
