// 법령 임포트 API
// 법제처 API에서 조문을 가져와 DB에 저장하고 임베딩 생성
// + 조문 간 참조 관계 파싱
const { getLawDetail } = require('../lib/law-fetcher');
const { chunkText, generateEmbeddings } = require('../lib/embeddings');
const { query: dbQuery } = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { checkRateLimit } = require('../lib/rate-limit');
const { sendError } = require('../lib/error-handler');

/**
 * 조문 텍스트에서 다른 조문 참조를 추출
 * "제10조", "제3조제1항", "제5조의2", "제10조부터 제15조까지" 등을 감지
 * @param {string} text - 조문 텍스트
 * @returns {string[]} 참조 조문 목록 (예: ["제10조", "제3조제1항"])
 */
function parseReferences(text) {
  if (!text) return [];
  // 제N조(의N) 패턴 매칭 (항/호 포함)
  const refPattern = /제(\d+)조(?:의(\d+))?(?:제(\d+)항)?(?:제(\d+)호)?/g;
  const refs = new Set();
  let match;
  while ((match = refPattern.exec(text)) !== null) {
    const fullMatch = match[0]; // "제10조", "제3조의2제1항" 등
    refs.add(fullMatch);
  }
  return Array.from(refs);
}

module.exports = async (req, res) => {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  // 인증 체크
  const { error: authError } = requireAdmin(req);
  if (authError) return res.status(401).json({ error: authError });

  if (checkRateLimit(req, res, 'lawImport')) return;

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

    // 4) 조문별로 document_sections에 저장 (계층 라벨 + 참조 관계 포함)
    // 각 조문의 식별자를 먼저 모아서 자기 자신 참조를 제외하기 위해 사용
    const articleIds = articles.map(a => {
      let id = `제${a.number}조`;
      if (a.branchNumber) id += `의${a.branchNumber}`;
      return id;
    });

    for (let i = 0; i < articles.length; i++) {
      const art = articles[i];
      const rawText = `${art.label}\n${art.content}`;

      // 참조 관계 파싱 (자기 자신은 제외)
      const selfId = articleIds[i];
      const references = parseReferences(art.content).filter(ref => ref !== selfId);

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
            references, // 이 조문이 참조하는 다른 조문들
          }),
        ]
      );
    }

    // 5) 역참조 계산: 각 조문을 누가 참조하는지
    // referencedBy[조문ID] = [참조하는 조문 목록]
    const referencedBy = {};
    for (let i = 0; i < articles.length; i++) {
      const selfId = articleIds[i];
      const refs = parseReferences(articles[i].content).filter(r => r !== selfId);
      for (const ref of refs) {
        if (!referencedBy[ref]) referencedBy[ref] = [];
        referencedBy[ref].push(selfId);
      }
    }

    // 역참조가 있는 조문들의 metadata 업데이트
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

    console.log(`  ${articles.length}개 조문 저장 완료 (참조 관계 포함)`);

    // 6) 임베딩 생성
    let embeddingResult = { status: 'pending' };
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
      embeddingResult = { status: 'done', totalChunks };
    } catch (embErr) {
      await dbQuery(`UPDATE documents SET embedding_status = 'failed' WHERE id = $1`, [documentId]).catch(() => {});
      console.error(`  임베딩 생성 실패:`, embErr.message);
      embeddingResult = { status: 'failed', error: embErr.message };
    }

    res.json({
      success: true,
      documentId,
      title,
      articleCount: articles.length,
      info,
      embedding: embeddingResult,
    });
  } catch (err) {
    sendError(res, err, '[Law Import]');
  }
};
