// RAG 자체 트레이싱 모듈
//
// RAG 파이프라인의 전 과정을 rag_traces 테이블에 기록한다.
// 각 단계에서 tracer.setXxx() 메서드로 데이터를 수집하고,
// 마지막에 tracer.save()로 한 번에 DB에 저장한다.
//
// 사용 예:
//   const tracer = createRagTracer(query, { question, userId });
//   tracer.setQueryRewrite(rewriteResult);
//   tracer.setSearchResults(sources, hops);
//   tracer.setLLMOutput(rawOutput, tokensIn, tokensOut);
//   tracer.setParsedOutput(parsed);
//   await tracer.save();

const { COST_TABLE } = require('./api-tracker');

let _ensured = false;

// 테이블 자동 생성 (최초 1회)
async function ensureTable(dbQuery) {
  if (_ensured) return;
  try {
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS rag_traces (
        id SERIAL PRIMARY KEY,
        question TEXT NOT NULL,
        user_id TEXT,
        session_id TEXT,
        provider TEXT NOT NULL DEFAULT 'gemini',
        model TEXT,
        category TEXT DEFAULT 'default',
        prompt_template TEXT,
        prompt_from_db BOOLEAN DEFAULT false,
        options JSONB DEFAULT '{}',
        query_rewrite JSONB,
        hyde JSONB,
        search_results JSONB,
        sources_count INTEGER DEFAULT 0,
        hops INTEGER DEFAULT 1,
        cross_refs JSONB,
        prompt_text TEXT,
        llm_raw_output TEXT,
        tokens_in INTEGER DEFAULT 0,
        tokens_out INTEGER DEFAULT 0,
        cost_estimate NUMERIC(10, 6) DEFAULT 0,
        parsed_output JSONB,
        parse_format TEXT,
        parse_warnings JSONB DEFAULT '[]',
        conclusion TEXT,
        verification JSONB,
        total_duration_ms INTEGER DEFAULT 0,
        search_duration_ms INTEGER DEFAULT 0,
        llm_duration_ms INTEGER DEFAULT 0,
        status TEXT DEFAULT 'success',
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    _ensured = true;
  } catch (err) {
    // 테이블 이미 존재하면 무시
    if (!err.message.includes('already exists')) {
      console.warn('[RagTracer] 테이블 생성 실패:', err.message);
    }
    _ensured = true;
  }
}

/**
 * RAG 트레이서 생성
 *
 * @param {Function} dbQuery - DB 쿼리 함수
 * @param {Object} init - { question, userId, sessionId, provider, model, options }
 * @returns {Object} 트레이서 객체
 */
function createRagTracer(dbQuery, init = {}) {
  const startTime = Date.now();

  // 트레이스 데이터 (단계별로 채워짐)
  const data = {
    question: init.question || '',
    user_id: init.userId || null,
    session_id: init.sessionId || null,
    provider: init.provider || 'gemini',
    model: init.model || null,
    category: 'default',
    prompt_template: null,
    prompt_from_db: false,
    options: init.options || {},

    // 쿼리 강화
    query_rewrite: null,
    hyde: null,

    // 검색
    search_results: null,
    sources_count: 0,
    hops: 1,
    cross_refs: null,
    search_duration_ms: 0,

    // LLM
    prompt_text: null,
    llm_raw_output: null,
    tokens_in: 0,
    tokens_out: 0,
    cost_estimate: 0,
    llm_duration_ms: 0,

    // 파싱
    parsed_output: null,
    parse_format: null,
    parse_warnings: [],
    conclusion: null,

    // 검증
    verification: null,

    // 메타
    status: 'success',
    error_message: null,
  };

  // 단계별 타이밍
  let searchStart = 0;
  let llmStart = 0;

  return {
    // ── 쿼리 강화 단계 ──

    /** 쿼리 리라이팅 결과 기록 */
    setQueryRewrite(result) {
      if (!result) return;
      data.query_rewrite = {
        intent: result.intent,
        queries: result.queries,
        keywords: result.keywords,
        timing: result.timing,
        error: result.error || null,
      };
    },

    /** HyDE 가상 문서 결과 기록 */
    setHyDE(result) {
      if (!result) return;
      data.hyde = {
        docLength: result.hypotheticalDoc?.length || 0,
        timing: result.timing,
        error: result.error || null,
        // 가상 문서 전문은 너무 길 수 있으므로 앞 300자만
        excerpt: result.hypotheticalDoc?.substring(0, 300) || null,
      };
    },

    // ── 검색 단계 ──

    /** 검색 시작 타이밍 기록 */
    startSearch() {
      searchStart = Date.now();
    },

    /** 검색 결과 기록 */
    setSearchResults(sources, searchResult) {
      data.search_duration_ms = searchStart ? Date.now() - searchStart : 0;
      data.sources_count = sources?.length || 0;
      data.hops = searchResult?.hops || 1;
      data.cross_refs = searchResult?.crossRefs || null;

      // 검색 결과 요약 (전문 저장 X, 핵심 메타만)
      data.search_results = (sources || []).map((s, i) => ({
        index: i + 1,
        documentTitle: s.documentTitle,
        documentId: s.documentId,
        label: s.label,
        category: s.category,
        similarity: s.similarity,
        textLength: s.text?.length || 0,
        excerpt: s.text?.substring(0, 150) || '',
      }));
    },

    // ── 프롬프트 단계 ──

    /** 사용된 프롬프트 정보 기록 */
    setPromptInfo(promptResult, promptText) {
      data.category = promptResult?.matchedCategory || 'default';
      data.prompt_template = `${promptResult?.matchedCategory || 'default'}`;
      data.prompt_from_db = promptResult?.fromDb || false;
      // 프롬프트 전문은 앞 1000자만 (전체를 저장하면 DB 부담)
      data.prompt_text = promptText?.substring(0, 1000) || null;
    },

    // ── LLM 호출 단계 ──

    /** LLM 호출 시작 타이밍 기록 */
    startLLM() {
      llmStart = Date.now();
    },

    /** LLM 응답 기록 */
    setLLMOutput(rawOutput, tokensIn, tokensOut) {
      data.llm_duration_ms = llmStart ? Date.now() - llmStart : 0;
      data.llm_raw_output = rawOutput || null;
      data.tokens_in = tokensIn || 0;
      data.tokens_out = tokensOut || 0;

      // 비용 추정
      const costKey = `${data.provider}:${data.model || 'unknown'}`;
      const rates = COST_TABLE[costKey] || { in: 0, out: 0 };
      data.cost_estimate = (data.tokens_in * rates.in + data.tokens_out * rates.out) / 1_000_000;
    },

    /** 스트리밍 응답 기록 (토큰 수는 추정) */
    setStreamOutput(accumulated) {
      data.llm_duration_ms = llmStart ? Date.now() - llmStart : 0;
      data.llm_raw_output = accumulated || null;
      // 스트리밍은 토큰 수를 글자 수에서 추정
      data.tokens_in = Math.ceil((data.prompt_text?.length || 0) / 3);
      data.tokens_out = Math.ceil((accumulated?.length || 0) / 3);

      const costKey = `${data.provider}:${data.model || 'unknown'}`;
      const rates = COST_TABLE[costKey] || { in: 0, out: 0 };
      data.cost_estimate = (data.tokens_in * rates.in + data.tokens_out * rates.out) / 1_000_000;
    },

    // ── 파싱 단계 ──

    /** 파싱 결과 기록 */
    setParsedOutput(parsed) {
      if (!parsed) return;
      data.parse_format = parsed.format;
      data.parse_warnings = parsed.warnings || [];
      data.conclusion = parsed.conclusion?.substring(0, 500) || null;

      // 구조화된 파싱 결과 (근거 체인, 교차 참조 등)
      data.parsed_output = {
        format: parsed.format,
        parsed: parsed.parsed,
        conclusionLength: parsed.conclusion?.length || 0,
        evidenceCount: parsed.evidenceChain?.length || 0,
        crossRefCount: parsed.crossReferences?.length || 0,
        hasCaveats: !!parsed.caveats,
        warningCount: parsed.warnings?.length || 0,
        // 근거 체인 요약
        evidenceChain: (parsed.evidenceChain || []).map(e => ({
          sourceIndex: e.sourceIndex,
          sourceLabel: e.sourceLabel,
          verified: e.verified,
        })),
      };
    },

    // ── 검증 단계 ──

    /** 답변 검증 결과 기록 */
    setVerification(result) {
      data.verification = result || null;
    },

    // ── 에러 ──

    /** 에러 기록 */
    setError(err) {
      data.status = 'error';
      data.error_message = err?.message || String(err);
    },

    // ── 저장 ──

    /** 트레이스를 DB에 저장 (비동기, 실패해도 메인 로직에 영향 없음) */
    async save() {
      data.total_duration_ms = Date.now() - startTime;

      try {
        await ensureTable(dbQuery);

        await dbQuery(
          `INSERT INTO rag_traces (
            question, user_id, session_id,
            provider, model, category, prompt_template, prompt_from_db, options,
            query_rewrite, hyde,
            search_results, sources_count, hops, cross_refs,
            prompt_text, llm_raw_output, tokens_in, tokens_out, cost_estimate,
            parsed_output, parse_format, parse_warnings, conclusion,
            verification,
            total_duration_ms, search_duration_ms, llm_duration_ms,
            status, error_message
          ) VALUES (
            $1, $2, $3,
            $4, $5, $6, $7, $8, $9,
            $10, $11,
            $12, $13, $14, $15,
            $16, $17, $18, $19, $20,
            $21, $22, $23, $24,
            $25,
            $26, $27, $28,
            $29, $30
          )`,
          [
            data.question, data.user_id, data.session_id,
            data.provider, data.model, data.category, data.prompt_template, data.prompt_from_db, JSON.stringify(data.options),
            JSON.stringify(data.query_rewrite), JSON.stringify(data.hyde),
            JSON.stringify(data.search_results), data.sources_count, data.hops, JSON.stringify(data.cross_refs),
            data.prompt_text, data.llm_raw_output, data.tokens_in, data.tokens_out, data.cost_estimate,
            JSON.stringify(data.parsed_output), data.parse_format, JSON.stringify(data.parse_warnings), data.conclusion,
            JSON.stringify(data.verification),
            data.total_duration_ms, data.search_duration_ms, data.llm_duration_ms,
            data.status, data.error_message,
          ]
        );
      } catch (err) {
        // 트레이싱 실패해도 RAG 응답에 영향 없음
        console.warn('[RagTracer] 저장 실패:', err.message);
      }
    },

    /** 현재까지 수집된 데이터 반환 (디버깅용) */
    getData() {
      return { ...data, total_duration_ms: Date.now() - startTime };
    },
  };
}

module.exports = { createRagTracer };
