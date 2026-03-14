// 임베딩 생성 유틸리티 (멀티 모델 지원)
//
// 지원 모델:
//   1. OpenAI text-embedding-3-small (1536차원, 기본값)
//   2. Upstage solar-embedding-1-large (4096차원, 한국어 1위)
//   3. Cohere embed-multilingual-v3.0 (1024차원, 검색 최적화)
//
// 모델 선택은 app_settings 테이블의 'embeddingModel' 키로 관리.
// 모델 변경 시 차원이 달라지므로 기존 임베딩 재생성 필요.

const OpenAI = require('openai');
const { smartChunk, parentDocChunk } = require('./text-splitters');
const { trackUsage, checkDailyLimit } = require('./api-tracker');
const { buildMorphemeTsvector } = require('./korean-tokenizer');
const { trackEmbeddingCall } = require('./langfuse');

// ── 임베딩 모델 정의 ──
const EMBEDDING_MODELS = {
  'openai': {
    id: 'openai',
    label: 'OpenAI',
    model: 'text-embedding-3-small',
    dimensions: 1536,
    provider: 'openai',
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: null, // OpenAI SDK 기본
    maxBatch: 100,
    description: '범용 임베딩, 빠르고 저렴',
  },
  'upstage': {
    id: 'upstage',
    label: 'Upstage Solar',
    model: 'embedding-passage',        // 문서 저장용 (별칭)
    queryModel: 'embedding-query',     // 검색 쿼리용 (별칭)
    dimensions: 4096,
    provider: 'upstage',
    apiKeyEnv: 'UPSTAGE_API_KEY',
    baseUrl: 'https://api.upstage.ai/v1',
    maxBatch: 100,
    description: '한국어 임베딩 1위, 법률 문서에 최적',
  },
  'cohere': {
    id: 'cohere',
    label: 'Cohere embed-v3',
    model: 'embed-multilingual-v3.0',
    dimensions: 1024,
    provider: 'cohere',
    apiKeyEnv: 'COHERE_API_KEY',
    baseUrl: 'https://api.cohere.com/v2',
    maxBatch: 96,
    description: '다국어 검색 최적화, Reranker와 시너지',
  },
};

// 현재 활성 모델 (TTL 캐시 — 서버리스 인스턴스 간 동기화 문제 방지)
let _activeModelId = null;
let _activeModelCachedAt = 0;
const MODEL_CACHE_TTL_MS = 10000; // 10초 TTL (서버리스 환경에서 빠른 갱신)

// OpenAI 호환 클라이언트 캐시 (provider별)
const _clients = {};

// DB 벡터 컬럼 차원 (동적으로 변경 가능)
let DB_VECTOR_DIMENSIONS = 1536;

/**
 * 현재 활성 임베딩 모델 ID 조회
 * DB app_settings에서 읽되, 10초 TTL 캐시 사용
 * (Vercel 서버리스에서는 인스턴스별 메모리가 분리되므로 짧은 TTL 필수)
 */
async function getActiveModelId(dbQuery) {
  // TTL 이내면 캐시 반환
  if (_activeModelId && (Date.now() - _activeModelCachedAt) < MODEL_CACHE_TTL_MS) {
    return _activeModelId;
  }

  if (dbQuery) {
    try {
      const result = await dbQuery(
        "SELECT value FROM app_settings WHERE key = 'embeddingModel'"
      );
      if (result.rows.length > 0) {
        const val = result.rows[0].value;
        // JSONB이므로 문자열이거나 객체일 수 있음
        const modelId = typeof val === 'string' ? val : val?.id || 'openai';
        if (EMBEDDING_MODELS[modelId]) {
          _activeModelId = modelId;
          _activeModelCachedAt = Date.now();
          // DB 벡터 차원을 현재 모델에 맞춤
          DB_VECTOR_DIMENSIONS = EMBEDDING_MODELS[modelId].dimensions;
          return modelId;
        }
      }
    } catch {
      // app_settings 테이블 없을 수 있음 → 기본값
    }
  }
  return 'openai';
}

/**
 * 활성 모델 캐시 초기화 (설정 변경 시 호출)
 */
function resetModelCache() {
  _activeModelId = null;
  _activeModelCachedAt = 0;
}

/**
 * 모델 정보 반환
 */
function getModelConfig(modelId) {
  return EMBEDDING_MODELS[modelId] || EMBEDDING_MODELS['openai'];
}

/**
 * 사용 가능한 모델 목록 (API 키가 설정된 것만)
 */
function getAvailableModels() {
  return Object.values(EMBEDDING_MODELS).map(m => ({
    id: m.id,
    label: m.label,
    model: m.model,
    dimensions: m.dimensions,
    description: m.description,
    available: !!process.env[m.apiKeyEnv],
  }));
}

// ── OpenAI 호환 클라이언트 (OpenAI, Upstage 공용) ──
function getOpenAIClient(modelConfig) {
  const key = modelConfig.id;
  if (!_clients[key]) {
    const opts = { apiKey: process.env[modelConfig.apiKeyEnv] };
    if (modelConfig.baseUrl) opts.baseURL = modelConfig.baseUrl;
    _clients[key] = new OpenAI(opts);
  }
  return _clients[key];
}

// ── Cohere 임베딩 (REST API 직접 호출) ──
async function cohereEmbed(texts, inputType = 'search_document') {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) throw new Error('COHERE_API_KEY가 설정되지 않았습니다.');

  const response = await fetch('https://api.cohere.com/v2/embed', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      texts,
      model: 'embed-multilingual-v3.0',
      input_type: inputType,
      embedding_types: ['float'],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Cohere API 오류 (${response.status}): ${err}`);
  }

  const data = await response.json();
  return data.embeddings.float;
}

// ── 공통 임베딩 생성 함수 ──

/**
 * 청크 배열을 받아 임베딩 벡터 배열 반환
 * @param {string[]} chunks - 텍스트 청크 배열
 * @param {string} [modelId] - 사용할 모델 ID (생략 시 활성 모델)
 * @param {string} [inputType] - Cohere용 입력 타입 ('search_document' | 'search_query')
 * @returns {Promise<number[][]>} 임베딩 벡터 배열
 */
async function generateEmbeddings(chunks, modelId, inputType = 'search_document') {
  if (!chunks || chunks.length === 0) return [];

  const resolvedId = modelId || _activeModelId || 'openai';
  const config = getModelConfig(resolvedId);

  // API 키 비활성/한도 체크
  const limitCheck = await checkDailyLimit(config.provider);
  if (!limitCheck.allowed) {
    const msg = limitCheck.reason === 'key_disabled'
      ? `${config.provider} API 키가 비활성 상태입니다. 설정에서 활성화해주세요.`
      : `${config.provider} 일일 호출 한도 초과 (${limitCheck.usage}/${limitCheck.limit})`;
    throw new Error(msg);
  }

  if (config.provider === 'cohere') {
    // Cohere: 배치 크기 제한
    const allEmbeddings = [];
    for (let i = 0; i < chunks.length; i += config.maxBatch) {
      const batch = chunks.slice(i, i + config.maxBatch);
      const embeddings = await cohereEmbed(batch, inputType);
      allEmbeddings.push(...embeddings);
    }
    trackUsage({
      provider: 'cohere', model: config.model, endpoint: 'embeddings-batch',
      tokensIn: chunks.join('').length, tokensOut: 0, status: 'success',
    }).catch(() => {});
    return allEmbeddings;
  }

  // OpenAI / Upstage: OpenAI SDK 호환
  const client = getOpenAIClient(config);
  // Upstage: inputType에 따라 query/passage 모델 분기
  const modelName = (config.provider === 'upstage' && inputType === 'search_query' && config.queryModel)
    ? config.queryModel
    : config.model;
  const response = await client.embeddings.create({
    model: modelName,
    input: chunks,
  });

  trackUsage({
    provider: config.provider, model: modelName, endpoint: 'embeddings-batch',
    tokensIn: response.usage?.total_tokens || 0, tokensOut: 0, status: 'success',
  }).catch(() => {});

  return response.data
    .sort((a, b) => a.index - b.index)
    .map(item => item.embedding);
}

/**
 * 단일 텍스트의 임베딩 벡터 반환
 * @param {string} text - 텍스트
 * @param {string} [modelId] - 사용할 모델 ID
 * @param {string} [inputType] - Cohere용 입력 타입
 * @returns {Promise<number[]>} 임베딩 벡터
 */
async function generateEmbedding(text, modelId, inputType = 'search_query') {
  const resolvedId = modelId || _activeModelId || 'openai';
  const config = getModelConfig(resolvedId);

  // API 키 비활성/한도 체크
  const limitCheck = await checkDailyLimit(config.provider);
  if (!limitCheck.allowed) {
    const msg = limitCheck.reason === 'key_disabled'
      ? `${config.provider} API 키가 비활성 상태입니다. 설정에서 활성화해주세요.`
      : `${config.provider} 일일 호출 한도 초과 (${limitCheck.usage}/${limitCheck.limit})`;
    throw new Error(msg);
  }

  if (config.provider === 'cohere') {
    const embeddings = await cohereEmbed([text], inputType);
    trackUsage({
      provider: 'cohere', model: config.model, endpoint: 'embedding-single',
      tokensIn: text.length, tokensOut: 0, status: 'success',
    }).catch(() => {});
    return embeddings[0];
  }

  // OpenAI / Upstage
  const client = getOpenAIClient(config);
  // Upstage: inputType에 따라 query/passage 모델 분기
  const modelName = (config.provider === 'upstage' && inputType === 'search_query' && config.queryModel)
    ? config.queryModel
    : config.model;
  const response = await client.embeddings.create({
    model: modelName,
    input: text,
  });

  trackUsage({
    provider: config.provider, model: modelName, endpoint: 'embedding-single',
    tokensIn: response.usage?.total_tokens || 0, tokensOut: 0, status: 'success',
  }).catch(() => {});

  return response.data[0].embedding;
}

/**
 * 텍스트를 청크로 분할
 */
function chunkText(text, chunkSize = 500, overlap = 100) {
  if (!text || text.trim().length === 0) return [];

  const sentences = text.match(/[^.!?]+[.!?]?\s*/g) || [text];
  const chunks = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length <= chunkSize) {
      currentChunk += sentence;
    } else {
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
      }
      if (overlap > 0 && currentChunk.length > overlap) {
        currentChunk = currentChunk.slice(-overlap) + sentence;
      } else {
        currentChunk = sentence;
      }
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * 청크에 맥락 정보를 붙여서 "enriched text" 생성
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

  if (docTitle) parts.push(`[문서] ${docTitle}`);
  if (category) parts.push(`[분류] ${category}`);
  if (tags.length > 0) parts.push(`[태그] ${tags.join(', ')}`);
  if (keywords.length > 0) parts.push(`[키워드] ${keywords.join(', ')}`);
  if (docSummary) parts.push(`[문서요약] ${docSummary}`);

  const { label, chapter, section, articleTitle } = sectionMeta;
  if (chapter) parts.push(`[장] ${chapter}`);
  if (section) parts.push(`[절] ${section}`);
  if (label) parts.push(`[조항] ${label}`);
  if (articleTitle) parts.push(`[조항제목] ${articleTitle}`);
  if (sectionSummary) parts.push(`[섹션요약] ${sectionSummary}`);

  parts.push(chunkText);

  return parts.join('\n');
}

/**
 * 문서의 섹션들에 대해 enriched 임베딩을 생성하고 DB에 저장
 */
async function generateEnrichedEmbeddings(db, documentId, docContext = {}, onProgress = null, chunkStrategy = 'sentence', chunkOptions = {}) {
  const { title = '', summary = '', category = '', tags = [], keywords = [] } = docContext;

  // 캐시를 무시하고 DB에서 최신 모델 정보를 확인 (서버리스 인스턴스 간 동기화)
  resetModelCache();
  const modelId = await getActiveModelId(db.query);
  const config = getModelConfig(modelId);
  console.log(`[Embeddings] 모델: ${config.label} (${config.model}, ${config.dimensions}차원)`);

  // DB 벡터 컬럼 차원 확인 (불일치 시 자동 마이그레이션)
  try {
    const dimCheck = await db.query(
      `SELECT atttypmod FROM pg_attribute
       WHERE attrelid = 'document_chunks'::regclass AND attname = 'embedding'`
    );
    if (dimCheck.rows.length > 0) {
      const dbDim = dimCheck.rows[0].atttypmod;
      if (dbDim > 0 && dbDim !== config.dimensions) {
        console.warn(`[Embeddings] DB 벡터 차원(${dbDim}) ≠ 모델 차원(${config.dimensions}), 자동 마이그레이션 실행`);
        await migrateVectorDimension(db.query, config.dimensions);
      }
    }
  } catch (dimErr) {
    console.warn(`[Embeddings] 벡터 차원 확인 건너뜀:`, dimErr.message);
  }

  const savedSections = await db.query(
    'SELECT id, raw_text, summary, metadata FROM document_sections WHERE document_id = $1 ORDER BY id',
    [documentId]
  );

  let totalChunks = 0;
  const validSections = savedSections.rows.filter(s => s.raw_text && s.raw_text.trim().length > 0);
  const CONCURRENCY = 5;

  // Parent Document 전략 여부
  const isParentDoc = chunkStrategy === 'parent-doc';

  for (let batchStart = 0; batchStart < validSections.length; batchStart += CONCURRENCY) {
    const batch = validSections.slice(batchStart, batchStart + CONCURRENCY);

    const batchResults = await Promise.all(batch.map(async (section) => {
      const sectionMeta = section.metadata || {};
      const sectionSummary = section.summary || '';

      // ── Parent Document 전략: 부모+자식 이중 저장 ──
      if (isParentDoc) {
        const parentSize = chunkOptions.chunkSize || 800;
        const childSize = chunkOptions.childSize || 200;
        const childOverlap = chunkOptions.childOverlap || 50;

        const { parents, children } = parentDocChunk(
          section.raw_text, parentSize, childSize, childOverlap
        );
        if (children.length === 0) return [];

        // 자식 청크의 enriched 텍스트 생성 (검색용 임베딩에 사용)
        const enrichedTexts = children.map(child => buildEnrichedText({
          chunkText: child.text,
          docTitle: title,
          docSummary: summary,
          category,
          tags,
          keywords,
          sectionSummary,
          sectionMeta,
        }));

        // 자식 청크에 대한 임베딩 생성 (작은 200자 → 정밀 검색)
        const embeddings = await generateEmbeddings(enrichedTexts, modelId, 'search_document');

        // 형태소 분석 tsvector (자식 기준)
        let morphTexts = [];
        try {
          morphTexts = await Promise.all(
            children.map(child => buildMorphemeTsvector(child.text))
          );
        } catch (e) {
          console.warn('[Embeddings] 형태소 tsvector 생성 건너뜀:', e.message);
          morphTexts = children.map(() => '');
        }

        // chunk_text에는 부모 텍스트를 저장 (RAG 컨텍스트용)
        // enriched_text에는 자식 enriched를 저장 (임베딩과 매칭)
        // metadata에 parentIndex, childIndex를 기록
        return children.map((child, i) => ({
          sectionId: section.id,
          // chunk_text = 부모 텍스트 (RAG에서 읽히는 값)
          chunkText: parents[child.parentIndex] || child.text,
          enrichedText: enrichedTexts[i],
          // embedding = 자식 기준 임베딩 (검색에 사용되는 값)
          embedding: embeddings[i],
          chunkIndex: i,
          morphemeText: morphTexts[i] || '',
          // 부모-자식 메타 (검색 후 중복 제거에 활용)
          parentIndex: child.parentIndex,
        }));
      }

      // ── 기존 전략: 단일 청크 저장 ──
      const chunks = await smartChunk(section.raw_text, chunkStrategy, chunkOptions);
      if (chunks.length === 0) return [];

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

      // 임베딩 생성 (인덱싱용 = search_document)
      const embeddings = await generateEmbeddings(enrichedTexts, modelId, 'search_document');

      // 형태소 분석 tsvector
      let morphTexts = [];
      try {
        const morphResults = await Promise.all(
          chunks.map(chunk => buildMorphemeTsvector(chunk))
        );
        morphTexts = morphResults;
      } catch (e) {
        console.warn('[Embeddings] 형태소 tsvector 생성 건너뜀:', e.message);
        morphTexts = chunks.map(() => '');
      }

      return chunks.map((chunk, i) => ({
        sectionId: section.id,
        chunkText: chunk,
        enrichedText: enrichedTexts[i],
        embedding: embeddings[i],
        chunkIndex: i,
        morphemeText: morphTexts[i] || '',
      }));
    }));

    const allRows = batchResults.flat();
    if (allRows.length > 0) {
      const DB_BATCH = 10;
      for (let di = 0; di < allRows.length; di += DB_BATCH) {
        const dbBatch = allRows.slice(di, di + DB_BATCH);
        const hasMorpheme = dbBatch.some(r => r.morphemeText);
        const values = [];
        const params = [];
        const colsPerRow = hasMorpheme ? 6 : 5;
        dbBatch.forEach((row, idx) => {
          const base = idx * colsPerRow;
          if (hasMorpheme) {
            values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::vector, $${base + 5}, to_tsvector('simple', $${base + 6}))`);
            params.push(row.sectionId, row.chunkText, row.enrichedText, `[${row.embedding.join(',')}]`, row.chunkIndex, row.morphemeText || '');
          } else {
            values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::vector, $${base + 5})`);
            params.push(row.sectionId, row.chunkText, row.enrichedText, `[${row.embedding.join(',')}]`, row.chunkIndex);
          }
        });
        const cols = hasMorpheme
          ? 'section_id, chunk_text, enriched_text, embedding, chunk_index, fts_morpheme_vector'
          : 'section_id, chunk_text, enriched_text, embedding, chunk_index';
        await db.query(
          `INSERT INTO document_chunks (${cols})
           VALUES ${values.join(', ')}`,
          params
        );
      }
      totalChunks += allRows.length;
    }

    if (onProgress) {
      onProgress(Math.min(batchStart + CONCURRENCY, validSections.length), validSections.length, totalChunks);
    }
  }

  // 문서 요약 벡터 생성
  if (summary && summary.trim().length > 0) {
    try {
      const summaryVec = await generateEmbedding(summary, modelId, 'search_document');
      const vecStr = `[${summaryVec.join(',')}]`;
      await db.query(
        'UPDATE documents SET summary_embedding = $1::vector WHERE id = $2',
        [vecStr, documentId]
      );
    } catch (err) {
      console.error(`[Embeddings] 문서 요약 벡터 생성 실패:`, err.message);
    }
  }

  // 임베딩 상태 + 사용 모델 업데이트
  await db.query(
    `UPDATE documents SET embedding_status = 'done' WHERE id = $1`,
    [documentId]
  );

  return totalChunks;
}

/**
 * 문서의 섹션들에 대해 기본 임베딩을 생성하고 DB에 저장
 */
async function createEmbeddingsForDocument(db, documentId, label = 'Embed', chunkStrategy = 'sentence', chunkOptions = {}) {
  try {
    // 캐시를 무시하고 DB에서 최신 모델 정보를 확인 (서버리스 인스턴스 간 동기화)
    resetModelCache();
    const modelId = await getActiveModelId(db.query);
    const config = getModelConfig(modelId);
    console.log(`[${label}] 임베딩 모델: ${config.label} (${config.model}, ${config.dimensions}차원)`);

    // DB 벡터 컬럼 차원 확인 (불일치 시 자동 마이그레이션)
    try {
      const dimCheck = await db.query(
        `SELECT atttypmod FROM pg_attribute
         WHERE attrelid = 'document_chunks'::regclass AND attname = 'embedding'`
      );
      if (dimCheck.rows.length > 0) {
        const dbDim = dimCheck.rows[0].atttypmod;
        if (dbDim > 0 && dbDim !== config.dimensions) {
          console.warn(`[${label}] DB 벡터 차원(${dbDim}) ≠ 모델 차원(${config.dimensions}), 자동 마이그레이션 실행`);
          await migrateVectorDimension(db.query, config.dimensions);
        }
      }
    } catch (dimErr) {
      console.warn(`[${label}] 벡터 차원 확인 건너뜀:`, dimErr.message);
    }

    // 기존 청크 삭제 (재생성 시 중복 방지)
    await db.query(
      `DELETE FROM document_chunks WHERE section_id IN
       (SELECT id FROM document_sections WHERE document_id = $1)`,
      [documentId]
    );

    let totalChunks = 0;
    const savedSections = await db.query(
      'SELECT id, raw_text FROM document_sections WHERE document_id = $1 ORDER BY id',
      [documentId]
    );

    for (const section of savedSections.rows) {
      if (!section.raw_text || section.raw_text.trim().length === 0) continue;

      const chunks = await smartChunk(section.raw_text, chunkStrategy, chunkOptions);
      if (chunks.length === 0) continue;

      const embeddings = await generateEmbeddings(chunks, modelId, 'search_document');

      // 임베딩 차원 검증
      if (embeddings.length > 0 && embeddings[0].length !== config.dimensions) {
        throw new Error(`임베딩 차원 불일치: API 반환 ${embeddings[0].length}차원, 기대값 ${config.dimensions}차원`);
      }

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
    console.log(`[${label}] 임베딩 완료: 문서 ID ${documentId}, ${totalChunks}개 청크 (${config.label})`);
    return { status: 'done', totalChunks };
  } catch (embErr) {
    await db.query(`UPDATE documents SET embedding_status = 'failed' WHERE id = $1`, [documentId]).catch(() => {});
    console.error(`[${label}] 임베딩 실패 (문서 ID ${documentId}):`, embErr.message);
    return { status: 'failed', error: embErr.message };
  }
}

/**
 * DB 벡터 컬럼 차원을 변경 (모델 변경 시 호출)
 * 기존 임베딩 데이터는 삭제됨 → 재생성 필요
 */
async function migrateVectorDimension(dbQuery, newDimensions) {
  try {
    const dim = parseInt(newDimensions);
    if (![1024, 1536, 4096].includes(dim)) throw new Error(`지원하지 않는 차원: ${dim}`);

    // HNSW 인덱스는 2000차원 제한 → 가장 먼저 삭제해야 ALTER TABLE 가능
    await dbQuery('DROP INDEX IF EXISTS idx_chunks_embedding_hnsw');
    await dbQuery('DROP INDEX IF EXISTS idx_chunks_embedding');
    await dbQuery('DROP INDEX IF EXISTS idx_documents_summary_embedding');

    // 기존 임베딩 NULL로 초기화 (차원이 다르면 유지 불가)
    await dbQuery('UPDATE document_chunks SET embedding = NULL');
    await dbQuery('UPDATE documents SET summary_embedding = NULL');

    // 벡터 컬럼 차원 변경 (DDL은 파라미터 바인딩 불가)
    await dbQuery(`ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(${dim}) USING NULL`);
    try {
      await dbQuery(`ALTER TABLE documents ALTER COLUMN summary_embedding TYPE vector(${dim}) USING NULL`);
    } catch (_) { /* summary_embedding 컬럼 없을 수 있음 */ }

    // IVFFlat 인덱스 재생성 (2000차원 이상도 지원)
    if (dim <= 2000) {
      try {
        await dbQuery(`CREATE INDEX idx_chunks_embedding_hnsw ON document_chunks USING hnsw (embedding vector_cosine_ops)`);
      } catch (_) { /* 데이터 없으면 실패 가능 - 나중에 재생성 */ }
    }
    // 2000차원 초과 시 IVFFlat은 데이터가 있어야 생성 가능하므로 나중으로 미룸

    // 문서 임베딩 상태 초기화
    await dbQuery("UPDATE documents SET embedding_status = 'pending' WHERE embedding_status = 'done'");
    DB_VECTOR_DIMENSIONS = newDimensions;
    console.log(`[Embeddings] DB 벡터 차원 변경: ${newDimensions}차원`);
    return { success: true, dimensions: newDimensions };
  } catch (err) {
    console.error('[Embeddings] 벡터 차원 변경 실패:', err.message);
    throw err;
  }
}

module.exports = {
  chunkText,
  generateEmbeddings,
  generateEmbedding,
  buildEnrichedText,
  generateEnrichedEmbeddings,
  createEmbeddingsForDocument,
  // 멀티 모델 지원
  EMBEDDING_MODELS,
  getAvailableModels,
  getActiveModelId,
  getModelConfig,
  resetModelCache,
  migrateVectorDimension,
};
