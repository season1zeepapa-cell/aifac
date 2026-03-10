// 법령 임포트 API (SSE 실시간 진행 지원)
// 법제처 API에서 조문을 가져와 DB에 저장하고 임베딩 생성
// + 조문 간 참조 관계 파싱
const { getLawDetail } = require('../lib/law-fetcher');
const { chunkText, generateEmbeddings } = require('../lib/embeddings');
const { query: dbQuery } = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { initSSE } = require('../lib/sse');
const { checkRateLimit } = require('../lib/rate-limit');

/**
 * 조문 텍스트에서 다른 조문 참조를 추출
 */
function parseReferences(text) {
  if (!text) return [];
  const refPattern = /제(\d+)조(?:의(\d+))?(?:제(\d+)항)?(?:제(\d+)호)?/g;
  const refs = new Set();
  let match;
  while ((match = refPattern.exec(text)) !== null) {
    refs.add(match[0]);
  }
  return Array.from(refs);
}

module.exports = async (req, res) => {
  const sse = initSSE(req, res, { methods: 'POST, OPTIONS' });
  if (!sse) return; // OPTIONS 프리플라이트

  if (req.method !== 'POST') return sse.error('POST만 허용', 405);

  // 인증 체크
  const { error: authError } = requireAdmin(req);
  if (authError) return sse.error(authError, 401);

  if (checkRateLimit(req, res, 'lawImport')) return;

  const { lawId, lawName } = req.body;
  if (!lawId) return sse.error('법령ID(lawId)가 필요합니다.', 400);

  const OC = (process.env.LAW_API_OC || '').trim();
  if (!OC) return sse.error('LAW_API_OC가 설정되지 않았습니다.', 500);

  try {
    // 1) 중복 체크
    sse.send('checking', { message: '중복 확인 중...', progress: 5 });
    const existing = await dbQuery(
      `SELECT id, title FROM documents WHERE metadata->>'lawId' = $1`,
      [String(lawId)]
    );
    if (existing.rows.length > 0) {
      return sse.error(`이미 임포트된 법령입니다: "${existing.rows[0].title}" (ID: ${existing.rows[0].id})`, 409);
    }

    // 2) 법제처 API에서 조문 가져오기
    sse.send('fetching', { message: '법제처 API에서 조문 가져오는 중...', progress: 10 });
    console.log(`법령 임포트 시작: ${lawName || lawId}`);
    const { info, articles } = await getLawDetail(lawId, OC);

    if (!info || articles.length === 0) {
      return sse.error('법령 조문을 찾을 수 없습니다.', 404);
    }

    sse.send('fetched', {
      message: `${articles.length}개 조문 수신 완료`,
      progress: 25,
      articleCount: articles.length,
    });

    // 3) documents 테이블에 저장
    sse.send('saving', { message: 'DB 저장 중...', progress: 30 });
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

    // 4) 조문별로 document_sections에 저장
    sse.send('saving_sections', { message: `${articles.length}개 조문 저장 중...`, progress: 35 });

    const articleIds = articles.map(a => {
      let id = `제${a.number}조`;
      if (a.branchNumber) id += `의${a.branchNumber}`;
      return id;
    });

    for (let i = 0; i < articles.length; i++) {
      const art = articles[i];
      const rawText = `${art.label}\n${art.content}`;
      const selfId = articleIds[i];
      const references = parseReferences(art.content).filter(ref => ref !== selfId);

      await dbQuery(
        `INSERT INTO document_sections (document_id, section_type, section_index, raw_text, metadata)
         VALUES ($1, 'article', $2, $3, $4)`,
        [
          documentId, i, rawText,
          JSON.stringify({
            articleNumber: art.number,
            branchNumber: art.branchNumber,
            articleTitle: art.title,
            part: art.part,
            chapter: art.chapter,
            section: art.section,
            subsection: art.subsection,
            label: art.label,
            references,
          }),
        ]
      );
    }

    // 5) 역참조 계산
    sse.send('references', { message: '참조 관계 분석 중...', progress: 45 });
    const referencedBy = {};
    for (let i = 0; i < articles.length; i++) {
      const selfId = articleIds[i];
      const refs = parseReferences(articles[i].content).filter(r => r !== selfId);
      for (const ref of refs) {
        if (!referencedBy[ref]) referencedBy[ref] = [];
        referencedBy[ref].push(selfId);
      }
    }

    if (Object.keys(referencedBy).length > 0) {
      const savedSections = await dbQuery(
        'SELECT id, metadata FROM document_sections WHERE document_id = $1 ORDER BY section_index',
        [documentId]
      );
      for (let i = 0; i < savedSections.rows.length; i++) {
        const row = savedSections.rows[i];
        const artId = articleIds[i];
        if (referencedBy[artId]) {
          const meta = row.metadata || {};
          meta.referencedBy = referencedBy[artId];
          await dbQuery(
            'UPDATE document_sections SET metadata = $1 WHERE id = $2',
            [JSON.stringify(meta), row.id]
          );
        }
      }
    }

    sse.send('saved', { message: '조문 저장 완료', progress: 50 });
    console.log(`  ${articles.length}개 조문 저장 완료 (참조 관계 포함)`);

    // 6) 임베딩 생성
    sse.send('embedding', { message: '임베딩 생성 시작...', progress: 55 });

    try {
      let totalChunks = 0;
      const savedSections = await dbQuery(
        'SELECT id, raw_text FROM document_sections WHERE document_id = $1 ORDER BY id',
        [documentId]
      );
      const validSections = savedSections.rows.filter(s => s.raw_text && s.raw_text.trim().length > 0);

      for (let si = 0; si < validSections.length; si++) {
        const section = validSections[si];
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

        // 임베딩 진행률: 55% ~ 95%
        const embProgress = 55 + Math.round(((si + 1) / validSections.length) * 40);
        sse.send('embedding', {
          message: `임베딩 생성 중... (${si + 1}/${validSections.length} 조문, ${totalChunks}개 청크)`,
          progress: embProgress,
          current: si + 1,
          total: validSections.length,
          totalChunks,
        });
      }
      await dbQuery(`UPDATE documents SET embedding_status = 'done' WHERE id = $1`, [documentId]);
      console.log(`  임베딩 생성 완료: ${totalChunks}개 청크`);
    } catch (embErr) {
      await dbQuery(`UPDATE documents SET embedding_status = 'failed' WHERE id = $1`, [documentId]).catch(() => {});
      console.error(`  임베딩 생성 실패:`, embErr.message);
      sse.send('embedding_failed', { message: `임베딩 생성 실패: ${embErr.message}`, progress: 95 });
    }

    // 완료
    sse.done({
      success: true,
      documentId,
      title,
      articleCount: articles.length,
      info,
    });
  } catch (err) {
    if (sse.isSSE) {
      sse.error(err.message || '법령 임포트 중 오류 발생');
    } else {
      const { sendError } = require('../lib/error-handler');
      sendError(res, err, '[Law Import]');
    }
  }
};
