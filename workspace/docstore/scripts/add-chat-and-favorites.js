// F17: 대화 히스토리 테이블 + F18: 문서 즐겨찾기 컬럼 마이그레이션
// 실행: node scripts/add-chat-and-favorites.js

require('dotenv').config();
const { query } = require('../lib/db');

async function migrate() {
  console.log('대화 히스토리 + 즐겨찾기 마이그레이션 시작...');

  // F17: 채팅 세션 테이블
  await query(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '새 대화',
      messages JSONB NOT NULL DEFAULT '[]',
      provider TEXT DEFAULT 'gemini',
      doc_ids INT[] DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('  chat_sessions 테이블 생성 완료');

  await query(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC)`);
  console.log('  chat_sessions 인덱스 생성 완료');

  // F18: 문서 즐겨찾기 (documents 테이블에 컬럼 추가)
  await query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_favorited BOOLEAN DEFAULT FALSE`);
  console.log('  documents.is_favorited 컬럼 추가 완료');

  await query(`CREATE INDEX IF NOT EXISTS idx_documents_favorited ON documents(is_favorited) WHERE is_favorited = TRUE`);
  console.log('  즐겨찾기 인덱스 생성 완료');

  console.log('마이그레이션 완료!');
  process.exit(0);
}

migrate().catch(err => {
  console.error('마이그레이션 실패:', err);
  process.exit(1);
});
