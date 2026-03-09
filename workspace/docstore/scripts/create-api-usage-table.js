// API 사용량 추적 테이블 생성 마이그레이션
// 실행: node scripts/create-api-usage-table.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query, getPool } = require('../api/db');

async function migrate() {
  console.log('API 사용량 테이블 생성 시작...\n');

  try {
    await query(`
      CREATE TABLE IF NOT EXISTS api_usage (
        id SERIAL PRIMARY KEY,
        provider VARCHAR(30) NOT NULL,
        model VARCHAR(50) NOT NULL,
        endpoint VARCHAR(100) NOT NULL,
        tokens_in INT DEFAULT 0,
        tokens_out INT DEFAULT 0,
        cost_estimate NUMERIC(10,6) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'success',
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('api_usage 테이블 생성 완료');

    // 일별 집계를 빠르게 조회하기 위한 인덱스
    await query(`
      CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage (created_at)
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_api_usage_provider ON api_usage (provider, created_at)
    `);
    console.log('인덱스 생성 완료');

    // API 키 상태 테이블 (키 자체는 저장하지 않고 상태만 관리)
    await query(`
      CREATE TABLE IF NOT EXISTS api_key_status (
        provider VARCHAR(30) PRIMARY KEY,
        is_active BOOLEAN DEFAULT true,
        last_checked TIMESTAMPTZ,
        last_error TEXT,
        daily_limit INT DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('api_key_status 테이블 생성 완료');

    // 기본 프로바이더 등록
    await query(`
      INSERT INTO api_key_status (provider, daily_limit) VALUES
        ('openai', 500),
        ('anthropic', 50),
        ('gemini', 300)
      ON CONFLICT (provider) DO NOTHING
    `);
    console.log('기본 프로바이더 등록 완료');

    console.log('\n모든 테이블이 생성되었습니다!');
  } catch (err) {
    console.error('마이그레이션 실패:', err.message);
    process.exit(1);
  } finally {
    const pool = getPool();
    await pool.end();
  }
}

migrate();
