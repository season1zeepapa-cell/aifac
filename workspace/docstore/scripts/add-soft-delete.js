// documents 테이블에 소프트 삭제용 deleted_at 컬럼 추가
// 실행: node scripts/add-soft-delete.js
require('dotenv').config();
const { query } = require('../lib/db');

async function main() {
  // deleted_at: NULL이면 정상, 값이 있으면 소프트 삭제된 문서
  await query(`
    ALTER TABLE documents
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL
  `);
  console.log('완료! documents 테이블에 deleted_at 컬럼 추가됨');

  // 삭제되지 않은 문서 조회 성능을 위한 부분 인덱스
  await query(`
    CREATE INDEX IF NOT EXISTS idx_documents_not_deleted
      ON documents (upload_date DESC)
      WHERE deleted_at IS NULL
  `);
  console.log('완료! 부분 인덱스 idx_documents_not_deleted 생성됨');

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
