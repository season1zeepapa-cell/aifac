// tsvector 컬럼 + GIN 인덱스 마이그레이션
// 실행: node scripts/add-fts-column.js
//
// 이 스크립트가 하는 일:
// 1. document_chunks 테이블에 fts_vector (tsvector) 컬럼 추가
// 2. document_sections 테이블에 fts_vector (tsvector) 컬럼 추가
// 3. GIN 인덱스 생성 (전문 검색 속도 향상)
// 4. 기존 데이터에 tsvector 값 일괄 채우기 (backfill)
// 5. INSERT/UPDATE 시 자동 갱신 트리거 생성

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getPool } = require('../lib/db');

async function migrate() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    console.log('[FTS 마이그레이션] 시작...');

    await client.query('BEGIN');

    // ── 1. document_chunks에 fts_vector 컬럼 추가 ──
    console.log('[1/6] document_chunks.fts_vector 컬럼 추가...');
    await client.query(`
      ALTER TABLE document_chunks
      ADD COLUMN IF NOT EXISTS fts_vector tsvector
    `);

    // ── 2. document_sections에 fts_vector 컬럼 추가 ──
    console.log('[2/6] document_sections.fts_vector 컬럼 추가...');
    await client.query(`
      ALTER TABLE document_sections
      ADD COLUMN IF NOT EXISTS fts_vector tsvector
    `);

    // ── 3. GIN 인덱스 생성 ──
    // GIN(Generalized Inverted Index)은 전문 검색에 최적화된 인덱스
    // 마치 책 뒤의 색인(index)처럼, 각 단어가 어떤 문서에 있는지 빠르게 찾아줌
    console.log('[3/6] GIN 인덱스 생성...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chunks_fts
      ON document_chunks USING GIN (fts_vector)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sections_fts
      ON document_sections USING GIN (fts_vector)
    `);

    // ── 4. 기존 데이터 backfill ──
    // 'simple' 설정: 한국어 형태소 분석기 없이 공백 기반 토큰 분리
    // 한국어에는 pg 내장 형태소 분석기가 없어서 simple이 가장 적합
    console.log('[4/6] document_chunks 기존 데이터 backfill...');
    const chunkResult = await client.query(`
      UPDATE document_chunks
      SET fts_vector = to_tsvector('simple', COALESCE(chunk_text, ''))
      WHERE fts_vector IS NULL
    `);
    console.log(`  → ${chunkResult.rowCount}개 청크 업데이트 완료`);

    console.log('[5/6] document_sections 기존 데이터 backfill...');
    const sectionResult = await client.query(`
      UPDATE document_sections
      SET fts_vector = to_tsvector('simple', COALESCE(raw_text, ''))
      WHERE fts_vector IS NULL
    `);
    console.log(`  → ${sectionResult.rowCount}개 섹션 업데이트 완료`);

    // ── 5. 자동 갱신 트리거 생성 ──
    // 새 데이터가 INSERT/UPDATE 될 때 fts_vector를 자동으로 생성
    console.log('[6/6] 자동 갱신 트리거 생성...');

    // 트리거 함수: document_chunks
    await client.query(`
      CREATE OR REPLACE FUNCTION chunks_fts_trigger_fn()
      RETURNS trigger AS $$
      BEGIN
        NEW.fts_vector := to_tsvector('simple', COALESCE(NEW.chunk_text, ''));
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    // 트리거: document_chunks (이미 있으면 교체)
    await client.query(`
      DROP TRIGGER IF EXISTS trg_chunks_fts ON document_chunks
    `);
    await client.query(`
      CREATE TRIGGER trg_chunks_fts
      BEFORE INSERT OR UPDATE OF chunk_text ON document_chunks
      FOR EACH ROW
      EXECUTE FUNCTION chunks_fts_trigger_fn()
    `);

    // 트리거 함수: document_sections
    await client.query(`
      CREATE OR REPLACE FUNCTION sections_fts_trigger_fn()
      RETURNS trigger AS $$
      BEGIN
        NEW.fts_vector := to_tsvector('simple', COALESCE(NEW.raw_text, ''));
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    // 트리거: document_sections
    await client.query(`
      DROP TRIGGER IF EXISTS trg_sections_fts ON document_sections
    `);
    await client.query(`
      CREATE TRIGGER trg_sections_fts
      BEFORE INSERT OR UPDATE OF raw_text ON document_sections
      FOR EACH ROW
      EXECUTE FUNCTION sections_fts_trigger_fn()
    `);

    await client.query('COMMIT');
    console.log('\n[FTS 마이그레이션] 완료!');
    console.log('  - document_chunks.fts_vector (tsvector + GIN)');
    console.log('  - document_sections.fts_vector (tsvector + GIN)');
    console.log('  - 자동 갱신 트리거 활성화');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[FTS 마이그레이션] 실패:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(() => process.exit(1));
