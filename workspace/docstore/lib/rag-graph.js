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
const { findTriplesForRAG, bfsTraversal } = require('./knowledge-graph');
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

// ── 사용 가능한 도구 정의 (Tool Use / 에이전틱 RAG) ──
// LLM이 질문을 분석하여 적절한 도구를 선택한다.
const AVAILABLE_TOOLS = [
  {
    name: 'document_search',
    description: '문서/법령 내용 검색. 특정 조문, 정의, 절차, 규정 등을 찾을 때 사용.',
    examples: ['개인정보보호법 제15조 내용은?', '영상정보처리기기 설치 기준', '과태료 부과 기준'],
  },
  {
    name: 'knowledge_graph',
    description: '엔티티 간 관계 탐색. 법령/조문/기관/개념 사이의 연결을 파악할 때 사용.',
    examples: ['개인정보보호위원회와 관련된 법 조항은?', '제3조와 제15조의 관계', '정보주체의 권리 구조'],
  },
  {
    name: 'summarize',
    description: '문서나 법령 전체 요약. 전체적인 내용 파악이 필요할 때 사용.',
    examples: ['이 법의 주요 내용을 요약해줘', '제3장 전체 요약', '문서 개요 알려줘'],
  },
  {
    name: 'direct_answer',
    description: '검색 불필요한 일반 질문. 인사, 계산, 상식, 시스템 사용법 등.',
    examples: ['안녕하세요', '1+1은?', '오늘 날씨', '이 시스템 사용법'],
  },
];

/**
 * 도구 라우터 노드 (Tool Router)
 *
 * LLM이 질문을 분석하여 어떤 도구를 사용할지 결정한다.
 * 여러 도구를 동시에 선택할 수도 있다 (멀티 도구).
 *
 * 비유: 도서관 사서가 질문을 듣고
 *   "이건 서가에서 찾아야 해" / "이건 백과사전 참조" / "이건 바로 답 드릴게" 판단
 */
async function toolRouterNode(state) {
  // 에이전틱 RAG 비활성화 시 기본 document_search
  if (!state.useToolRouter) {
    state.selectedTools = ['document_search'];
    return state;
  }

  const routerPrompt = `당신은 질문 분석 전문가입니다. 사용자 질문을 분석하여 적절한 도구를 선택하세요.

## 사용 가능한 도구
${AVAILABLE_TOOLS.map(t => `- **${t.name}**: ${t.description}\n  예시: ${t.examples.join(', ')}`).join('\n')}

## 규칙
1. 도구는 1~3개 선택 가능 (필요한 것만)
2. 복잡한 질문은 여러 도구 조합 (예: document_search + knowledge_graph)
3. 일반 대화/인사에는 direct_answer만 선택
4. 반드시 JSON 배열로만 응답

## 질문
"${state.question}"

## 응답 형식 (JSON만, 설명 없이)
["도구1", "도구2"]`;

  try {
    const result = await callLLM(routerPrompt, {
      provider: state.provider,
      temperature: 0.1,
      maxTokens: 128,
      _endpoint: 'tool-router',
    });

    // JSON 파싱
    const cleaned = result.replace(/```json\n?|```/g, '').trim();
    const tools = JSON.parse(cleaned);

    if (Array.isArray(tools) && tools.length > 0) {
      state.selectedTools = tools.filter(t => AVAILABLE_TOOLS.some(at => at.name === t));
      if (state.selectedTools.length === 0) state.selectedTools = ['document_search'];
    } else {
      state.selectedTools = ['document_search'];
    }
  } catch (err) {
    console.warn('[RAG-Graph] Tool Router 실패, 기본 검색 사용:', err.message);
    state.selectedTools = ['document_search'];
  }

  console.log(`[RAG-Graph] 선택된 도구: ${state.selectedTools.join(', ')}`);
  emitEvent(state, 'tools', { selectedTools: state.selectedTools });

  return state;
}

/**
 * 도구 실행 노드 (Tool Executor)
 *
 * toolRouterNode에서 선택된 도구들을 병렬로 실행한다.
 * 각 도구의 결과를 state에 추가 컨텍스트로 병합한다.
 */
async function toolExecutorNode(state) {
  const tools = state.selectedTools || ['document_search'];
  const toolResults = [];

  // direct_answer만 선택된 경우 → 검색 스킵
  if (tools.length === 1 && tools[0] === 'direct_answer') {
    state.sources = [];
    state.toolResults = [{ tool: 'direct_answer', result: '검색 없이 직접 답변' }];
    state.skipSearch = true;
    return state;
  }

  // 각 도구 병렬 실행
  const promises = tools.map(async (tool) => {
    try {
      switch (tool) {
        case 'document_search':
          // 기존 multiHopSearch 실행 (searchNode 로직)
          return { tool, type: 'search', status: 'delegated' };

        case 'knowledge_graph': {
          // 질문에서 엔티티 추출 → BFS 탐색
          const { extractEntities } = require('./knowledge-graph');
          const entities = extractEntities(state.question);
          if (entities.length === 0) return { tool, type: 'kg', result: null };

          // 첫 번째 엔티티로 DB에서 ID 조회
          const { query: dbQuery } = require('./db');
          const entRow = await dbQuery(
            `SELECT id FROM entities WHERE name = $1 AND document_id = ANY($2) LIMIT 1`,
            [entities[0].name, state.docIds.length > 0 ? state.docIds : [0]]
          );
          if (entRow.rows.length === 0) {
            // 이름 부분 매칭 시도
            const partialRow = await dbQuery(
              `SELECT id FROM entities WHERE name ILIKE $1 LIMIT 1`,
              [`%${entities[0].name}%`]
            );
            if (partialRow.rows.length === 0) return { tool, type: 'kg', result: null };
            const bfsResult = await bfsTraversal(dbQuery, partialRow.rows[0].id, { maxHops: 2, maxNodes: 20 });
            return { tool, type: 'kg', result: bfsResult };
          }
          const bfsResult = await bfsTraversal(dbQuery, entRow.rows[0].id, { maxHops: 2, maxNodes: 20 });
          return { tool, type: 'kg', result: bfsResult };
        }

        case 'summarize':
          // 요약 도구: 검색 후 요약 지시를 프롬프트에 추가
          return { tool, type: 'summarize', instruction: '검색된 문서 내용을 체계적으로 요약하여 답변하세요.' };

        default:
          return { tool, type: 'unknown', result: null };
      }
    } catch (err) {
      console.warn(`[RAG-Graph] 도구 실행 실패 (${tool}):`, err.message);
      return { tool, type: 'error', error: err.message };
    }
  });

  const results = await Promise.all(promises);

  // 결과 병합
  state.toolResults = results;
  state.extraContext = '';

  for (const r of results) {
    if (r.type === 'kg' && r.result && r.result.edges?.length > 0) {
      // 지식그래프 탐색 결과를 추가 컨텍스트로 변환
      const kgLines = r.result.edges.map(e =>
        `• ${e.sourceName} →[${e.predicate}]→ ${e.targetName} (신뢰도: ${e.confidence})`
      );
      state.extraContext += `\n\n--- 지식그래프 탐색 결과 (${r.result.algorithm?.toUpperCase()}, ${r.result.stats?.totalNodes}노드) ---\n${kgLines.join('\n')}`;
    }
    if (r.type === 'summarize') {
      state.extraContext += `\n\n[요약 지시] ${r.instruction}`;
    }
  }

  return state;
}

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
    useParentRetriever: state.useParentRetriever,
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

  // direct_answer 모드: 검색 없이 직접 답변
  if (state.skipSearch) {
    state.category = 'default';
    state.contextText = state.extraContext || '';
    // 직접 답변 프롬프트
    state.prompt = `사용자 질문에 직접 답변하세요. 검색이 필요하지 않은 일반적인 질문입니다.\n\n질문: ${question}`;
    state.promptResult = { matchedCategory: 'direct', fromDb: false };
    state.callOpts = {
      provider,
      temperature: 0.7,
      maxTokens: 1024,
      _endpoint: 'rag-direct',
    };
    if (llmOptions?.model) state.callOpts.model = llmOptions.model;
    state.sourcesData = [];
    emitEvent(state, 'sources', { sources: [], direct: true, selectedTools: state.selectedTools });
    return state;
  }

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

  // 도구 실행 추가 컨텍스트 (Tool Use 결과)
  const toolExtraContext = state.extraContext || '';

  state.contextText = contextText + triplesText + communityText + toolExtraContext;

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
 * 검증 노드 — 답변 품질 평가 + Corrective RAG 판단
 *
 * 기존 검증에 더해, 답변의 품질을 점수화하고
 * 불충분할 경우 "재검색이 필요한가?"를 판단한다.
 *
 * Corrective RAG 흐름:
 *   verify → 점수 낮음? → correctiveRewrite (쿼리 수정) → search (재검색) → augment → generate → parse → verify
 *   verify → 점수 높음? → finalize
 *
 * 최대 재시도: 2회 (무한 루프 방지)
 */
async function verifyNode(state) {
  // 재시도 카운터 초기화
  if (state.correctiveRetries === undefined) state.correctiveRetries = 0;

  try {
    // Corrective RAG 평가 프롬프트 (기존 verify + 품질 점수)
    const verifyPrompt = `당신은 RAG 답변 품질 평가 전문가입니다.

## 질문
${state.question}

## 답변
${state.rawAnswer}

## 제공된 근거 텍스트
${(state.contextText || '').substring(0, 2000)}

## 평가 기준
1. **completeness** (0~10): 질문에 대해 충분히 답변했는가?
2. **accuracy** (0~10): 근거 텍스트에 기반한 정확한 답변인가?
3. **relevance** (0~10): 질문과 관련 있는 내용만 답변했는가?
4. **needs_retry**: 답변이 불충분하여 다른 검색어로 재검색이 필요한가? (true/false)
5. **retry_query**: needs_retry가 true일 때, 더 나은 검색을 위한 수정된 검색어

## 응답 형식 (JSON만)
{"completeness":N,"accuracy":N,"relevance":N,"overall":N,"needs_retry":bool,"retry_query":"...","reason":"판단 이유"}`;

    const verifyOpts = {
      ...state.callOpts,
      temperature: 0.1,
      maxTokens: 512,
      _endpoint: 'rag-verify-corrective',
    };
    const verifyOutput = await callLLM(verifyPrompt, verifyOpts);

    try {
      const parsed = JSON.parse(verifyOutput.replace(/```json\n?|```/g, '').trim());
      state.verification = parsed;

      // overall 점수 계산 (평균)
      if (!parsed.overall && parsed.completeness !== undefined) {
        parsed.overall = Math.round((parsed.completeness + parsed.accuracy + parsed.relevance) / 3 * 10) / 10;
      }

      console.log(`[RAG-Graph] 검증 점수: ${parsed.overall}/10 (완전성: ${parsed.completeness}, 정확성: ${parsed.accuracy}, 관련성: ${parsed.relevance})`);

      // Corrective RAG: 재검색 필요 판단
      if (parsed.needs_retry && parsed.retry_query && state.correctiveRetries < 2) {
        state.correctiveNeedsRetry = true;
        state.correctiveRetryQuery = parsed.retry_query;
        console.log(`[RAG-Graph] Corrective RAG: 재검색 필요 → "${parsed.retry_query}" (시도 ${state.correctiveRetries + 1}/2)`);
        emitEvent(state, 'corrective', {
          action: 'retry',
          retryQuery: parsed.retry_query,
          reason: parsed.reason,
          attempt: state.correctiveRetries + 1,
          score: parsed.overall,
        });
      } else {
        state.correctiveNeedsRetry = false;
        if (parsed.needs_retry && state.correctiveRetries >= 2) {
          console.log(`[RAG-Graph] Corrective RAG: 재시도 한도 도달 (2/2), 현재 답변 사용`);
          emitEvent(state, 'corrective', { action: 'max_retries', score: parsed.overall });
        }
      }
    } catch {
      state.verification = { raw: verifyOutput };
      state.correctiveNeedsRetry = false;
    }

    state.tracer.setVerification(state.verification);
    emitEvent(state, 'verification', { verification: state.verification });
  } catch (verifyErr) {
    console.warn('[RAG-Graph] 검증 실패 (무시):', verifyErr.message);
    state.verification = null;
    state.correctiveNeedsRetry = false;
  }
  return state;
}

/**
 * Corrective RAG 리라이팅 노드
 *
 * verify에서 답변이 불충분하다고 판단되면,
 * 수정된 쿼리로 재검색을 준비한다.
 */
async function correctiveRewriteNode(state) {
  state.correctiveRetries++;
  const retryQuery = state.correctiveRetryQuery || state.question;

  console.log(`[RAG-Graph] Corrective 재검색: "${retryQuery}" (시도 ${state.correctiveRetries})`);
  emitEvent(state, 'stage', { node: 'corrective-rewrite', status: 'start', query: retryQuery });

  // 원래 질문을 수정된 쿼리로 교체
  state.originalQuestion = state.originalQuestion || state.question;
  state.question = retryQuery;

  // 이전 검색 결과 초기화 (재검색을 위해)
  state.sources = [];
  state.searchResult = null;
  state.rawAnswer = '';
  state.parsed = null;

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
  graph.addNode('toolRouter', toolRouterNode);
  graph.addNode('toolExecutor', toolExecutorNode);
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
  graph.addNode('correctiveRewrite', correctiveRewriteNode);
  graph.addNode('finalize', finalizeNode);

  // ══ 엣지 정의 ══
  //
  // 새 파이프라인 흐름:
  //   toolRouter → toolExecutor → search → augment → generate → parse
  //   → verify → (불충분? → correctiveRewrite → search) or finalize
  //
  // direct_answer 경로:
  //   toolRouter → toolExecutor → (skipSearch? → augment-direct) → generate → ...

  graph.setEntryPoint('toolRouter');
  graph.addEdge('toolRouter', 'toolExecutor');

  // toolExecutor → skipSearch이면 직접 생성, 아니면 검색
  graph.addConditionalEdge('toolExecutor', (state) => {
    return state.skipSearch ? 'augment' : 'search';
  });

  // search → sources가 있으면 augment, 없으면 finalize
  graph.addConditionalEdge('search', (state) => {
    return state.sources.length > 0 ? 'augment' : 'finalize';
  });

  graph.addEdge('augment', 'generate');
  graph.addEdge('generate', 'parse');

  // parse → useVerify이면 verify, 아니면 finalize
  // (Corrective RAG는 verify 활성화 시에만 동작)
  graph.addConditionalEdge('parse', (state) => {
    return (state.useVerify && state.rawAnswer.length > 0) ? 'verify' : 'finalize';
  });

  // verify → Corrective RAG 분기
  //   - 재검색 필요 → correctiveRewrite → search (루프)
  //   - 충분 → finalize
  graph.addConditionalEdge('verify', (state) => {
    if (state.correctiveNeedsRetry) return 'correctiveRewrite';
    return 'finalize';
  });

  // correctiveRewrite → search (재검색 루프)
  graph.addEdge('correctiveRewrite', 'search');

  // finalize → END (엣지 없으면 자동 종료)

  return graph.compile();
}

module.exports = { StateGraph, createRAGGraph, END };
