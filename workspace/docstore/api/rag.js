// RAG (Retrieval-Augmented Generation) 질의응답 API
// POST /api/rag
// { question, topK, provider, history, docId, docIds, llmOptions, useVerify }
//
// 상태 그래프 기반 파이프라인:
//   search → augment → generate → parse → (verify) → finalize
//
// 각 노드는 lib/rag-graph.js에 정의되며, 조건부 엣지와 재시도를 지원한다.
// 이 파일은 HTTP 레이어(인증/CORS/SSE/응답 포맷)만 담당한다.
const { query } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { checkRateLimit } = require('../lib/rate-limit');
const { sendError } = require('../lib/error-handler');
const { createTrace, finalizeTrace } = require('../lib/langfuse');
const { setDbQuery } = require('../lib/prompt-manager');
const { createRagTracer } = require('../lib/rag-tracer');
const { createRAGGraph } = require('../lib/rag-graph');

// 프롬프트 매니저에 DB 쿼리 함수 연결
setDbQuery(query);

// SSE 헬퍼: 이벤트 데이터를 SSE 형식으로 전송
function sseWrite(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

module.exports = async (req, res) => {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return;

  const { user, orgId, error: authError } = requireAuth(req);
  if (authError) return res.status(401).json({ error: authError });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  if (await checkRateLimit(req, res, 'rag')) return;

  const {
    question, topK = 5, docId, docIds,
    provider = 'gemini', history = [], llmOptions = {}, stream = false,
    useQueryRewrite = true, useHyDE = true, useMorpheme = false,
    useVerify = false,
  } = req.body;
  if (!question || question.trim().length === 0) {
    return res.status(400).json({ error: '질문(question)이 필요합니다.' });
  }

  // LangFuse 트레이스 생성
  const trace = createTrace({
    name: 'rag-query',
    input: question.trim(),
    metadata: { provider, stream, topK, useQueryRewrite, useHyDE, useMorpheme, useVerify },
    userId: user,
    tags: ['rag', provider],
  });

  // RAG 자체 트레이서 생성
  const tracer = createRagTracer(query, {
    question: question.trim(),
    userId: user,
    provider,
    model: llmOptions.model || null,
    options: { topK, stream, useQueryRewrite, useHyDE, useMorpheme, useVerify },
  });

  // 문서 필터: docIds(배열) 우선, docId(단일) 하위 호환
  const resolvedDocIds = Array.isArray(docIds) && docIds.length > 0
    ? docIds.map(id => parseInt(id, 10))
    : docId ? [parseInt(docId, 10)] : [];

  // SSE 스트리밍: 헤더 설정
  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
  }

  // SSE 이벤트 콜백: 그래프 노드 → HTTP 응답 연결
  const onEvent = stream ? (type, data) => {
    try { sseWrite(res, { type, ...data }); } catch {}
  } : null;

  // ── 상태 그래프 초기 상태 조립 ──
  const initialState = {
    // 입력
    question: question.trim(),
    topK,
    docIds: resolvedDocIds,
    orgId,
    provider,
    history,
    llmOptions,
    stream,
    useQueryRewrite,
    useHyDE,
    useMorpheme,
    useVerify,
    // 컨텍스트
    trace,
    tracer,
    dbQuery: query,
    onEvent,
    // 출력 (노드에서 채워짐)
    sources: [],
    searchResult: null,
    enhancement: {},
    category: 'default',
    contextText: '',
    triplesData: null,
    prompt: '',
    promptResult: null,
    callOpts: {},
    sourcesData: [],
    rawAnswer: '',
    parsed: null,
    verification: null,
    // 제어
    error: null,
    currentNode: null,
    retries: {},
    status: 'running',
  };

  try {
    // 상태 그래프 실행
    const graph = createRAGGraph();
    const finalState = await graph.invoke(initialState);

    // ── 응답 출력 ──
    if (stream) {
      // 스트리밍: sources=0인 경우 빈 결과 메시지 전송
      if (finalState.sources.length === 0 && !finalState.rawAnswer) {
        sseWrite(res, { type: 'token', token: '관련된 문서를 찾을 수 없습니다. 먼저 관련 법령이나 문서를 임포트해주세요.' });
        sseWrite(res, { type: 'done' });
      }
      // done 이벤트는 finalizeNode에서 이미 전송됨
      await finalizeTrace(trace, {
        output: finalState.parsed?.conclusion || finalState.rawAnswer?.substring(0, 300) || '관련 문서 없음',
      });
      res.end();
    } else {
      // JSON 응답
      if (finalState.sources.length === 0) {
        await finalizeTrace(trace, { output: '관련 문서 없음' });
        return res.json({
          question: question.trim(),
          answer: '관련된 문서를 찾을 수 없습니다. 먼저 관련 법령이나 문서를 임포트해주세요.',
          sources: [],
          provider,
        });
      }

      await finalizeTrace(trace, {
        output: finalState.parsed?.conclusion || finalState.rawAnswer?.substring(0, 300) || '',
        metadata: {
          hops: finalState.searchResult?.hops,
          sourcesCount: finalState.sources.length,
          format: finalState.parsed?.format,
          category: finalState.category,
        },
      });

      res.json({
        question: question.trim(),
        answer: finalState.parsed?.raw || finalState.rawAnswer,
        parsed: finalState.parsed,
        provider,
        hops: finalState.searchResult?.hops || 1,
        crossRefs: finalState.searchResult?.crossRefs || [],
        knowledgeGraph: finalState.triplesData,
        enhancement: finalState.enhancement,
        sources: finalState.sourcesData,
        verification: finalState.verification,
        promptTemplate: finalState.promptResult
          ? { category: finalState.promptResult.matchedCategory, fromDb: finalState.promptResult.fromDb }
          : null,
        // 상태 그래프 메타
        graph: {
          status: finalState.status,
          retries: finalState.retries,
        },
      });
    }
  } catch (err) {
    tracer.setError(err);
    await tracer.save();
    await finalizeTrace(trace, { output: `ERROR: ${err.message}` });
    if (stream) {
      try { sseWrite(res, { type: 'error', error: err.message }); } catch {}
      res.end();
    } else {
      sendError(res, err, '[RAG-Graph]');
    }
  }
};
