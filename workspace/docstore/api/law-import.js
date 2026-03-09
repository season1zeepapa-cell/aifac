// 법령 임포트 API
// 법제처 API에서 조문을 가져와 DB에 저장하고 임베딩 생성
const { getLawDetail } = require('../lib/law-fetcher');
const { chunkText, generateEmbeddings } = require('../lib/embeddings');
const { query: dbQuery } = require('./db');

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  const { lawId, lawName } = req.body;
  if (!lawId) return res.status(400).json({ error: '법령ID(lawId)가 필요합니다.' });

  const OC = (process.env.LAW_API_OC || '').trim();
  if (!OC) return res.status(500).json({ error: 'LAW_API_OC가 설정되지 않았습니다.' });

  try {
    // 1) 중복 체크 — 같은 lawId로 이미 임포트된 문서가 있는지 확인
    const existing = await dbQuery(
      `SELECT id, title FROM documents WHERE metadata->>'lawId' = $1`,
      [String(lawId)]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: `이미 임포트된 법령입니다: "${existing.rows[0].title}" (ID: ${existing.rows[0].id})`,
      });
    }

    // 2) 법제처 API에서 조문 가져오기
    console.log(`법령 임포트 시작: ${lawName || lawId}`);
    const { info, articles } = await getLawDetail(lawId, OC);

    if (!info || articles.length === 0) {
      return res.status(404).json({ error: '법령 조문을 찾을 수 없습니다.' });
    }

    // 3) documents 테이블에 저장
    const title = lawName || info.name || '제목 없음';
    const docResult = await dbQuery(
      `INSERT INTO documents (title, file_type, category, metadata)
       VALUES ($1, 'law', '법령', $2)
       RETURNING id`,
      [
        title,
        JSON.stringify({
          lawId: String(lawId),
          promulgationDate: info.promulgationDate,
          enforcementDate: info.enforcementDate,
          ministry: info.ministry,
          articleCount: articles.length,
        }),
      ]
    );
    const documentId = docResult.rows[0].id;
    console.log(`  문서 저장: ID ${documentId}, "${title}"`);

    // 4) 조문별로 document_sections에 저장 (계층 라벨 포함)
    for (let i = 0; i < articles.length; i++) {
      const art = articles[i];
      // 조문 텍스트 조합: 라벨 + 내용
      const rawText = `${art.label}\n${art.content}`;

      await dbQuery(
        `INSERT INTO document_sections (document_id, section_type, section_index, raw_text, metadata)
         VALUES ($1, 'article', $2, $3, $4)`,
        [
          documentId,
          i,
          rawText,
          JSON.stringify({
            articleNumber: art.number,
            branchNumber: art.branchNumber,
            articleTitle: art.title,
            part: art.part,
            chapter: art.chapter,
            section: art.section,
            subsection: art.subsection,
            label: art.label,
          }),
        ]
      );
    }
    console.log(`  ${articles.length}개 조문 저장 완료`);

    // 5) 임베딩 생성 (비동기 or 동기)
    const embeddingPromise = (async () => {
      try {
        let totalChunks = 0;
        const savedSections = await dbQuery(
          'SELECT id, raw_text FROM document_sections WHERE document_id = $1 ORDER BY id',
          [documentId]
        );

        for (const section of savedSections.rows) {
          if (!section.raw_text || section.raw_text.trim().length === 0) continue;

          const chunks = chunkText(section.raw_text);
          if (chunks.length === 0) continue;

          const embeddings = await generateEmbeddings(chunks);
          for (let i = 0; i < chunks.length; i++) {
            const vecStr = `[${embeddings[i].join(',')}]`;
            await dbQuery(
              `INSERT INTO document_chunks (section_id, chunk_text, embedding, chunk_index)
               VALUES ($1, $2, $3::vector, $4)`,
              [section.id, chunks[i], vecStr, i]
            );
          }
          totalChunks += chunks.length;
        }
        await dbQuery(`UPDATE documents SET embedding_status = 'done' WHERE id = $1`, [documentId]);
        console.log(`  임베딩 생성 완료: ${totalChunks}개 청크`);
      } catch (embErr) {
        await dbQuery(`UPDATE documents SET embedding_status = 'failed' WHERE id = $1`, [documentId]).catch(() => {});
        console.error(`  임베딩 생성 실패:`, embErr.message);
      }
    })();

    // Vercel 서버리스에서는 응답 후 비동기 작업이 중단되므로 await
    if (process.env.VERCEL) {
      await embeddingPromise;
    }

    res.json({
      success: true,
      documentId,
      title,
      articleCount: articles.length,
      info,
    });
  } catch (err) {
    console.error('법령 임포트 에러:', err);
    res.status(500).json({ error: err.message });
  }
};
