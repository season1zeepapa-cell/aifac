// DocStore DB 테이블 생성 스크립트
// 실행: npm run setup-db
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query, getPool } = require('../api/db');

async function createTables() {
  console.log('DocStore 테이블 생성 시작...\n');

  try {
    // 1. pgvector 확장 활성화
    console.log('1. pgvector 확장 활성화...');
    await query('CREATE EXTENSION IF NOT EXISTS vector;');
    console.log('   완료!\n');

    // 2. documents 테이블 - 문서 메타데이터
    console.log('2. documents 테이블 생성...');
    await query(`
      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        title VARCHAR(500) NOT NULL,
        file_type VARCHAR(20) DEFAULT 'pdf',
        category VARCHAR(50),
        upload_date TIMESTAMPTZ DEFAULT NOW(),
        metadata JSONB DEFAULT '{}'
      );
    `);
    console.log('   완료!\n');

    // 3. document_sections 테이블 - 추출 단위별 텍스트
    console.log('3. document_sections 테이블 생성...');
    await query(`
      CREATE TABLE IF NOT EXISTS document_sections (
        id SERIAL PRIMARY KEY,
        document_id INT REFERENCES documents(id) ON DELETE CASCADE,
        section_type VARCHAR(20) NOT NULL,
        section_index INT DEFAULT 0,
        raw_text TEXT,
        image_url TEXT
      );
    `);
    console.log('   완료!\n');

    // 4. document_chunks 테이블 - 벡터 임베딩용 청크
    console.log('4. document_chunks 테이블 생성...');
    await query(`
      CREATE TABLE IF NOT EXISTS document_chunks (
        id SERIAL PRIMARY KEY,
        section_id INT REFERENCES document_sections(id) ON DELETE CASCADE,
        chunk_text TEXT NOT NULL,
        embedding vector(1536),
        chunk_index INT DEFAULT 0
      );
    `);
    console.log('   완료!\n');

    console.log('모든 테이블이 생성되었습니다!');
  } catch (err) {
    console.error('테이블 생성 실패:', err.message);
    process.exit(1);
  } finally {
    // 커넥션 풀 종료
    const pool = getPool();
    await pool.end();
  }
}

createTables();
