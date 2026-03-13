// RAG 상태 그래프 엔진
//
// LangGraph 스타일의 경량 상태 머신으로 RAG 파이프라인을 실행한다.
// 외부 라이브러리 의존 없이 순수 JS로 구현.
//
// 구조:
//   StateGraph — 범용 상태 그래프 (노드/엣지 정의 → compile → invoke)
//   노드 함수 — search, augment, generate, parse, verify, finalize
//   createRAGGraph() — 팩토리: 조립된 그래프 반환
//
// 상태 흐름:
//   search → (sources=0 → finalize) → augment → generate → parse
//   → (useVerify? verify : finalize) → finalize
//
// 재시도: generate 노드에서 스트리밍 실패 시 비스트리밍 fallback (1회)

const { multiHopSearch } = require('./rag-agent');
const { callLLM, callLLMStream } = require('./gemini');
const { parseRAGOutput } = require('./output-parser');
const { findTriplesForRAG } = require('./knowledge-graph');
const { buildPrompt } = require('./prompt-manager');
const { createSpan, endSpan } = require('./langfuse');
const { globalSearch } = require('./community-summary');
const { findRelevantFewShots } = require('./few-shot-manager');

// ── 특수 종료 심볼 ──
const END = Symbol('END');

// ══════════════════════════════════════
// StateGraph — 범용 상태 그래프 엔진
// ══════════════════════════════════════
class StateGraph {
  constructor() {
    this.nodes = new Map();      // name → { fn, retry }
    this.edges = new Map();      // name → string | Function(state) → string|END
    this.entryPoint = null;
  }

  /** 노드 등록 */
  addNode(name, fn, retry = { max: 0 }) {
    this.nodes.set(name, { fn, retry });
    return this;
  }

  /** 무조건 엣지: from 완료 후 항상 to로 이동 */
  addEdge(from, to) {
    this.edges.set(from, to);
    return this;
  }

  /** 조건부 엣지: routerFn(state) 반환값이 다음 노드 이름 (또는 END) */
  addConditionalEdge(from, routerFn) {
    this.edges.set(from, routerFn);
    return this;
  }

  /** 시작 노드 지정 */
  setEntryPoint(name) {
    this.entryPoint = name;
    return this;
  }

  /** 그래프 컴파일 → 실행 가능한 객체 반환 */
  compile() {
    const { nodes, edges, entryPoint } = this;
    if (!entryPoint) throw new Error('entryPoint가 설정되지 않았습니다');

    return {
      /**
       * 상태 그래프 실행
       * @param {Object} state - 초기 상태
       * @returns {Object} 최종 상태
       */
      invoke: async (state) => {
        let current = entryPoint;
        state.status = 'running';
        state.retries = state.retries || {};

        while (current !== END) {
          const node = nodes.get(current);
          if (!node) throw new Error(`알 수 없는 노드: ${current}`);

          state.currentNode = current;
          const maxRetry = node.retry?.max || 0;

          // 노드 시작 이벤트
          emitEvent(state, 'stage', { node: current, status: 'start' });

          try {
            state = await node.fn(state);
          } catch (err) {
            const retryCount = state.retries[current] || 0;

            if (retryCount < maxRetry) {
              // 재시도 전 변환 (예: 스트리밍 → 비스트리밍 fallback)
              state.retries[current] = retryCount + 1;
              if (node.retry?.onRetry) node.retry.onRetry(state, err);
              emitEvent(state, 'stage', { node: current, status: 'retry', attempt: retryCount + 1, error: err.message });
              continue; // 같은 노드 재실행
            }

            // 재시도 소진 → 에러 상태로 finalize 이동
            state.error = err;
            state.status = 'failed';
            emitEvent(state, 'stage', { node: current, status: 'error', error: err.message });

            // finalize 노드가 있으면 이동, 없으면 종료
            if (nodes.has('finalize') && current !== 'finalize') {
              current = 'finalize';
              continue;
            }
            break;
          }

          // 노드 완료 이벤트
          emitEvent(state, 'stage', { node: current, status: 'done' });

          // 다음 노드 결정
          const edge = edges.get(current);
          if (!edge) break; // 엣지 없으면 종료

          if (typeof edge === 'function') {
            current = edge(state);
          } else {
            current = edge;
          }

          if (current === END) break;
        }

        if (state.status === 'running') state.status = 'completed';
        return state;
      },
    };
  }
}

/** state.onEvent 콜백이 있으면 이벤트 전송 */
function emitEvent(state, type, data) {
  if (state.onEvent) {
    try { state.onEvent(type, data); } catch {}
  }
}

// ══════════════════════════════════════
// 노드 함수들
// ══════════════════════════════════════

/**
 * 검색 노드 — 멀티홉 검색 (쿼리 리라이팅 + HyDE)
 */
async function searchNode(state) {
  const searchSpan = createSpan(state.trace, {
    name: 'multi-hop-search',
    input: state.question,
    metadata: { topK: state.topK, docIds: state.docIds, useQueryRewrite: state.useQueryRewrite, useHyDE: state.useHyDE },
  });

  state.tracer.startSearch();

  // onProgress → SSE 이벤트 변환
  const onProgress = (progress) => emitEvent(state, 'enhancement', progress);

  console.log(`[RAG-Graph] 검색 시작: "${state.question.substring(0, 50)}..." (${state.provider})`);

  const searchResult = await multiHopSearch(state.dbQuery, state.question, {
    topK: Math.min(parseInt(state.topK, 10) || 5, 10),
    docIds: state.docIds,
    orgId: state.orgId,
    useQueryRewrite: state.useQueryRewrite,
    useHyDE: state.useHyDE,
    useMorpheme: state.useMorpheme,
    provider: state.provider,
    history: state.history,
    onProgress,
  });

  state.sources = searchResult.sources;
  state.searchResult = searchResult;
  state.enhancement = searchResult.enhancement || {};

  // 트레이서에 결과 기록
  state.tracer.setQueryRewrite(state.enhancement.queryRewrite || null);
  state.tracer.setHyDE(state.enhancement.hyde || null);
  state.tracer.setSearchResults(state.sources, searchResult);

  console.log(`[RAG-Graph] 검색 완료: ${state.sources.length}개 근거 (${searchResult.hops}홉)`);

  endSpan(searchSpan, {
    output: { sourcesCount: state.sources.length, hops: searchResult.hops },
  });

  return state;
}

/**
 * 증강 노드 — 지식그래프 + 프롬프트 빌드 + LLM 옵션 조립
 */
async function augmentNode(state) {
  const { sources, question, provider, history, llmOptions, trace } = state;

  // 1) 카테고리 감지
  state.category = detectCategory(sources);

  // 2) 컨텍스트 텍스트 생성
  const contextText = sources.map((s, i) => {
    const header = s.label || `${s.documentTitle} - ${s.category}`;
    return `[근거 ${i + 1}] ${header} (${s.documentTitle})\n${s.text}`;
  }).join('\n\n---\n\n');

  // 3) 지식 그래프 트리플 조회
  let triplesText = '';
  state.triplesData = null;
  try {
    const kgStart = Date.now();
    const docIdsForTriples = sources.map(s => s.documentId).filter(Boolean);
    const triplesResult = await findTriplesForRAG(state.dbQuery, question, {
      docIds: [...new Set(docIdsForTriples)],
      maxTriples: 15,
      minConfidence: 0.6,
    });
    console.log(`[RAG-Graph] 지식그래프 ${Date.now() - kgStart}ms (엔티티: ${triplesResult.entities.length}, 트리플: ${triplesResult.triples.length})`);
    if (triplesResult.triples.length > 0) {
      triplesText = '\n\n' + triplesResult.contextText;
      state.triplesData = {
        count: triplesResult.triples.length,
        entities: triplesResult.entities,
        triples: triplesResult.triples.map(t => ({
          subject: t.subject_name,
          predicate: t.predicate,
          object: t.object_name,
          confidence: t.confidence,
        })),
      };
    }
  } catch (kgErr) {
    console.warn('[RAG-Graph] 지식그래프 조회 실패 (무시):', kgErr.message);
  }

  // 3.5) 커뮤니티 요약 기반 글로벌 컨텍스트
  let communityText = '';
  try {
    const docIdsForComm = sources.map(s => s.documentId).filter(Boolean);
    const commResult = await globalSearch(state.dbQuery, question, {
      docIds: [...new Set(docIdsForComm)],
      maxCommunities: 3,
    });
    if (commResult.contextText) {
      communityText = '\n\n' + commResult.contextText;
      console.log(`[RAG-Graph] 커뮤니티 컨텍스트: ${commResult.communities.length}개 매칭`);
    }
  } catch (commErr) {
    console.warn('[RAG-Graph] 커뮤니티 검색 실패 (무시):', commErr.message);
  }

  state.contextText = contextText + triplesText + communityText;

  // 4) 대화 히스토리
  const recentHistory = Array.isArray(history) ? history.slice(-20) : [];
  const historyText = recentHistory.length > 0
    ? '\n\n--- 이전 대화 ---\n' + recentHistory.map(h =>
        h.role === 'user' ? `사용자: ${h.content}` : `AI: ${h.content}`
      ).join('\n\n')
    : '';

  // 5) Few-shot 예시 결정 (사용자 선택 > 자동 매칭)
  let dynamicFewShots = [];

  if (state.userFewShots && state.userFewShots.length > 0) {
    // 사용자가 UI에서 직접 선택한 few-shot 사용
    dynamicFewShots = state.userFewShots.map(fs => ({
      input: fs.question || fs.input,
      output: fs.conclusion || fs.output,
    })).filter(fs => fs.input && fs.output);
    console.log(`[RAG-Graph] Few-shot 사용자 선택: ${dynamicFewShots.length}개`);
    state.fewShotMeta = { source: 'user-selected', count: dynamicFewShots.length };
  } else {
    // 자동 매칭
    try {
      const fewShotResult = await findRelevantFewShots(state.dbQuery, question, {
        category: state.category !== 'default' ? state.category : undefined,
        maxExamples: 2,
      });
      if (fewShotResult.examples.length > 0) {
        dynamicFewShots = fewShotResult.examples;
        console.log(`[RAG-Graph] Few-shot 자동 매칭: ${fewShotResult.examples.length}개 (후보: ${fewShotResult.meta.candidates})`);
        state.fewShotMeta = fewShotResult.meta;
      }
    } catch (fsErr) {
      console.warn('[RAG-Graph] Few-shot 매칭 실패 (무시):', fsErr.message);
    }
  }

  // 6) 프롬프트 빌드 (few-shot 주입)
  const promptResult = await buildPrompt('rag-answer', state.category, {
    question,
    contextText: state.contextText,
    historyText,
    sourceCount: String(sources.length),
  });

  // few-shot이 있으면 템플릿 예시에 병합하여 프롬프트 재렌더링
  if (dynamicFewShots.length > 0) {
    const { renderTemplate } = require('./prompt-manager');
    const { loadTemplate } = require('./prompt-manager');
    const tpl = await loadTemplate('rag-answer', state.category);
    const allExamples = [...(tpl?.few_shot_examples || []), ...dynamicFewShots];
    promptResult.prompt = renderTemplate(tpl.template, {
      question,
      contextText: state.contextText,
      historyText,
      sourceCount: String(sources.length),
    }, allExamples);
  }

  state.prompt = promptResult.prompt;
  state.promptResult = promptResult;
  state.tracer.setPromptInfo(promptResult, state.prompt);
  console.log(`[RAG-Graph] 프롬프트: rag-answer/${promptResult.matchedCategory} (DB: ${promptResult.fromDb}, few-shot: ${dynamicFewShots.length})`);

  // 6) LLM 호출 옵션 조립
  const templateParams = promptResult.modelParams || {};
  state.callOpts = {
    provider,
    temperature: llmOptions.temperature ?? templateParams.temperature ?? 0.3,
    maxTokens: llmOptions.maxTokens ?? templateParams.maxTokens ?? 3072,
    _endpoint: 'rag',
    _langfuseParent: trace,
  };
  if (llmOptions.model) state.callOpts.model = llmOptions.model;
  if (llmOptions.thinkingBudget) state.callOpts.thinkingBudget = llmOptions.thinkingBudget;
  if (llmOptions.thinkingLevel) state.callOpts.thinkingLevel = llmOptions.thinkingLevel;
  if (llmOptions.reasoningEffort) state.callOpts.reasoningEffort = llmOptions.reasoningEffort;

  // 7) 클라이언트용 소스 요약
  state.sourcesData = sources.map(s => ({
    documentTitle: s.documentTitle,
    documentId: s.documentId,
    label: s.label,
    chapter: s.chapter,
    articleNumber: s.articleNumber,
    articleTitle: s.articleTitle,
    similarity: s.similarity,
    excerpt: s.text.substring(0, 300) + (s.text.length > 300 ? '...' : ''),
  }));

  // 소스 정보 이벤트 전송
  emitEvent(state, 'sources', {
    sources: state.sourcesData,
    hops: state.searchResult.hops,
    crossRefs: state.searchResult.crossRefs || [],
    knowledgeGraph: state.triplesData,
    enhancement: state.enhancement,
    provider,
    promptTemplate: { category: promptResult.matchedCategory, fromDb: promptResult.fromDb },
  });

  return state;
}

/**
 * 생성 노드 — LLM 호출 (스트리밍/비스트리밍)
 */
async function generateNode(state) {
  state.tracer.startLLM();
  const promptLen = state.prompt ? state.prompt.length : 0;
  console.log(`[RAG-Graph] LLM 시작 (${state.provider}, ${promptLen}자, stream: ${state.stream})`);
  emitEvent(state, 'debug', { message: `LLM 호출 시작 (${state.provider}, ${promptLen}자)` });

  const llmStartTime = Date.now();

  if (state.stream) {
    // 스트리밍 모드
    let accumulated = '';
    await callLLMStream(state.prompt, state.callOpts, (token) => {
      accumulated += token;
      emitEvent(state, 'token', { token });
    });
    state.rawAnswer = accumulated;
    state.tracer.setStreamOutput(accumulated);
  } else {
    // 비스트리밍 모드
    const answer = await callLLM(state.prompt, state.callOpts);
    if (!answer || answer.trim().length === 0) {
      throw new Error('LLM이 빈 응답을 반환했습니다');
    }
    state.rawAnswer = answer;
    state.tracer.setLLMOutput(answer, null, null);
    // 비스트리밍에서도 토큰 이벤트 한번에 전송 (fallback 시)
    emitEvent(state, 'token', { token: answer });
  }

  console.log(`[RAG-Graph] LLM 완료: ${state.rawAnswer.length}자, ${Date.now() - llmStartTime}ms`);
  return state;
}

/**
 * 파싱 노드 — LLM 출력을 구조화
 */
async function parseNode(state) {
  state.parsed = parseRAGOutput(state.rawAnswer, state.sources);
  state.tracer.setParsedOutput(state.parsed);
  emitEvent(state, 'parsed', { parsed: state.parsed });
  return state;
}

/**
 * 검증 노드 — 답변 정확성 검증 (두 번째 LLM 호출)
 */
async function verifyNode(state) {
  try {
    const verifyResult = await buildPrompt('rag-verify', state.category, {
      question: state.question,
      answer: state.rawAnswer,
      contextText: state.contextText,
    });
    const verifyOpts = {
      ...state.callOpts,
      temperature: 0.1,
      maxTokens: 1024,
      _endpoint: 'rag-verify',
    };
    const verifyOutput = await callLLM(verifyResult.prompt, verifyOpts);
    try {
      state.verification = JSON.parse(verifyOutput.replace(/```json\n?|```/g, '').trim());
    } catch {
      state.verification = { raw: verifyOutput };
    }
    state.tracer.setVerification(state.verification);
    emitEvent(state, 'verification', { verification: state.verification });
  } catch (verifyErr) {
    console.warn('[RAG-Graph] 검증 실패 (무시):', verifyErr.message);
    state.verification = null;
  }
  return state;
}

/**
 * 종료 노드 — 트레이서 저장 + LangFuse 종료
 */
async function finalizeNode(state) {
  try { await state.tracer.save(); } catch {}
  emitEvent(state, 'done', {});
  return state;
}

// ── 헬퍼 함수 ──

/** 검색 결과의 대표 카테고리 결정 */
function detectCategory(sources) {
  if (!sources || sources.length === 0) return 'default';
  const counts = {};
  for (const s of sources) {
    const cat = s.category || 'default';
    counts[cat] = (counts[cat] || 0) + 1;
  }
  let maxCat = 'default', maxCount = 0;
  for (const [cat, count] of Object.entries(counts)) {
    if (count > maxCount) { maxCat = cat; maxCount = count; }
  }
  return maxCat;
}

// ══════════════════════════════════════
// 그래프 조립 팩토리
// ══════════════════════════════════════

/**
 * RAG 파이프라인 상태 그래프 생성
 * @returns {{ invoke: (state) => Promise<state> }}
 */
function createRAGGraph() {
  const graph = new StateGraph();

  // 노드 등록
  graph.addNode('search', searchNode);
  graph.addNode('augment', augmentNode);
  graph.addNode('generate', generateNode, {
    max: 1,
    onRetry: (state, err) => {
      // 스트리밍 실패 → 비스트리밍 fallback
      console.log(`[RAG-Graph] generate 재시도: 스트리밍 → 비스트리밍 (${err.message})`);
      state.stream = false;
      state.callOpts._endpoint = 'rag-fallback';
    },
  });
  graph.addNode('parse', parseNode);
  graph.addNode('verify', verifyNode);
  graph.addNode('finalize', finalizeNode);

  // 엣지 정의
  graph.setEntryPoint('search');

  // search → sources가 있으면 augment, 없으면 finalize
  graph.addConditionalEdge('search', (state) => {
    return state.sources.length > 0 ? 'augment' : 'finalize';
  });

  graph.addEdge('augment', 'generate');
  graph.addEdge('generate', 'parse');

  // parse → useVerify이면 verify, 아니면 finalize
  graph.addConditionalEdge('parse', (state) => {
    return (state.useVerify && state.rawAnswer.length > 0) ? 'verify' : 'finalize';
  });

  graph.addEdge('verify', 'finalize');
  // finalize → END (엣지 없으면 자동 종료)

  return graph.compile();
}

module.exports = { StateGraph, createRAGGraph, END };
