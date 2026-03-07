// memo_files 테이블 생성 스크립트
// 실행: node create-memo-files-table.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function createTable() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS memo_files (
        id            SERIAL PRIMARY KEY,
        memo_id       INTEGER NOT NULL REFERENCES question_memos(id) ON DELETE CASCADE,
        filename      VARCHAR(255) NOT NULL,
        mime_type     VARCHAR(100) NOT NULL,
        data          TEXT NOT NULL,
        size          INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_memo_files_memo_id ON memo_files(memo_id)');
    console.log('memo_files 테이블 생성 완료');
  } finally {
    client.release();
    await pool.end();
  }
}

createTable().catch(e => { console.error('에러:', e); process.exit(1); });
