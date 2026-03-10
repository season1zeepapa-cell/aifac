// 교차 참조 매트릭스 테이블 마이그레이션
// 복수 문서 간 참조 관계를 저장하는 cross_references 테이블 생성
// 실행: node scripts/add-cross-references-table.js

require('dotenv').config();
const { query } = require('../lib/db');

async function migrate() {
  console.log('교차 참조 테이블 마이그레이션 시작...');

  await query(`
    CREATE TABLE IF NOT EXISTS cross_references (
      id SERIAL PRIMARY KEY,
      source_section_id INT REFERENCES document_sections(id) ON DELETE CASCADE,
      target_section_id INT REFERENCES document_sections(id) ON DELETE CASCADE,
      source_document_id INT REFERENCES documents(id) ON DELETE CASCADE,
      target_document_id INT REFERENCES documents(id) ON DELETE CASCADE,
      relation_type TEXT NOT NULL,
      confidence FLOAT DEFAULT 1.0,
      context TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(source_section_id, target_section_id, relation_type)
    )
  `);
  console.log('  cross_references 테이블 생성 완료');

  // 조회 성능용 인덱스
  await query(`CREATE INDEX IF NOT EXISTS idx_crossref_source_doc ON cross_references(source_document_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_crossref_target_doc ON cross_references(target_document_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_crossref_type ON cross_references(relation_type)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_crossref_confidence ON cross_references(confidence DESC)`);
  console.log('  인덱스 생성 완료');

  console.log('마이그레이션 완료!');
  process.exit(0);
}

migrate().catch(err => {
  console.error('마이그레이션 실패:', err);
  process.exit(1);
});
