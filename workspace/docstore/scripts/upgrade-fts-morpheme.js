#!/usr/bin/env node
// 형태소 분석 FTS 컬럼 마이그레이션
//
// 기존 fts_vector (N-gram 기반) 와 별도로
// fts_morpheme_vector (형태소 분석 기반) 컬럼을 추가한다.
// 두 컬럼이 병렬로 존재하므로 기존 검색은 영향 없음.
//
// 실행: node scripts/upgrade-fts-morpheme.js

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('[마이그레이션] 형태소 FTS 컬럼 추가 시작...');

    // 1) document_chunks 테이블에 fts_morpheme_vector 컬럼 추가
    await client.query(`
      ALTER TABLE document_chunks
      ADD COLUMN IF NOT EXISTS fts_morpheme_vector tsvector
    `);
    console.log('  ✓ document_chunks.fts_morpheme_vector 컬럼 추가');

    // 2) document_sections 테이블에 fts_morpheme_vector 컬럼 추가
    await client.query(`
      ALTER TABLE document_sections
      ADD COLUMN IF NOT EXISTS fts_morpheme_vector tsvector
    `);
    console.log('  ✓ document_sections.fts_morpheme_vector 컬럼 추가');

    // 3) GIN 인덱스 생성 (검색 성능)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chunks_fts_morpheme
      ON document_chunks USING GIN (fts_morpheme_vector)
      WHERE fts_morpheme_vector IS NOT NULL
    `);
    console.log('  ✓ document_chunks GIN 인덱스 생성');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sections_fts_morpheme
      ON document_sections USING GIN (fts_morpheme_vector)
      WHERE fts_morpheme_vector IS NOT NULL
    `);
    console.log('  ✓ document_sections GIN 인덱스 생성');

    console.log('[마이그레이션] 완료!');
    console.log('');
    console.log('다음 단계:');
    console.log('  1. 문서를 다시 인덱싱하면 fts_morpheme_vector가 자동 생성됩니다');
    console.log('  2. 검색 시 "형태소 분석" 토글을 켜면 새 인덱스를 사용합니다');
  } catch (err) {
    console.error('[마이그레이션 실패]', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(() => process.exit(1));
