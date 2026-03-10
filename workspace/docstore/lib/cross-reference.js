// 교차 참조 매트릭스 엔진
// 명시적 참조 (정규식) + 시맨틱 참조 (임베딩 유사도) 감지
const { generateEmbedding } = require('./embeddings');

// 타 법령 참조 패턴: "개인정보 보호법 제10조의2제1항" 등
const CROSS_LAW_PATTERN = /([가-힣]{2,20}(?:\s*[가-힣])*법)\s*(제\d+조(?:의\d+)?(?:제\d+항)?(?:제\d+호)?)/g;

// 관계 유형 감지 패턴
const RELATION_PATTERNS = [
  { pattern: /준용/g, type: '준용' },
  { pattern: /적용/g, type: '적용' },
  { pattern: /예외/g, type: '예외' },
  { pattern: /의거/g, type: '의거' },
  { pattern: /위반/g, type: '위반' },
];

/**
 * 조문 텍스트에서 타 법령 명시적 참조를 추출
 * @param {string} text - 조문 텍스트
 * @param {string} selfLawName - 자기 법령명 (자기 참조 필터용)
 * @returns {{ lawName: string, article: string, relation: string, context: string }[]}
 */
function extractExplicitReferences(text, selfLawName) {
  if (!text) return [];
  const refs = [];
  let match;

  // 타 법령 참조 추출
  const regex = new RegExp(CROSS_LAW_PATTERN.source, 'g');
  while ((match = regex.exec(text)) !== null) {
    const lawName = match[1].replace(/\s+/g, ' ').trim();
    const article = match[2];

    // 자기 법령 참조 건너뛰기 (같은 법 내부 참조는 이미 metadata.references로 관리)
    if (selfLawName && normalizeLawName(lawName) === normalizeLawName(selfLawName)) continue;

    // 참조 주변 텍스트에서 관계 유형 감지
    const surrounding = text.substring(
      Math.max(0, match.index - 30),
      Math.min(text.length, match.index + match[0].length + 30)
    );
    let relation = 'explicit';
    for (const rp of RELATION_PATTERNS) {
      if (rp.pattern.test(surrounding)) {
        relation = rp.type;
        rp.pattern.lastIndex = 0; // reset regex
        break;
      }
    }

    refs.push({
      lawName,
      article,
      relation,
      context: surrounding.trim(),
    });
  }

  return refs;
}

/**
 * 법령명 정규화 (공백 제거, 약칭 통일)
 */
function normalizeLawName(name) {
  return name.replace(/\s+/g, '').replace(/에관한/g, '');
}

/**
 * 명시적 교차 참조 구축: 문서 A의 조문이 문서 B를 참조하는 관계 저장
 * @param {Function} dbQuery - DB 쿼리 함수
 * @param {number} documentId - 소스 문서 ID
 * @returns {{ found: number, saved: number }}
 */
async function buildExplicitCrossRefs(dbQuery, documentId) {
  // 소스 문서 정보
  const docRow = await dbQuery('SELECT title FROM documents WHERE id = $1', [documentId]);
  if (docRow.rows.length === 0) throw new Error('문서를 찾을 수 없습니다.');
  const selfLawName = docRow.rows[0].title;

  // 소스 문서의 모든 섹션
  const sections = await dbQuery(
    'SELECT id, raw_text, metadata FROM document_sections WHERE document_id = $1',
    [documentId]
  );

  let found = 0;
  let saved = 0;

  for (const section of sections.rows) {
    const refs = extractExplicitReferences(section.raw_text, selfLawName);
    if (refs.length === 0) continue;

    for (const ref of refs) {
      found++;

      // 대상 법령 문서 찾기 (제목 유사 매칭)
      const targetDoc = await dbQuery(
        `SELECT id, title FROM documents
         WHERE category = '법령' AND deleted_at IS NULL
         AND REPLACE(title, ' ', '') LIKE '%' || REPLACE($1, ' ', '') || '%'
         LIMIT 1`,
        [ref.lawName]
      );
      if (targetDoc.rows.length === 0) continue;

      // 대상 조문 섹션 찾기
      const targetSection = await dbQuery(
        `SELECT id FROM document_sections
         WHERE document_id = $1
         AND metadata->>'label' LIKE '%' || $2 || '%'
         LIMIT 1`,
        [targetDoc.rows[0].id, ref.article]
      );
      if (targetSection.rows.length === 0) continue;

      // 교차 참조 저장 (중복 무시)
      await dbQuery(
        `INSERT INTO cross_references
         (source_section_id, target_section_id, source_document_id, target_document_id,
          relation_type, confidence, context)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (source_section_id, target_section_id, relation_type) DO UPDATE
         SET confidence = $6, context = $7`,
        [
          section.id,
          targetSection.rows[0].id,
          documentId,
          targetDoc.rows[0].id,
          ref.relation,
          1.0, // 명시적 참조는 신뢰도 1.0
          ref.context,
        ]
      );
      saved++;
    }
  }

  return { found, saved };
}

/**
 * 시맨틱 교차 참조 구축: 임베딩 유사도 ≥ threshold인 타 문서 섹션 감지
 * @param {Function} dbQuery - DB 쿼리 함수
 * @param {number} documentId - 소스 문서 ID
 * @param {Object} options - { threshold, maxPerSection }
 * @returns {{ found: number, saved: number }}
 */
async function buildSemanticCrossRefs(dbQuery, documentId, options = {}) {
  const { threshold = 0.85, maxPerSection = 3 } = options;

  // 소스 문서의 청크 임베딩 가져오기
  const chunks = await dbQuery(
    `SELECT dc.id, dc.chunk_text, dc.embedding, ds.id AS section_id, ds.document_id
     FROM document_chunks dc
     JOIN document_sections ds ON dc.section_id = ds.id
     WHERE ds.document_id = $1 AND dc.embedding IS NOT NULL`,
    [documentId]
  );

  let found = 0;
  let saved = 0;

  // 섹션별로 그룹핑 (섹션당 첫 번째 청크만 사용하여 비용 절약)
  const sectionChunks = new Map();
  for (const chunk of chunks.rows) {
    if (!sectionChunks.has(chunk.section_id)) {
      sectionChunks.set(chunk.section_id, chunk);
    }
  }

  for (const [sectionId, chunk] of sectionChunks) {
    // 타 문서의 유사 섹션 검색 (자기 문서 제외)
    const similar = await dbQuery(
      `SELECT DISTINCT ON (ds.id)
         ds.id AS target_section_id,
         ds.document_id AS target_document_id,
         1 - (dc.embedding <=> $1::vector) AS similarity
       FROM document_chunks dc
       JOIN document_sections ds ON dc.section_id = ds.id
       WHERE ds.document_id != $2
         AND dc.embedding IS NOT NULL
         AND 1 - (dc.embedding <=> $1::vector) >= $3
       ORDER BY ds.id, dc.embedding <=> $1::vector
       LIMIT $4`,
      [`[${chunk.embedding}]`, documentId, threshold, maxPerSection]
    );

    for (const row of similar.rows) {
      found++;
      await dbQuery(
        `INSERT INTO cross_references
         (source_section_id, target_section_id, source_document_id, target_document_id,
          relation_type, confidence, context)
         VALUES ($1, $2, $3, $4, 'semantic', $5, $6)
         ON CONFLICT (source_section_id, target_section_id, relation_type) DO UPDATE
         SET confidence = $5`,
        [
          sectionId,
          row.target_section_id,
          documentId,
          row.target_document_id,
          parseFloat(row.similarity),
          `임베딩 유사도 ${(parseFloat(row.similarity) * 100).toFixed(1)}%`,
        ]
      );
      saved++;
    }
  }

  return { found, saved };
}

/**
 * 문서의 교차 참조 조회
 * @param {Function} dbQuery
 * @param {number} documentId
 * @returns {Array} 교차 참조 목록
 */
async function getCrossReferences(dbQuery, documentId) {
  const result = await dbQuery(
    `SELECT
       cr.id, cr.relation_type, cr.confidence, cr.context,
       cr.source_section_id, cr.target_section_id,
       cr.source_document_id, cr.target_document_id,
       sd.title AS source_doc_title,
       td.title AS target_doc_title,
       ss.metadata AS source_meta,
       ts.metadata AS target_meta
     FROM cross_references cr
     JOIN documents sd ON cr.source_document_id = sd.id
     JOIN documents td ON cr.target_document_id = td.id
     JOIN document_sections ss ON cr.source_section_id = ss.id
     JOIN document_sections ts ON cr.target_section_id = ts.id
     WHERE cr.source_document_id = $1 OR cr.target_document_id = $1
     ORDER BY cr.confidence DESC`,
    [documentId]
  );
  return result.rows;
}

module.exports = {
  extractExplicitReferences,
  buildExplicitCrossRefs,
  buildSemanticCrossRefs,
  getCrossReferences,
};
