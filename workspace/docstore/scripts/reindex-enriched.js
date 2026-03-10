// 기존 문서 일괄 재처리 — enriched 임베딩으로 업그레이드
// 실행: node scripts/reindex-enriched.js [--doc-id=N]
//
// 옵션:
//   --doc-id=N   특정 문서만 재처리
//   (없으면)      전체 문서 재처리
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query, getPool } = require('../lib/db');
const { analyzeDocument, analyzeSections } = require('../lib/doc-analyzer');
const { generateEnrichedEmbeddings } = require('../lib/embeddings');

async function reindex() {
  const args = process.argv.slice(2);
  const docIdArg = args.find(a => a.startsWith('--doc-id='));
  const targetDocId = docIdArg ? parseInt(docIdArg.split('=')[1]) : null;

  console.log('=== Enriched 임베딩 재처리 시작 ===\n');

  try {
    // 대상 문서 조회
    let docs;
    if (targetDocId) {
      docs = await query('SELECT id, title, category, summary FROM documents WHERE id = $1', [targetDocId]);
      console.log(`대상: 문서 ID ${targetDocId}\n`);
    } else {
      docs = await query('SELECT id, title, category, summary FROM documents ORDER BY id');
      console.log(`대상: 전체 ${docs.rows.length}개 문서\n`);
    }

    let processed = 0;
    let failed = 0;

    for (const doc of docs.rows) {
      try {
        console.log(`[${processed + 1}/${docs.rows.length}] 문서 ${doc.id}: "${doc.title}"`);

        // 섹션 조회
        const sections = await query(
          'SELECT id, raw_text, metadata FROM document_sections WHERE document_id = $1 ORDER BY section_index',
          [doc.id]
        );

        if (sections.rows.length === 0) {
          console.log('  → 섹션 없음, 스킵\n');
          continue;
        }

        // AI 분석 (요약이 없는 경우만)
        let summary = doc.summary || '';
        let keywords = [];
        let tags = [];

        if (!summary) {
          const fullText = sections.rows.map(s => s.raw_text || '').join('\n\n');
          console.log('  → AI 분석 중...');
          const analysis = await analyzeDocument(fullText, doc.title, doc.category);
          summary = analysis.summary;
          keywords = analysis.keywords;
          tags = analysis.tags;

          // 저장
          await query(
            'UPDATE documents SET summary = $1, keywords = $2 WHERE id = $3',
            [summary, keywords, doc.id]
          );

          // 태그 추가
          for (const tagName of tags) {
            let tagResult = await query('SELECT id FROM tags WHERE name = $1', [tagName]);
            if (tagResult.rows.length === 0) {
              tagResult = await query('INSERT INTO tags (name) VALUES ($1) RETURNING id', [tagName]);
            }
            await query(
              'INSERT INTO document_tags (document_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [doc.id, tagResult.rows[0].id]
            );
            await query(
              'UPDATE tags SET usage_count = (SELECT COUNT(*) FROM document_tags WHERE tag_id = $1) WHERE id = $1',
              [tagResult.rows[0].id]
            );
          }
          console.log(`  → 요약: ${summary.substring(0, 50)}...`);
          console.log(`  → 태그: ${tags.join(', ')}`);
        }

        // 섹션별 요약 (summary가 없는 섹션만)
        const needSummary = sections.rows.filter(s => {
          const meta = s.metadata || {};
          return !meta.summary && s.raw_text && s.raw_text.trim().length >= 30;
        });
        if (needSummary.length > 0) {
          console.log(`  → 섹션 요약 생성 (${needSummary.length}개)...`);
          const sectionSummaries = await analyzeSections(needSummary);
          for (const [sectionId, sum] of sectionSummaries) {
            await query('UPDATE document_sections SET summary = $1 WHERE id = $2', [sum, sectionId]);
          }
        }

        // 기존 청크 삭제
        const sectionIds = sections.rows.map(s => s.id);
        if (sectionIds.length > 0) {
          await query('DELETE FROM document_chunks WHERE section_id = ANY($1)', [sectionIds]);
        }

        // 태그명 조회
        const tagNames = await query(
          `SELECT t.name FROM tags t JOIN document_tags dt ON t.id = dt.tag_id WHERE dt.document_id = $1`,
          [doc.id]
        );
        const tagList = tagNames.rows.map(r => r.name);

        // enriched 임베딩 생성
        console.log('  → enriched 임베딩 생성 중...');
        const totalChunks = await generateEnrichedEmbeddings(
          { query },
          doc.id,
          { title: doc.title, summary, category: doc.category, tags: tagList, keywords }
        );

        console.log(`  → 완료: ${totalChunks}개 청크\n`);
        processed++;
      } catch (err) {
        console.error(`  → 실패: ${err.message}\n`);
        failed++;
      }
    }

    console.log(`=== 재처리 완료: ${processed}개 성공, ${failed}개 실패 ===`);
  } catch (err) {
    console.error('재처리 실패:', err.message);
    process.exit(1);
  } finally {
    const pool = getPool();
    await pool.end();
  }
}

reindex();
