// RAG (Retrieval-Augmented Generation) 질의응답 API
// POST /api/rag
// { question, topK, provider, history, docId, docIds, llmOptions, useVerify }
//
// 처리 흐름:
// 1) 멀티홉 검색: 질문 벡터화 → 1차 검색 → 참조 추출 → 2차 검색
// 2) 프롬프트 템플릿 로드 (카테고리별 최적화 + Few-shot 예시)
// 3) 근거 체인 프롬프트로 LLM 호출
// 4) (선택) 답변 검증 프롬프트 체인
// 5) 구조화된 답변 + 근거 체인 + 교차 참조 반환
const { query } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { checkRateLimit } = require('../lib/rate-limit');
const { callLLM, callLLMStream } = require('../lib/gemini');
const { sendError } = require('../lib/error-handler');
const { multiHopSearch } = require('../lib/rag-agent');
const { parseRAGOutput } = require('../lib/output-parser');
const { createTrace, createSpan, endSpan, finalizeTrace } = require('../lib/langfuse');
const { setDbQuery, buildPrompt } = require('../lib/prompt-manager');
const { createRagTracer } = require('../lib/rag-tracer');
const { findTriplesForRAG } = require('../lib/knowledge-graph');

// 프롬프트 매니저에 DB 쿼리 함수 연결
setDbQuery(query);

// SSE 헬퍼: 이벤트 데이터를 SSE 형식으로 전송
function sseWrite(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * 검색 결과의 대표 카테고리 결정
 * 근거 자료들의 카테고리 중 가장 많은 것을 선택
 */
function detectCategory(sources) {
  if (!sources || sources.length === 0) return 'default';

  const counts = {};
  for (const s of sources) {
    const cat = s.category || 'default';
    counts[cat] = (counts[cat] || 0) + 1;
  }

  let maxCat = 'default';
  let maxCount = 0;
  for (const [cat, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCat = cat;
      maxCount = count;
    }
  }
  return maxCat;
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
    useVerify = false, // 답변 검증 프롬프트 체인 사용 여부
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

  try {
    // 문서 필터: docIds(배열) 우선, docId(단일) 하위 호환
    const resolvedDocIds = Array.isArray(docIds) && docIds.length > 0
      ? docIds.map(id => parseInt(id, 10))
      : docId ? [parseInt(docId, 10)] : [];

    // SSE 스트리밍: 헤더를 먼저 설정해야 onProgress 콜백에서 sseWrite 가능
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
    }

    // SSE 스트리밍일 때 쿼리 강화 과정을 실시간 전송하는 콜백
    const onProgress = stream ? (progress) => {
      try { sseWrite(res, { type: 'enhancement', ...progress }); } catch {}
    } : null;

    // 검색 단계 스팬
    const searchSpan = createSpan(trace, {
      name: 'multi-hop-search',
      input: question.trim(),
      metadata: { topK, docIds: resolvedDocIds, useQueryRewrite, useHyDE },
    });

    // 1) 멀티홉 검색 (쿼리 리라이팅 + HyDE 포함)
    tracer.startSearch();
    console.log(`[RAG] 질문: "${question.trim().substring(0, 50)}..." (${provider}, rewrite:${useQueryRewrite}, hyde:${useHyDE})`);
    const searchResult = await multiHopSearch(query, question.trim(), {
      topK: Math.min(parseInt(topK, 10) || 5, 10),
      docIds: resolvedDocIds,
      orgId,
      useQueryRewrite,
      useHyDE,
      useMorpheme,
      provider,
      history,
      onProgress,
    });

    const sources = searchResult.sources;
    const enh = searchResult.enhancement || {};

    // 트레이서: 쿼리 강화 + 검색 결과 기록
    tracer.setQueryRewrite(enh.queryRewrite || null);
    tracer.setHyDE(enh.hyde || null);
    tracer.setSearchResults(sources, searchResult);

    console.log(`[RAG] ${sources.length}개 근거 자료 검색 (${searchResult.hops}홉${searchResult.crossRefs ? ', 교차참조: ' + searchResult.crossRefs.length + '건' : ''}${enh.queryRewrite ? ', 리라이팅: ' + enh.queryRewrite.timing + 'ms' : ''}${enh.hyde ? ', HyDE: ' + enh.hyde.timing + 'ms' : ''})`);

    // 검색 스팬 종료
    endSpan(searchSpan, {
      output: { sourcesCount: sources.length, hops: searchResult.hops },
    });

    if (sources.length === 0) {
      await finalizeTrace(trace, { output: '관련 문서 없음' });
      tracer.setError({ message: '관련 문서 없음 (sources=0)' });
      await tracer.save();
      if (stream) {
        sseWrite(res, { type: 'token', token: '관련된 문서를 찾을 수 없습니다. 먼저 관련 법령이나 문서를 임포트해주세요.' });
        sseWrite(res, { type: 'done' });
        return res.end();
      }
      return res.json({
        question: question.trim(),
        answer: '관련된 문서를 찾을 수 없습니다. 먼저 관련 법령이나 문서를 임포트해주세요.',
        sources: [],
        provider,
      });
    }

    // 2) 카테고리 감지 + 프롬프트 템플릿 로드
    const category = detectCategory(sources);

    const contextText = sources.map((s, i) => {
      const header = s.label || `${s.documentTitle} - ${s.category}`;
      return `[근거 ${i + 1}] ${header} (${s.documentTitle})\n${s.text}`;
    }).join('\n\n---\n\n');

    // 3) 지식 그래프 트리플 조회 — 질문의 엔티티와 관련된 관계 정보를 프롬프트에 추가
    let triplesText = '';
    let triplesData = null;
    try {
      const kgStart = Date.now();
      const docIdsForTriples = sources.map(s => s.documentId).filter(Boolean);
      const triplesResult = await findTriplesForRAG(query, question.trim(), {
        docIds: [...new Set(docIdsForTriples)],
        maxTriples: 15,
        minConfidence: 0.6,
      });
      console.log(`[RAG] 지식 그래프 조회 ${Date.now() - kgStart}ms (엔티티: ${triplesResult.entities.length}, 트리플: ${triplesResult.triples.length})`);
      if (triplesResult.triples.length > 0) {
        triplesText = '\n\n' + triplesResult.contextText;
        triplesData = {
          count: triplesResult.triples.length,
          entities: triplesResult.entities,
          triples: triplesResult.triples.map(t => ({
            subject: t.subject_name,
            predicate: t.predicate,
            object: t.object_name,
            confidence: t.confidence,
          })),
        };
        console.log(`[RAG] 지식 그래프: ${triplesResult.entities.length}개 엔티티 → ${triplesResult.triples.length}개 트리플 주입`);
      }
    } catch (kgErr) {
      console.warn('[RAG] 지식 그래프 조회 실패 (무시):', kgErr.message);
    }

    // 대화 히스토리 (최근 10턴 = 20메시지)
    const recentHistory = Array.isArray(history) ? history.slice(-20) : [];
    const historyText = recentHistory.length > 0
      ? '\n\n--- 이전 대화 ---\n' + recentHistory.map(h =>
          h.role === 'user' ? `사용자: ${h.content}` : `AI: ${h.content}`
        ).join('\n\n')
      : '';

    // DB에서 카테고리별 프롬프트 템플릿 로드 + 변수 치환
    //   contextText에 트리플 텍스트를 병합하여 LLM이 관계 정보도 참고하게 함
    const promptResult = await buildPrompt('rag-answer', category, {
      question: question.trim(),
      contextText: contextText + triplesText,
      historyText,
      sourceCount: String(sources.length),
    });

    const prompt = promptResult.prompt;
    tracer.setPromptInfo(promptResult, prompt);
    console.log(`[RAG] 프롬프트 템플릿: rag-answer/${promptResult.matchedCategory} (DB: ${promptResult.fromDb})`);

    // 3) LLM 호출 옵션 (템플릿 모델 파라미터 + 사용자 오버라이드)
    const templateParams = promptResult.modelParams || {};
    const callOpts = {
      provider,
      temperature: llmOptions.temperature ?? templateParams.temperature ?? 0.3,
      maxTokens: llmOptions.maxTokens ?? templateParams.maxTokens ?? 3072,
      _endpoint: 'rag',
      _langfuseParent: trace,
    };
    if (llmOptions.model) callOpts.model = llmOptions.model;
    if (llmOptions.thinkingBudget) callOpts.thinkingBudget = llmOptions.thinkingBudget;
    if (llmOptions.thinkingLevel) callOpts.thinkingLevel = llmOptions.thinkingLevel;
    if (llmOptions.reasoningEffort) callOpts.reasoningEffort = llmOptions.reasoningEffort;

    // 소스 정보 (스트리밍/비스트리밍 공통)
    const sourcesData = sources.map(s => ({
      documentTitle: s.documentTitle,
      documentId: s.documentId,
      label: s.label,
      chapter: s.chapter,
      articleNumber: s.articleNumber,
      articleTitle: s.articleTitle,
      similarity: s.similarity,
      excerpt: s.text.substring(0, 300) + (s.text.length > 300 ? '...' : ''),
    }));

    if (stream) {
      // ── SSE 스트리밍 모드 (헤더는 이미 위에서 설정됨) ──
      try {
        sseWrite(res, {
          type: 'sources',
          sources: sourcesData,
          hops: searchResult.hops,
          crossRefs: searchResult.crossRefs || [],
          knowledgeGraph: triplesData,
          enhancement: searchResult.enhancement || {},
          provider,
          promptTemplate: { category: promptResult.matchedCategory, fromDb: promptResult.fromDb },
        });
      } catch (srcErr) {
        console.error('[RAG] sources 이벤트 전송 실패:', srcErr.message);
      }

      let accumulated = '';
      try {
        tracer.startLLM();
        const llmStartTime = Date.now();
        const promptLen = prompt ? prompt.length : 0;
        console.log(`[RAG] LLM 스트리밍 시작 (${provider}, 프롬프트 ${promptLen}자)`);

        try { sseWrite(res, { type: 'debug', message: `LLM 호출 시작 (${provider}, ${promptLen}자)` }); } catch {}

        await callLLMStream(prompt, callOpts, (token) => {
          accumulated += token;
          try { sseWrite(res, { type: 'token', token }); } catch {}
        });
        console.log(`[RAG] LLM 스트리밍 완료: ${accumulated.length}자, ${Date.now() - llmStartTime}ms`);
        tracer.setStreamOutput(accumulated);
        const parsed = parseRAGOutput(accumulated, sources);
        tracer.setParsedOutput(parsed);
        try { sseWrite(res, { type: 'parsed', parsed }); } catch {}

        // 4) 선택적 답변 검증 (프롬프트 체인)
        if (useVerify && accumulated.length > 0) {
          try {
            const verifyResult = await buildPrompt('rag-verify', category, {
              question: question.trim(),
              answer: accumulated,
              contextText,
            });
            const verifyOpts = {
              ...callOpts,
              temperature: 0.1,
              maxTokens: 1024,
              _endpoint: 'rag-verify',
            };
            const verifyOutput = await callLLM(verifyResult.prompt, verifyOpts);
            try {
              const verification = JSON.parse(verifyOutput.replace(/```json\n?|```/g, '').trim());
              tracer.setVerification(verification);
              sseWrite(res, { type: 'verification', verification });
            } catch {
              tracer.setVerification({ raw: verifyOutput });
              sseWrite(res, { type: 'verification', verification: { raw: verifyOutput } });
            }
          } catch (verifyErr) {
            console.warn('[RAG] 검증 단계 실패:', verifyErr.message);
          }
        }

        try { await tracer.save(); } catch {}
        try { sseWrite(res, { type: 'done' }); } catch {}
        await finalizeTrace(trace, { output: parsed.conclusion || accumulated.substring(0, 300) });
      } catch (streamErr) {
        console.error(`[RAG] 스트리밍 실패:`, streamErr.message);
        try { sseWrite(res, { type: 'debug', message: `스트리밍 실패: ${streamErr.message}` }); } catch {}

        // 비스트리밍 fallback
        try {
          console.log('[RAG] 비스트리밍 fallback 시도...');
          const answer = await callLLM(prompt, callOpts);
          if (!answer || answer.trim().length === 0) {
            throw new Error('LLM이 빈 응답을 반환했습니다');
          }
          accumulated = answer;
          const parsed = parseRAGOutput(answer, sources);
          try { sseWrite(res, { type: 'token', token: answer }); } catch {}
          try { sseWrite(res, { type: 'parsed', parsed }); } catch {}
          try { sseWrite(res, { type: 'done' }); } catch {}
        } catch (fallbackErr) {
          console.error(`[RAG] fallback도 실패:`, fallbackErr.message);
          try {
            sseWrite(res, { type: 'error', error: `스트리밍: ${streamErr.message} / Fallback: ${fallbackErr.message}` });
          } catch {}
        }
      }
      res.end();
    } else {
      // ── 기존 JSON 응답 모드 ──
      tracer.startLLM();
      const answer = await callLLM(prompt, callOpts);
      tracer.setLLMOutput(answer, null, null); // 토큰 수는 callLLM 내부에서 추정
      const parsed = parseRAGOutput(answer, sources);
      tracer.setParsedOutput(parsed);
      console.log(`[RAG] 답변 생성 완료 (${provider}, ${answer.length}자, ${searchResult.hops}홉, 파싱: ${parsed.format}${parsed.warnings.length > 0 ? ', 경고: ' + parsed.warnings.length : ''}, 프롬프트: ${promptResult.matchedCategory})`);

      // 4) 선택적 답변 검증 (프롬프트 체인)
      let verification = null;
      if (useVerify) {
        try {
          const verifyResult = await buildPrompt('rag-verify', category, {
            question: question.trim(),
            answer,
            contextText,
          });
          const verifyOpts = {
            ...callOpts,
            temperature: 0.1,
            maxTokens: 1024,
            _endpoint: 'rag-verify',
          };
          const verifyOutput = await callLLM(verifyResult.prompt, verifyOpts);
          try {
            verification = JSON.parse(verifyOutput.replace(/```json\n?|```/g, '').trim());
          } catch {
            verification = { raw: verifyOutput };
          }
          tracer.setVerification(verification);
        } catch (verifyErr) {
          console.warn('[RAG] 검증 단계 실패:', verifyErr.message);
        }
      }

      // 트레이서 저장
      await tracer.save();

      // LangFuse 트레이스 종료
      await finalizeTrace(trace, {
        output: parsed.conclusion || answer.substring(0, 300),
        metadata: { hops: searchResult.hops, sourcesCount: sources.length, format: parsed.format, category },
      });

      res.json({
        question: question.trim(),
        answer: parsed.raw,
        parsed,
        provider,
        hops: searchResult.hops,
        crossRefs: searchResult.crossRefs || [],
        knowledgeGraph: triplesData,
        enhancement: searchResult.enhancement || {},
        sources: sourcesData,
        verification,
        promptTemplate: { category: promptResult.matchedCategory, fromDb: promptResult.fromDb },
      });
    }
  } catch (err) {
    tracer.setError(err);
    await tracer.save();
    await finalizeTrace(trace, { output: `ERROR: ${err.message}` });
    sendError(res, err, '[RAG]');
  }
};
