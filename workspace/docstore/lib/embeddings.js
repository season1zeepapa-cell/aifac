// 임베딩 생성 유틸리티 (OpenAI text-embedding-3-small)
const OpenAI = require('openai');
const { smartChunk } = require('./text-splitters');
const { trackUsage } = require('./api-tracker');

// OpenAI 클라이언트 (싱글턴)
let client;
function getClient() {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

const EMBEDDING_MODEL = 'text-embedding-3-small';

/**
 * 텍스트를 청크로 분할
 * - 문장 단위로 끊어서 chunkSize 이내로 묶음
 * - overlap만큼 이전 청크의 끝 부분을 다음 청크에 포함
 * @param {string} text - 원본 텍스트
 * @param {number} chunkSize - 청크 최대 글자 수 (기본 500)
 * @param {number} overlap - 겹침 글자 수 (기본 100)
 * @returns {string[]} 청크 배열
 */
function chunkText(text, chunkSize = 500, overlap = 100) {
  if (!text || text.trim().length === 0) return [];

  // 문장 단위로 분리 (마침표, 느낌표, 물음표 기준)
  const sentences = text.match(/[^.!?]+[.!?]?\s*/g) || [text];

  const chunks = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    // 현재 청크 + 문장이 chunkSize 이내면 추가
    if (currentChunk.length + sentence.length <= chunkSize) {
      currentChunk += sentence;
    } else {
      // 현재 청크가 비어있지 않으면 저장
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
      }
      // overlap 적용: 이전 청크의 끝 부분을 가져옴
      if (overlap > 0 && currentChunk.length > overlap) {
        currentChunk = currentChunk.slice(-overlap) + sentence;
      } else {
        currentChunk = sentence;
      }
    }
  }

  // 마지막 청크 저장
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * 청크 배열을 받아 임베딩 벡터 배열 반환
 * @param {string[]} chunks - 텍스트 청크 배열
 * @returns {Promise<number[][]>} 임베딩 벡터 배열
 */
async function generateEmbeddings(chunks) {
  if (!chunks || chunks.length === 0) return [];

  const openai = getClient();

  // OpenAI API는 한 번에 여러 텍스트 임베딩 가능 (배치 처리)
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: chunks,
  });

  // 사용량 추적 (토큰 수는 응답에 포함됨)
  trackUsage({
    provider: 'openai', model: EMBEDDING_MODEL, endpoint: 'embeddings-batch',
    tokensIn: response.usage?.total_tokens || 0, tokensOut: 0, status: 'success',
  }).catch(() => {});

  // 인덱스 순서대로 정렬하여 반환
  return response.data
    .sort((a, b) => a.index - b.index)
    .map(item => item.embedding);
}

/**
 * 단일 텍스트의 임베딩 벡터 반환
 * @param {string} text - 텍스트
 * @returns {Promise<number[]>} 임베딩 벡터 (1536차원)
 */
async function generateEmbedding(text) {
  const openai = getClient();

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });

  // 사용량 추적
  trackUsage({
    provider: 'openai', model: EMBEDDING_MODEL, endpoint: 'embedding-single',
    tokensIn: response.usage?.total_tokens || 0, tokensOut: 0, status: 'success',
  }).catch(() => {});

  return response.data[0].embedding;
}

/**
 * 청크에 맥락 정보를 붙여서 "enriched text" 생성
 * → 이 텍스트로 임베딩을 만들면 검색 정확도가 크게 올라감
 *
 * @param {object} params
 * @param {string} params.chunkText      - 원본 청크 텍스트
 * @param {string} params.docTitle       - 문서 제목
 * @param {string} params.docSummary     - 문서 요약 (AI 생성)
 * @param {string} params.category       - 카테고리
 * @param {string[]} params.tags         - 태그 배열
 * @param {string[]} params.keywords     - 키워드 배열
 * @param {string} params.sectionSummary - 섹션 요약
 * @param {object} params.sectionMeta    - 섹션 메타 (label, chapter 등)
 * @returns {string} enriched text
 */
function buildEnrichedText({
  chunkText,
  docTitle = '',
  docSummary = '',
  category = '',
  tags = [],
  keywords = [],
  sectionSummary = '',
  sectionMeta = {},
}) {
  const parts = [];

  // 1) 문서 맥락
  if (docTitle) parts.push(`[문서] ${docTitle}`);
  if (category) parts.push(`[분류] ${category}`);
  if (tags.length > 0) parts.push(`[태그] ${tags.join(', ')}`);
  if (keywords.length > 0) parts.push(`[키워드] ${keywords.join(', ')}`);

  // 2) 문서 요약
  if (docSummary) parts.push(`[문서요약] ${docSummary}`);

  // 3) 섹션 맥락
  const { label, chapter, section, articleTitle } = sectionMeta;
  if (chapter) parts.push(`[장] ${chapter}`);
  if (section) parts.push(`[절] ${section}`);
  if (label) parts.push(`[조항] ${label}`);
  if (articleTitle) parts.push(`[조항제목] ${articleTitle}`);
  if (sectionSummary) parts.push(`[섹션요약] ${sectionSummary}`);

  // 4) 원본 텍스트
  parts.push(chunkText);

  return parts.join('\n');
}

/**
 * 문서의 섹션들에 대해 enriched 임베딩을 생성하고 DB에 저장
 * (업로드/임포트 파이프라인에서 기존 임베딩 로직을 대체)
 *
 * @param {object} db - { query } DB 헬퍼
 * @param {number} documentId - 문서 ID
 * @param {object} docContext - 문서 맥락 정보
 * @param {string} docContext.title - 문서 제목
 * @param {string} docContext.summary - 문서 요약
 * @param {string} docContext.category - 카테고리
 * @param {string[]} docContext.tags - 태그 배열
 * @param {string[]} docContext.keywords - 키워드 배열
 */
async function generateEnrichedEmbeddings(db, documentId, docContext = {}, onProgress = null, chunkStrategy = 'sentence') {
  const { title = '', summary = '', category = '', tags = [], keywords = [] } = docContext;

  // 1) 문서의 모든 섹션 조회
  const savedSections = await db.query(
    'SELECT id, raw_text, summary, metadata FROM document_sections WHERE document_id = $1 ORDER BY id',
    [documentId]
  );

  let totalChunks = 0;
  const validSections = savedSections.rows.filter(s => s.raw_text && s.raw_text.trim().length > 0);

  // 섹션을 CONCURRENCY개씩 병렬 처리 (API rate limit 고려)
  const CONCURRENCY = 5;

  for (let batchStart = 0; batchStart < validSections.length; batchStart += CONCURRENCY) {
    const batch = validSections.slice(batchStart, batchStart + CONCURRENCY);

    // 배치 내 섹션들을 병렬로 임베딩 생성
    const batchResults = await Promise.all(batch.map(async (section) => {
      const sectionMeta = section.metadata || {};
      const sectionSummary = section.summary || '';

      // 2) 전략에 따라 원문 청크 분할
      const chunks = await smartChunk(section.raw_text, chunkStrategy);
      if (chunks.length === 0) return [];

      // 3) 각 청크에 맥락 정보 추가 → enriched text 생성
      const enrichedTexts = chunks.map(chunk => buildEnrichedText({
        chunkText: chunk,
        docTitle: title,
        docSummary: summary,
        category,
        tags,
        keywords,
        sectionSummary,
        sectionMeta,
      }));

      // 4) enriched text로 임베딩 생성 (배치)
      const embeddings = await generateEmbeddings(enrichedTexts);

      return chunks.map((chunk, i) => ({
        sectionId: section.id,
        chunkText: chunk,
        enrichedText: enrichedTexts[i],
        embedding: embeddings[i],
        chunkIndex: i,
      }));
    }));

    // 5) DB 배치 INSERT (한 배치의 모든 청크를 한 번에)
    const allRows = batchResults.flat();
    if (allRows.length > 0) {
      // 10개씩 묶어서 다중 VALUES INSERT
      const DB_BATCH = 10;
      for (let di = 0; di < allRows.length; di += DB_BATCH) {
        const dbBatch = allRows.slice(di, di + DB_BATCH);
        const values = [];
        const params = [];
        dbBatch.forEach((row, idx) => {
          const base = idx * 5;
          values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::vector, $${base + 5})`);
          params.push(row.sectionId, row.chunkText, row.enrichedText, `[${row.embedding.join(',')}]`, row.chunkIndex);
        });
        await db.query(
          `INSERT INTO document_chunks (section_id, chunk_text, enriched_text, embedding, chunk_index)
           VALUES ${values.join(', ')}`,
          params
        );
      }
      totalChunks += allRows.length;
    }

    // 진행률 콜백 호출
    if (onProgress) {
      onProgress(Math.min(batchStart + CONCURRENCY, validSections.length), validSections.length, totalChunks);
    }
  }

  // 6) 문서 요약 벡터 생성
  if (summary && summary.trim().length > 0) {
    try {
      const summaryVec = await generateEmbedding(summary);
      const vecStr = `[${summaryVec.join(',')}]`;
      await db.query(
        'UPDATE documents SET summary_embedding = $1::vector WHERE id = $2',
        [vecStr, documentId]
      );
    } catch (err) {
      console.error(`[Embeddings] 문서 요약 벡터 생성 실패:`, err.message);
    }
  }

  // 7) 임베딩 상태 업데이트
  await db.query(
    `UPDATE documents SET embedding_status = 'done' WHERE id = $1`,
    [documentId]
  );

  return totalChunks;
}

/**
 * 문서의 섹션들에 대해 기본 임베딩을 생성하고 DB에 저장
 * (upload.js / url-import.js / law-import.js 공통)
 *
 * 성공 시 embedding_status = 'done', 실패 시 'failed'로 업데이트
 * @param {object} db - { query } DB 헬퍼
 * @param {number} documentId - 문서 ID
 * @param {string} [label] - 로그 라벨 (예: 'Upload', 'URL Import')
 * @returns {Promise<{ status: string, totalChunks?: number, error?: string }>}
 */
async function createEmbeddingsForDocument(db, documentId, label = 'Embed', chunkStrategy = 'sentence') {
  try {
    let totalChunks = 0;
    const savedSections = await db.query(
      'SELECT id, raw_text FROM document_sections WHERE document_id = $1 ORDER BY id',
      [documentId]
    );

    for (const section of savedSections.rows) {
      if (!section.raw_text || section.raw_text.trim().length === 0) continue;

      // 전략에 따라 청크 분할 (smartChunk는 async)
      const chunks = await smartChunk(section.raw_text, chunkStrategy);
      if (chunks.length === 0) continue;

      const embeddings = await generateEmbeddings(chunks);
      for (let i = 0; i < chunks.length; i++) {
        const vecStr = `[${embeddings[i].join(',')}]`;
        await db.query(
          `INSERT INTO document_chunks (section_id, chunk_text, embedding, chunk_index)
           VALUES ($1, $2, $3::vector, $4)`,
          [section.id, chunks[i], vecStr, i]
        );
      }
      totalChunks += chunks.length;
    }

    await db.query(`UPDATE documents SET embedding_status = 'done' WHERE id = $1`, [documentId]);
    console.log(`[${label}] 임베딩 완료: 문서 ID ${documentId}, ${totalChunks}개 청크`);
    return { status: 'done', totalChunks };
  } catch (embErr) {
    await db.query(`UPDATE documents SET embedding_status = 'failed' WHERE id = $1`, [documentId]).catch(() => {});
    console.error(`[${label}] 임베딩 실패 (문서 ID ${documentId}):`, embErr.message);
    return { status: 'failed', error: embErr.message };
  }
}

module.exports = {
  chunkText,
  generateEmbeddings,
  generateEmbedding,
  buildEnrichedText,
  generateEnrichedEmbeddings,
  createEmbeddingsForDocument,
};
