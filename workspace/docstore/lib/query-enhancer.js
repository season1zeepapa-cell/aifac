// 쿼리 강화 모듈 (Query Rewriting + HyDE)
//
// 1. Query Rewriting (쿼리 리라이팅)
//    - 사용자 질문을 검색에 최적화된 형태로 변환
//    - 복합 질문 → 하위 질문으로 분해
//    - 법률 용어 확장 (일상어 → 법률 용어)
//    - DB 프롬프트 템플릿 우선 → 폴백 하드코딩
//
// 2. HyDE (Hypothetical Document Embeddings)
//    - LLM으로 "가상의 답변 문서"를 생성
//    - 질문 임베딩 대신 가상 문서 임베딩으로 벡터 검색
//    - 질문↔문서 의미 격차(lexical gap) 해소

const { callLLM } = require('./gemini');
const { generateEmbedding } = require('./embeddings');
const { buildPrompt } = require('./prompt-manager');

/**
 * 쿼리 리라이팅 — LLM으로 질문을 검색 최적화 쿼리로 변환
 * DB에 'query-rewrite' 템플릿이 있으면 사용, 없으면 폴백
 *
 * @param {string} question - 원본 질문
 * @param {Object} options - { provider, history }
 * @returns {{ intent: string, queries: string[], keywords: string[], timing: number }}
 */
async function rewriteQuery(question, options = {}) {
  const startTime = Date.now();
  const { provider = 'gemini', history = [] } = options;

  // 대화 히스토리가 있으면 맥락으로 추가
  let historyContext = '';
  if (history.length > 0) {
    const recentHistory = history.slice(-6);
    historyContext = '\n\n## 이전 대화 맥락\n' + recentHistory.map(h =>
      h.role === 'user' ? `사용자: ${h.content}` : `AI: ${h.content.substring(0, 100)}`
    ).join('\n') + '\n';
  }

  try {
    // DB 템플릿 로드 시도
    const templateResult = await buildPrompt('query-rewrite', 'default', {
      question: question + historyContext,
    });

    const result = await callLLM(templateResult.prompt, {
      provider,
      temperature: templateResult.modelParams?.temperature ?? 0.1,
      maxTokens: templateResult.modelParams?.maxTokens ?? 512,
      _endpoint: 'query-rewrite',
    });

    // JSON 파싱
    const jsonMatch = result.match(/```json\s*([\s\S]*?)```/) || result.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : result;
    const parsed = JSON.parse(jsonStr);

    return {
      intent: parsed.intent || question,
      queries: Array.isArray(parsed.queries) ? parsed.queries.slice(0, 3) : [question],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      timing: Date.now() - startTime,
    };
  } catch (err) {
    console.warn('[QueryRewrite] 리라이팅 실패, 원본 질문 사용:', err.message);
    return {
      intent: question,
      queries: [question],
      keywords: [],
      timing: Date.now() - startTime,
      error: err.message,
    };
  }
}

/**
 * HyDE — LLM으로 가상 문서 생성 후 임베딩
 * DB에 'hyde' 템플릿이 있으면 사용, 없으면 폴백
 *
 * @param {string} question - 원본 질문
 * @param {Object} options - { provider }
 * @returns {{ hypotheticalDoc: string, embedding: number[], timing: number }}
 */
async function generateHyDE(question, options = {}) {
  const startTime = Date.now();
  const { provider = 'gemini' } = options;

  try {
    // DB 템플릿 로드 시도
    const templateResult = await buildPrompt('hyde', 'default', {
      question,
    });

    // 1) LLM으로 가상 문서 생성
    const hypotheticalDoc = await callLLM(templateResult.prompt, {
      provider,
      temperature: templateResult.modelParams?.temperature ?? 0.3,
      maxTokens: templateResult.modelParams?.maxTokens ?? 512,
      _endpoint: 'hyde',
    });

    // 2) 가상 문서 임베딩 생성
    const embedding = await generateEmbedding(hypotheticalDoc.trim());

    return {
      hypotheticalDoc: hypotheticalDoc.trim(),
      embedding,
      timing: Date.now() - startTime,
    };
  } catch (err) {
    console.warn('[HyDE] 가상 문서 생성 실패, 원본 질문 임베딩 사용:', err.message);
    // fallback: 원본 질문 임베딩
    const embedding = await generateEmbedding(question);
    return {
      hypotheticalDoc: null,
      embedding,
      timing: Date.now() - startTime,
      error: err.message,
    };
  }
}

/**
 * 쿼리 리라이팅 + HyDE 결합 임베딩 생성
 * 원본 질문 임베딩 + HyDE 임베딩을 평균하여 더 나은 검색 벡터 생성
 *
 * @param {string} question - 원본 질문
 * @param {number[]} hydeEmbedding - HyDE 가상 문서 임베딩
 * @returns {number[]} 결합 임베딩
 */
async function blendEmbeddings(question, hydeEmbedding) {
  const questionEmbedding = await generateEmbedding(question);

  // 가중 평균: 원본 40% + HyDE 60% (가상 문서가 실제 문서와 더 유사)
  const alpha = 0.4;
  const blended = questionEmbedding.map((val, i) =>
    alpha * val + (1 - alpha) * hydeEmbedding[i]
  );

  // L2 정규화
  const norm = Math.sqrt(blended.reduce((sum, v) => sum + v * v, 0));
  return blended.map(v => v / norm);
}

module.exports = {
  rewriteQuery,
  generateHyDE,
  blendEmbeddings,
};
