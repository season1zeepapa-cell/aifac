// LangFuse 관측성(Observability) 연동 모듈
//
// LangFuse는 LLM 호출을 추적하는 외부 관측성 도구입니다.
// 환경변수가 설정되지 않으면 모든 함수가 no-op(아무것도 안 함)으로 동작하므로
// 기존 코드에 영향을 주지 않습니다.
//
// 필요한 환경변수:
//   LANGFUSE_PUBLIC_KEY  — LangFuse 프로젝트 공개 키
//   LANGFUSE_SECRET_KEY  — LangFuse 프로젝트 비밀 키
//   LANGFUSE_BASE_URL    — LangFuse 서버 주소 (기본: https://cloud.langfuse.com)
//
// 트레이스 구조 (RAG 파이프라인 예시):
//   trace("rag-query")
//     ├─ span("search") — 검색 단계
//     │   ├─ generation("embedding") — 임베딩 생성
//     │   └─ generation("rerank") — Cohere 리랭킹
//     └─ generation("llm-call") — LLM 답변 생성

let langfuseClient = null;
let isEnabled = false;

/**
 * LangFuse 클라이언트 초기화 (싱글톤)
 * 환경변수가 없으면 null 반환 → 이후 모든 함수가 no-op
 */
function getLangfuse() {
  if (langfuseClient) return langfuseClient;

  const publicKey = (process.env.LANGFUSE_PUBLIC_KEY || '').trim();
  const secretKey = (process.env.LANGFUSE_SECRET_KEY || '').trim();

  if (!publicKey || !secretKey) {
    return null;
  }

  try {
    const { Langfuse } = require('langfuse');
    langfuseClient = new Langfuse({
      publicKey,
      secretKey,
      baseUrl: (process.env.LANGFUSE_BASE_URL || '').trim() || 'https://cloud.langfuse.com',
      // Vercel 서버리스에서는 요청마다 프로세스가 끝날 수 있으므로
      // flushAt을 1로 설정하여 즉시 전송
      flushAt: 1,
      flushInterval: 1000,
    });
    isEnabled = true;
    console.log('[LangFuse] 관측성 연동 활성화됨');
    return langfuseClient;
  } catch (err) {
    console.warn('[LangFuse] 초기화 실패:', err.message);
    return null;
  }
}

/**
 * LangFuse 활성화 여부 확인
 */
function isLangfuseEnabled() {
  if (isEnabled) return true;
  return !!getLangfuse();
}

/**
 * 새 트레이스 생성 — RAG 질의, 문서 업로드 등 최상위 작업 단위
 *
 * @param {Object} params - { name, input, metadata, userId, sessionId, tags }
 * @returns {Object|null} trace 객체 또는 null
 *
 * 사용 예:
 *   const trace = createTrace({ name: 'rag-query', input: question });
 */
function createTrace(params = {}) {
  const lf = getLangfuse();
  if (!lf) return null;

  try {
    return lf.trace({
      name: params.name || 'unknown',
      input: params.input,
      metadata: params.metadata,
      userId: params.userId,
      sessionId: params.sessionId,
      tags: params.tags || [],
    });
  } catch (err) {
    console.warn('[LangFuse] 트레이스 생성 실패:', err.message);
    return null;
  }
}

/**
 * 트레이스/스팬 아래에 하위 스팬 생성 — 검색, 전처리 등 단계 구분
 *
 * @param {Object} parent - trace 또는 span 객체
 * @param {Object} params - { name, input, metadata }
 * @returns {Object|null} span 객체 또는 null
 *
 * 사용 예:
 *   const searchSpan = createSpan(trace, { name: 'multi-hop-search' });
 */
function createSpan(parent, params = {}) {
  if (!parent) return null;

  try {
    return parent.span({
      name: params.name || 'span',
      input: params.input,
      metadata: params.metadata,
    });
  } catch (err) {
    console.warn('[LangFuse] 스팬 생성 실패:', err.message);
    return null;
  }
}

/**
 * LLM 호출 기록 (generation) — 프롬프트, 응답, 토큰, 비용 등
 *
 * @param {Object} parent - trace 또는 span 객체
 * @param {Object} params - {
 *   name, model, modelParameters,
 *   input, output,
 *   usage: { promptTokens, completionTokens, totalTokens },
 *   metadata
 * }
 * @returns {Object|null} generation 객체 또는 null
 */
function createGeneration(parent, params = {}) {
  if (!parent) return null;

  try {
    return parent.generation({
      name: params.name || 'llm-call',
      model: params.model,
      modelParameters: params.modelParameters,
      input: params.input,
      output: params.output,
      usage: params.usage,
      metadata: params.metadata,
    });
  } catch (err) {
    console.warn('[LangFuse] 제너레이션 생성 실패:', err.message);
    return null;
  }
}

/**
 * 스팬/제너레이션 종료 — output, status 등 최종 정보 기록
 *
 * @param {Object} spanOrGen - span 또는 generation 객체
 * @param {Object} params - { output, statusMessage, level }
 *   level: 'DEFAULT' | 'DEBUG' | 'WARNING' | 'ERROR'
 */
function endSpan(spanOrGen, params = {}) {
  if (!spanOrGen) return;

  try {
    spanOrGen.end({
      output: params.output,
      statusMessage: params.statusMessage,
      level: params.level,
    });
  } catch (err) {
    console.warn('[LangFuse] 스팬 종료 실패:', err.message);
  }
}

/**
 * 트레이스에 최종 출력 기록 후 즉시 전송
 *
 * @param {Object} trace - trace 객체
 * @param {Object} params - { output, metadata }
 */
async function finalizeTrace(trace, params = {}) {
  if (!trace) return;

  try {
    trace.update({
      output: params.output,
      metadata: params.metadata,
    });

    // Vercel 서버리스에서는 응답 후 프로세스가 종료될 수 있으므로
    // 데이터를 즉시 LangFuse 서버로 전송
    const lf = getLangfuse();
    if (lf) await lf.flushAsync();
  } catch (err) {
    console.warn('[LangFuse] 트레이스 종료 실패:', err.message);
  }
}

/**
 * LLM 호출을 간편하게 추적하는 래퍼
 * callLLM/callLLMStream에서 사용
 *
 * @param {Object} parent - trace 또는 span (null이면 no-op)
 * @param {Object} info - { name, model, provider, input, modelParameters }
 * @returns {{ generation, end: Function }} generation 객체 + 종료 헬퍼
 */
function trackLLMCall(parent, info = {}) {
  if (!parent) {
    return {
      generation: null,
      end: () => {},
    };
  }

  const generation = createGeneration(parent, {
    name: info.name || 'llm-call',
    model: info.model,
    input: info.input,
    modelParameters: {
      provider: info.provider,
      temperature: info.modelParameters?.temperature,
      maxTokens: info.modelParameters?.maxTokens,
    },
  });

  return {
    generation,
    // 호출 완료 후 결과 기록
    end: ({ output, tokensIn = 0, tokensOut = 0, error = null } = {}) => {
      if (!generation) return;
      try {
        generation.end({
          output: error ? `ERROR: ${error}` : output,
          usage: {
            promptTokens: tokensIn,
            completionTokens: tokensOut,
            totalTokens: tokensIn + tokensOut,
          },
          level: error ? 'ERROR' : 'DEFAULT',
          statusMessage: error || undefined,
        });
      } catch (err) {
        // 추적 실패해도 메인 로직에 영향 없음
      }
    },
  };
}

/**
 * 임베딩 호출을 추적하는 헬퍼
 *
 * @param {Object} parent - trace 또는 span
 * @param {Object} info - { model, provider, inputCount }
 * @returns {{ generation, end: Function }}
 */
function trackEmbeddingCall(parent, info = {}) {
  if (!parent) {
    return { generation: null, end: () => {} };
  }

  const generation = createGeneration(parent, {
    name: 'embedding',
    model: info.model,
    input: `${info.inputCount || 1}개 텍스트 임베딩`,
    metadata: { provider: info.provider },
  });

  return {
    generation,
    end: ({ tokensIn = 0, error = null } = {}) => {
      if (!generation) return;
      try {
        generation.end({
          output: error ? `ERROR: ${error}` : '임베딩 생성 완료',
          usage: { promptTokens: tokensIn, totalTokens: tokensIn },
          level: error ? 'ERROR' : 'DEFAULT',
        });
      } catch (err) {
        // no-op
      }
    },
  };
}

module.exports = {
  getLangfuse,
  isLangfuseEnabled,
  createTrace,
  createSpan,
  createGeneration,
  endSpan,
  finalizeTrace,
  trackLLMCall,
  trackEmbeddingCall,
};
