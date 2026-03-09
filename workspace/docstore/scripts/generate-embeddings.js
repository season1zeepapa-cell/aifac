// 기존 문서에 임베딩을 생성하는 CLI 스크립트
// 사용법: node scripts/generate-embeddings.js [--doc-id N]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { query, getPool } = require('../api/db');
const { chunkText, generateEmbeddings } = require('../lib/embeddings');

async function main() {
  // --doc-id 옵션 파싱
  const args = process.argv.slice(2);
  let docId = null;
  const docIdIdx = args.indexOf('--doc-id');
  if (docIdIdx !== -1 && args[docIdIdx + 1]) {
    docId = parseInt(args[docIdIdx + 1], 10);
    if (isNaN(docId)) {
      console.error('--doc-id 값이 올바르지 않습니다.');
      process.exit(1);
    }
  }

  try {
    // 대상 섹션 조회
    let sections;
    if (docId) {
      console.log(`문서 ID ${docId}의 섹션을 처리합니다...\n`);
      sections = await query(
        'SELECT id, document_id, raw_text FROM document_sections WHERE document_id = $1 ORDER BY id',
        [docId]
      );
    } else {
      console.log('전체 문서의 섹션을 처리합니다...\n');
      sections = await query(
        'SELECT id, document_id, raw_text FROM document_sections ORDER BY document_id, id'
      );
    }

    if (sections.rows.length === 0) {
      console.log('처리할 섹션이 없습니다.');
      return;
    }

    console.log(`총 ${sections.rows.length}개 섹션 발견\n`);

    let totalChunks = 0;

    for (const section of sections.rows) {
      if (!section.raw_text || section.raw_text.trim().length === 0) {
        console.log(`  섹션 ${section.id}: 텍스트 없음 → 건너뜀`);
        continue;
      }

      // 기존 청크 삭제 (재생성 시)
      await query('DELETE FROM document_chunks WHERE section_id = $1', [section.id]);

      // 텍스트를 청크로 분할
      const chunks = chunkText(section.raw_text);
      if (chunks.length === 0) {
        console.log(`  섹션 ${section.id}: 청크 생성 불가 → 건너뜀`);
        continue;
      }

      // 임베딩 생성
      console.log(`  섹션 ${section.id} (문서 ${section.document_id}): ${chunks.length}개 청크 → 임베딩 생성 중...`);
      const embeddings = await generateEmbeddings(chunks);

      // DB에 저장
      for (let i = 0; i < chunks.length; i++) {
        const vecStr = `[${embeddings[i].join(',')}]`;
        await query(
          `INSERT INTO document_chunks (section_id, chunk_text, embedding, chunk_index)
           VALUES ($1, $2, $3::vector, $4)`,
          [section.id, chunks[i], vecStr, i]
        );
      }

      totalChunks += chunks.length;
      console.log(`    → ${chunks.length}개 청크 저장 완료`);
    }

    console.log(`\n완료! 총 ${totalChunks}개 청크에 임베딩 생성됨`);
  } catch (err) {
    console.error('임베딩 생성 실패:', err.message);
    process.exit(1);
  } finally {
    const pool = getPool();
    await pool.end();
  }
}

main();
