// documents 테이블에 storage_path 컬럼 추가
// 기존 original_file(BYTEA) 컬럼은 마이그레이션 후 제거 예정
require('dotenv').config();
const { query } = require('../lib/db');

async function main() {
  // storage_path: Supabase Storage 내 파일 경로
  await query(`
    ALTER TABLE documents
      ADD COLUMN IF NOT EXISTS storage_path TEXT
  `);
  console.log('완료! documents 테이블에 storage_path 컬럼 추가됨');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
