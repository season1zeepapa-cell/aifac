// question_explanations 테이블 생성 스크립트
// 실행: node create-explanations-table.js
require('dotenv').config();
const { query } = require('./api/db');

async function createTable() {
  console.log('=== question_explanations 테이블 생성 ===\n');

  await query(`
    CREATE TABLE IF NOT EXISTS question_explanations (
      id            SERIAL PRIMARY KEY,
      question_id   INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      provider      VARCHAR(20) NOT NULL,
      model         VARCHAR(50) NOT NULL,
      content       TEXT NOT NULL,
      extra_prompt  TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('테이블 생성 완료');

  // 인덱스: question_id로 빠른 조회
  await query(`
    CREATE INDEX IF NOT EXISTS idx_explanations_question_id
    ON question_explanations(question_id)
  `);
  console.log('인덱스 생성 완료');

  // 확인
  const check = await query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'question_explanations'
    ORDER BY ordinal_position
  `);
  console.log('\n테이블 구조:');
  check.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`));

  console.log('\n=== 완료 ===');
  process.exit(0);
}

createTable().catch(err => { console.error('오류:', err); process.exit(1); });
