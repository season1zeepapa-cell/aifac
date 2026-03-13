// 커뮤니티 탐지 테이블 생성 스크립트
// 실행: node scripts/create-community-tables.js

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query, getPool } = require('../lib/db');

async function createTables() {
  console.log('커뮤니티 테이블 생성 시작...');

  await query(`
    CREATE TABLE IF NOT EXISTS communities (
      id SERIAL PRIMARY KEY,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      community_index INTEGER NOT NULL,
      entity_ids JSONB NOT NULL DEFAULT '[]',
      size INTEGER NOT NULL DEFAULT 0,
      algorithm TEXT NOT NULL DEFAULT 'louvain',
      modularity FLOAT DEFAULT 0,
      summary TEXT,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(document_id, community_index)
    );
  `);
  console.log('  communities 테이블 생성 완료');

  // 인덱스 생성
  await query(`CREATE INDEX IF NOT EXISTS idx_communities_document_id ON communities(document_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_communities_size ON communities(size DESC);`);
  console.log('  인덱스 생성 완료');

  console.log('커뮤니티 테이블 생성 완료!');
}

createTables()
  .then(() => {
    console.log('완료');
    getPool().end();
  })
  .catch(err => {
    console.error('오류:', err);
    getPool().end();
    process.exit(1);
  });
