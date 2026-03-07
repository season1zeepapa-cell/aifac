// question_memos 테이블 생성 스크립트
require('dotenv').config();
const { query } = require('./api/db');

async function createTable() {
  console.log('=== question_memos 테이블 생성 ===\n');

  await query(`
    CREATE TABLE IF NOT EXISTS question_memos (
      id            SERIAL PRIMARY KEY,
      question_id   INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      content       TEXT NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('테이블 생성 완료');

  await query(`
    CREATE INDEX IF NOT EXISTS idx_memos_question_id
    ON question_memos(question_id)
  `);
  console.log('인덱스 생성 완료');

  const check = await query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'question_memos'
    ORDER BY ordinal_position
  `);
  console.log('\n테이블 구조:');
  check.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`));

  console.log('\n=== 완료 ===');
  process.exit(0);
}

createTable().catch(err => { console.error('오류:', err); process.exit(1); });
