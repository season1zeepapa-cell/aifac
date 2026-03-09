// documents 테이블에 원본 파일 저장 컬럼 추가 마이그레이션
// 실행: node scripts/add-original-file.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query, getPool } = require('../api/db');

async function migrate() {
  console.log('원본 파일 컬럼 추가 시작...\n');

  try {
    // original_file: 파일 바이너리 (BYTEA)
    await query(`
      ALTER TABLE documents
      ADD COLUMN IF NOT EXISTS original_file BYTEA,
      ADD COLUMN IF NOT EXISTS original_filename VARCHAR(500),
      ADD COLUMN IF NOT EXISTS original_mimetype VARCHAR(100),
      ADD COLUMN IF NOT EXISTS file_size INT DEFAULT 0
    `);
    console.log('완료! documents 테이블에 original_file, original_filename, original_mimetype, file_size 컬럼 추가됨');
  } catch (err) {
    console.error('마이그레이션 실패:', err.message);
    process.exit(1);
  } finally {
    const pool = getPool();
    await pool.end();
  }
}

migrate();
