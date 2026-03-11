// 가중 tsvector 업그레이드 마이그레이션 (v2)
// 실행: node scripts/upgrade-fts-weighted.js
//
// 기존 add-fts-column.js를 먼저 실행한 후, 이 스크립트로 업그레이드
//
// 변경 사항:
// 1. document_sections: 가중 tsvector 생성
//    - 조항명(label) → 가중치 A (최고 우선순위)
//    - 장/절 제목(chapter, section) → 가중치 B
//    - 본문(raw_text) → 가중치 D (기본)
//    → 검색 시 "제25조"로 검색하면 조항명에 해당 단어가 있는 섹션이 더 높은 점수
//
// 2. document_chunks: enriched_text 포함 가중 tsvector
//    - enriched_text (문서 맥락 포함) → 가중치 A
//    - chunk_text (원본) → 가중치 D
//
// 3. 트리거 함수 업데이트 → 새 데이터도 가중 tsvector 자동 생성

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getPool } = require('../lib/db');

async function migrate() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    console.log('[FTS v2 마이그레이션] 가중 tsvector 업그레이드 시작...\n');

    await client.query('BEGIN');

    // ── 1. document_sections 가중 tsvector backfill ──
    // metadata에서 label, chapter, section 추출하여 가중치 부여
    console.log('[1/4] document_sections 가중 tsvector 생성...');
    const sectionResult = await client.query(`
      UPDATE document_sections
      SET fts_vector =
        setweight(to_tsvector('simple', COALESCE(metadata->>'label', '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(metadata->>'articleTitle', '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(metadata->>'chapter', '')), 'B') ||
        setweight(to_tsvector('simple', COALESCE(metadata->>'section', '')), 'B') ||
        setweight(to_tsvector('simple', COALESCE(raw_text, '')), 'D')
    `);
    console.log(`  → ${sectionResult.rowCount}개 섹션 업데이트 완료`);

    // ── 2. document_chunks 가중 tsvector backfill ──
    // enriched_text가 있으면 가중치 A로 포함 (문서 맥락 정보)
    console.log('[2/4] document_chunks 가중 tsvector 생성...');
    const chunkResult = await client.query(`
      UPDATE document_chunks
      SET fts_vector =
        setweight(to_tsvector('simple', COALESCE(enriched_text, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(chunk_text, '')), 'D')
    `);
    console.log(`  → ${chunkResult.rowCount}개 청크 업데이트 완료`);

    // ── 3. 트리거 함수 업데이트 (가중 tsvector 생성) ──
    console.log('[3/4] 트리거 함수 업데이트...');

    // document_sections 트리거: metadata에서 label/chapter 추출
    await client.query(`
      CREATE OR REPLACE FUNCTION sections_fts_trigger_fn()
      RETURNS trigger AS $$
      BEGIN
        NEW.fts_vector :=
          setweight(to_tsvector('simple', COALESCE(NEW.metadata->>'label', '')), 'A') ||
          setweight(to_tsvector('simple', COALESCE(NEW.metadata->>'articleTitle', '')), 'A') ||
          setweight(to_tsvector('simple', COALESCE(NEW.metadata->>'chapter', '')), 'B') ||
          setweight(to_tsvector('simple', COALESCE(NEW.metadata->>'section', '')), 'B') ||
          setweight(to_tsvector('simple', COALESCE(NEW.raw_text, '')), 'D');
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    // document_sections 트리거 재생성 (metadata 변경도 감지)
    await client.query(`
      DROP TRIGGER IF EXISTS trg_sections_fts ON document_sections
    `);
    await client.query(`
      CREATE TRIGGER trg_sections_fts
      BEFORE INSERT OR UPDATE OF raw_text, metadata ON document_sections
      FOR EACH ROW
      EXECUTE FUNCTION sections_fts_trigger_fn()
    `);

    // document_chunks 트리거: enriched_text 포함
    await client.query(`
      CREATE OR REPLACE FUNCTION chunks_fts_trigger_fn()
      RETURNS trigger AS $$
      BEGIN
        NEW.fts_vector :=
          setweight(to_tsvector('simple', COALESCE(NEW.enriched_text, '')), 'A') ||
          setweight(to_tsvector('simple', COALESCE(NEW.chunk_text, '')), 'D');
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    // document_chunks 트리거 재생성 (enriched_text 변경도 감지)
    await client.query(`
      DROP TRIGGER IF EXISTS trg_chunks_fts ON document_chunks
    `);
    await client.query(`
      CREATE TRIGGER trg_chunks_fts
      BEFORE INSERT OR UPDATE OF chunk_text, enriched_text ON document_chunks
      FOR EACH ROW
      EXECUTE FUNCTION chunks_fts_trigger_fn()
    `);

    // ── 4. 가중치 사용법 안내 ──
    console.log('[4/4] 검증...');
    const testResult = await client.query(`
      SELECT COUNT(*) AS total,
             COUNT(fts_vector) AS with_fts
      FROM document_sections
    `);
    const test2 = await client.query(`
      SELECT COUNT(*) AS total,
             COUNT(fts_vector) AS with_fts
      FROM document_chunks
    `);

    await client.query('COMMIT');

    console.log(`\n[FTS v2 마이그레이션] 완료!`);
    console.log(`  - document_sections: ${testResult.rows[0].with_fts}/${testResult.rows[0].total}개 가중 tsvector`);
    console.log(`  - document_chunks: ${test2.rows[0].with_fts}/${test2.rows[0].total}개 가중 tsvector`);
    console.log(`\n  가중치 설명:`);
    console.log(`    A (최고): 조항명, 조항 제목 (label, articleTitle)`);
    console.log(`    B (높음): 장/절 제목 (chapter, section)`);
    console.log(`    D (기본): 본문 텍스트 (raw_text, chunk_text)`);
    console.log(`\n  효과: "제25조" 검색 시 조항명에 해당 단어가 있는 결과가 더 높은 점수`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[FTS v2 마이그레이션] 실패:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(() => process.exit(1));
