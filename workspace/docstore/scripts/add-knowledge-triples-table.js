// 지식 그래프 트리플스토어 테이블 마이그레이션
// 엔티티(entities) + 트리플(knowledge_triples) 테이블 생성
// 실행: node scripts/add-knowledge-triples-table.js

require('dotenv').config();
const { query } = require('../lib/db');

async function migrate() {
  console.log('지식 그래프 트리플스토어 마이그레이션 시작...');

  // 1) 엔티티 테이블 — 법령/조문/기관/개념 등 정규화된 엔티티 저장
  await query(`
    CREATE TABLE IF NOT EXISTS entities (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      aliases TEXT[] DEFAULT '{}',
      document_id INT REFERENCES documents(id) ON DELETE SET NULL,
      section_id INT REFERENCES document_sections(id) ON DELETE SET NULL,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(name, entity_type, document_id)
    )
  `);
  console.log('  entities 테이블 생성 완료');

  // 2) 지식 트리플 테이블 — Subject → Predicate → Object
  await query(`
    CREATE TABLE IF NOT EXISTS knowledge_triples (
      id SERIAL PRIMARY KEY,
      subject_id INT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      predicate TEXT NOT NULL,
      object_id INT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      confidence FLOAT DEFAULT 1.0,
      source_document_id INT REFERENCES documents(id) ON DELETE SET NULL,
      source_section_id INT REFERENCES document_sections(id) ON DELETE SET NULL,
      context TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(subject_id, predicate, object_id)
    )
  `);
  console.log('  knowledge_triples 테이블 생성 완료');

  // 3) 인덱스 생성
  await query(`CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_entities_doc ON entities(document_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name)`);

  await query(`CREATE INDEX IF NOT EXISTS idx_triples_subject ON knowledge_triples(subject_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_triples_object ON knowledge_triples(object_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_triples_predicate ON knowledge_triples(predicate)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_triples_source_doc ON knowledge_triples(source_document_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_triples_confidence ON knowledge_triples(confidence DESC)`);
  console.log('  인덱스 생성 완료');

  console.log('마이그레이션 완료!');
  process.exit(0);
}

migrate().catch(err => {
  console.error('마이그레이션 실패:', err);
  process.exit(1);
});
