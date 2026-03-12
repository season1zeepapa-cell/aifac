// HNSW 벡터 인덱스 마이그레이션
// 실행: node scripts/add-vector-index.js
//
// 이 스크립트가 하는 일:
// 1. document_chunks 테이블에 HNSW 인덱스 생성 (코사인 거리)
// 2. 벡터 검색 속도 10~100배 향상
//
// 현재 상태: 인덱스 없이 전체 테이블 스캔 (brute-force)
// 적용 후: HNSW 근사 최근접 탐색 (Approximate Nearest Neighbor)

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getPool } = require('../lib/db');

async function migrate() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    console.log('[벡터 인덱스 마이그레이션] 시작...\n');

    // 현재 청크 수 확인
    const countResult = await client.query(
      'SELECT COUNT(*) AS total, COUNT(embedding) AS with_embedding FROM document_chunks'
    );
    const { total, with_embedding } = countResult.rows[0];
    console.log(`[현황] document_chunks: ${total}행, 임베딩 있음: ${with_embedding}행\n`);

    // 기존 벡터 인덱스 확인
    const existingIdx = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'document_chunks'
        AND indexdef LIKE '%vector_cosine_ops%'
    `);

    if (existingIdx.rows.length > 0) {
      console.log(`[스킵] 벡터 인덱스가 이미 존재합니다: ${existingIdx.rows[0].indexname}`);
      return;
    }

    // HNSW 인덱스 생성
    // m=16: 각 노드의 연결 수 (높을수록 정확하지만 메모리↑)
    // ef_construction=64: 인덱스 구축 시 탐색 범위 (높을수록 정확하지만 구축 시간↑)
    console.log('[1/2] HNSW 벡터 인덱스 생성 (코사인 거리)...');
    console.log('       파라미터: m=16, ef_construction=64');
    console.log('       대상: document_chunks.embedding (vector(1536))');
    console.log('       ⏳ 데이터 양에 따라 수 초 ~ 수 분 소요...\n');

    const startTime = Date.now();
    await client.query(`
      CREATE INDEX idx_chunks_embedding_hnsw
      ON document_chunks
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
    `);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`       ✅ 완료! (${elapsed}초)\n`);

    // 인덱스 크기 확인
    const sizeResult = await client.query(`
      SELECT pg_size_pretty(pg_relation_size('idx_chunks_embedding_hnsw')) AS idx_size
    `);
    console.log(`[2/2] 인덱스 크기: ${sizeResult.rows[0].idx_size}\n`);

    // 검증: EXPLAIN으로 인덱스 사용 확인
    if (parseInt(with_embedding) > 0) {
      const explainResult = await client.query(`
        EXPLAIN (FORMAT TEXT)
        SELECT id FROM document_chunks
        ORDER BY embedding <=> '[${Array(1536).fill(0).join(',')}]'::vector
        LIMIT 5
      `);
      const plan = explainResult.rows.map(r => r['QUERY PLAN']).join('\n');
      const usesIndex = plan.includes('hnsw') || plan.includes('Index Scan');
      console.log(`[검증] 인덱스 사용 여부: ${usesIndex ? '✅ 사용 중' : '⚠️ 미사용 (옵티마이저 판단)'}`);
      if (!usesIndex) {
        console.log('       (데이터가 적으면 옵티마이저가 Seq Scan을 선택할 수 있음)');
      }
    }

    console.log('\n[벡터 인덱스 마이그레이션] 완료!');
    console.log('  → 벡터 검색(ORDER BY embedding <=> query)이 HNSW 인덱스를 사용합니다.');
    console.log('  → 대규모 데이터에서 검색 속도가 10~100배 향상됩니다.');

  } catch (err) {
    console.error('[벡터 인덱스 마이그레이션] 실패:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
