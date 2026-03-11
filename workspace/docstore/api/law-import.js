// 법령 임포트 API
// 법제처 API에서 조문을 가져와 DB에 저장하고 임베딩 생성
// + 조문 간 참조 관계 파싱
const { getLawDetail } = require('../lib/law-fetcher');
const { createEmbeddingsForDocument } = require('../lib/embeddings');
const { query: dbQuery } = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { checkRateLimit } = require('../lib/rate-limit');
const { sendError } = require('../lib/error-handler');
const { buildExplicitCrossRefs, buildSemanticCrossRefs } = require('../lib/cross-reference');

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

  if (await checkRateLimit(req, res, 'lawImport')) return;

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

    // 4) 조문별로 document_sections에 배치 저장 (계층 라벨 + 참조 관계 포함)
    // ── 성능 최적화: multi-row INSERT로 N개 조문을 소수의 쿼리로 일괄 저장 ──
    // 예) 1000개 조문 → 기존 1000회 INSERT → 개선 후 20회 INSERT (50개씩 배치)

    // 각 조문의 식별자를 먼저 모아서 자기 자신 참조를 제외하기 위해 사용
    const articleIds = articles.map(a => {
      let id = `제${a.number}조`;
      if (a.branchNumber) id += `의${a.branchNumber}`;
      return id;
    });

    // 5) 역참조 계산 (INSERT 전에 미리 계산하여 metadata에 포함)
    // referencedBy[조문ID] = [참조하는 조문 목록]
    // → 이렇게 하면 INSERT 1회로 참조 + 역참조 모두 저장 가능 (UPDATE 쿼리 불필요)
    const referencedBy = {};
    for (let i = 0; i < articles.length; i++) {
      const selfId = articleIds[i];
      const refs = parseReferences(articles[i].content).filter(r => r !== selfId);
      for (const ref of refs) {
        if (!referencedBy[ref]) referencedBy[ref] = [];
        referencedBy[ref].push(selfId);
      }
    }

    // 조문 데이터를 배치 INSERT용으로 준비
    // 각 행은 파라미터 4개: document_id, section_index, raw_text, metadata
    // (section_type은 항상 'article'이므로 SQL 리터럴로 직접 삽입)
    const BATCH_SIZE = 50; // PostgreSQL 파라미터 제한 고려 (50 × 4 = 200 파라미터/배치)
    const COLS_PER_ROW = 4;

    for (let batchStart = 0; batchStart < articles.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, articles.length);
      const params = [];
      const valuePlaceholders = [];

      for (let i = batchStart; i < batchEnd; i++) {
        const art = articles[i];
        const rawText = `${art.label}\n${art.content}`;
        const selfId = articleIds[i];
        const references = parseReferences(art.content).filter(ref => ref !== selfId);

        // metadata에 역참조(referencedBy)도 함께 포함 → UPDATE 쿼리 불필요
        const meta = {
          articleNumber: art.number,
          branchNumber: art.branchNumber,
          articleTitle: art.title,
          part: art.part,
          chapter: art.chapter,
          section: art.section,
          subsection: art.subsection,
          label: art.label,
          references,
        };
        if (referencedBy[selfId]) {
          meta.referencedBy = referencedBy[selfId];
        }

        // 파라미터 인덱스 계산: 배치 내 상대 위치 × 컬럼 수
        const offset = (i - batchStart) * COLS_PER_ROW;
        valuePlaceholders.push(
          `($${offset + 1}, 'article', $${offset + 2}, $${offset + 3}, $${offset + 4})`
        );
        params.push(documentId, i, rawText, JSON.stringify(meta));
      }

      await dbQuery(
        `INSERT INTO document_sections (document_id, section_type, section_index, raw_text, metadata)
         VALUES ${valuePlaceholders.join(', ')}`,
        params
      );
    }

    console.log(`  ${articles.length}개 조문 저장 완료 (참조 관계 포함)`);

    // 6) 임베딩 생성
    // 법령 임포트는 자동으로 법령 조문 분할 전략 사용
    const embeddingResult = await createEmbeddingsForDocument({ query: dbQuery }, documentId, 'Law Import', 'law-article');

    // 7) 교차 참조 매트릭스 구축 (비동기 — 응답 차단 없이 백그라운드 실행)
    let crossRefResult = null;
    try {
      const explicit = await buildExplicitCrossRefs(dbQuery, documentId);
      console.log(`[Law Import] 명시적 교차 참조: ${explicit.found}건 감지, ${explicit.saved}건 저장`);
      // 시맨틱 교차 참조는 임베딩이 필요하므로 임베딩 생성 후 실행
      const semantic = await buildSemanticCrossRefs(dbQuery, documentId, { threshold: 0.85 });
      console.log(`[Law Import] 시맨틱 교차 참조: ${semantic.found}건 감지, ${semantic.saved}건 저장`);
      crossRefResult = { explicit, semantic };
    } catch (crErr) {
      console.warn(`[Law Import] 교차 참조 구축 실패 (무시):`, crErr.message);
    }

    res.json({
      success: true,
      documentId,
      title,
      articleCount: articles.length,
      info,
      embedding: embeddingResult,
      crossReferences: crossRefResult,
    });
  } catch (err) {
    sendError(res, err, '[Law Import]');
  }
};
