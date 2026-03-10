// 벡터화 중심 라벨링 시스템 마이그레이션
// 실행: node scripts/add-labeling-tables.js
//
// 추가 사항:
// 1. tags 테이블 (태그 정의)
// 2. document_tags 테이블 (문서 ↔ 태그 다대다)
// 3. documents 테이블에 summary, keywords, summary_embedding 컬럼
// 4. document_sections 테이블에 summary 컬럼
// 5. document_chunks 테이블에 enriched_text 컬럼
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query, getPool } = require('../lib/db');

async function migrate() {
  console.log('=== 벡터화 중심 라벨링 마이그레이션 시작 ===\n');

  try {
    // 1. tags 테이블
    console.log('1. tags 테이블 생성...');
    await query(`
      CREATE TABLE IF NOT EXISTS tags (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        color VARCHAR(7) DEFAULT '#6B7280',
        usage_count INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('   완료!\n');

    // 2. document_tags 연결 테이블
    console.log('2. document_tags 테이블 생성...');
    await query(`
      CREATE TABLE IF NOT EXISTS document_tags (
        document_id INT REFERENCES documents(id) ON DELETE CASCADE,
        tag_id INT REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (document_id, tag_id)
      );
    `);
    await query('CREATE INDEX IF NOT EXISTS idx_document_tags_doc ON document_tags(document_id);');
    await query('CREATE INDEX IF NOT EXISTS idx_document_tags_tag ON document_tags(tag_id);');
    console.log('   완료!\n');

    // 3. documents 테이블 확장
    console.log('3. documents 테이블에 summary, keywords, summary_embedding 추가...');
    await query('ALTER TABLE documents ADD COLUMN IF NOT EXISTS summary TEXT;');
    await query('ALTER TABLE documents ADD COLUMN IF NOT EXISTS keywords TEXT[];');
    await query('ALTER TABLE documents ADD COLUMN IF NOT EXISTS summary_embedding vector(1536);');
    console.log('   완료!\n');

    // 4. document_sections 테이블 확장
    console.log('4. document_sections 테이블에 summary 추가...');
    await query('ALTER TABLE document_sections ADD COLUMN IF NOT EXISTS summary TEXT;');
    console.log('   완료!\n');

    // 5. document_chunks 테이블 확장
    console.log('5. document_chunks 테이블에 enriched_text 추가...');
    await query('ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS enriched_text TEXT;');
    console.log('   완료!\n');

    // 6. summary_embedding 인덱스 (HNSW)
    console.log('6. summary_embedding HNSW 인덱스 생성...');
    await query(`
      CREATE INDEX IF NOT EXISTS idx_documents_summary_embedding
      ON documents USING hnsw (summary_embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
    `);
    console.log('   완료!\n');

    console.log('=== 마이그레이션 완료! ===');
  } catch (err) {
    console.error('마이그레이션 실패:', err.message);
    process.exit(1);
  } finally {
    const pool = getPool();
    await pool.end();
  }
}

migrate();
