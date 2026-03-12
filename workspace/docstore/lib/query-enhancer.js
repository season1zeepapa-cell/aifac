// 쿼리 강화 모듈 (Query Rewriting + HyDE)
//
// 1. Query Rewriting (쿼리 리라이팅)
//    - 사용자 질문을 검색에 최적화된 형태로 변환
//    - 복합 질문 → 하위 질문으로 분해
//    - 법률 용어 확장 (일상어 → 법률 용어)
//
// 2. HyDE (Hypothetical Document Embeddings)
//    - LLM으로 "가상의 답변 문서"를 생성
//    - 질문 임베딩 대신 가상 문서 임베딩으로 벡터 검색
//    - 질문↔문서 의미 격차(lexical gap) 해소

const { callLLM } = require('./gemini');
const { generateEmbedding } = require('./embeddings');

// ── 쿼리 리라이팅 프롬프트 ──────────────────────────

const REWRITE_PROMPT = `당신은 법령 검색 전문가입니다. 사용자의 질문을 검색에 최적화된 쿼리로 변환해주세요.

## 작업
1. 원본 질문의 핵심 의도를 파악하세요
2. 일상적 표현을 법률 용어로 변환하세요
3. 복합 질문이면 2~3개의 하위 질문으로 분해하세요
4. 각 쿼리는 독립적으로 검색 가능해야 합니다

## 출력 형식
반드시 아래 JSON만 출력하세요. 다른 텍스트는 포함하지 마세요.

\`\`\`json
{
  "intent": "질문의 핵심 의도 (1문장)",
  "queries": ["검색 쿼리1", "검색 쿼리2", "검색 쿼리3"],
  "keywords": ["핵심 키워드1", "핵심 키워드2"]
}
\`\`\`

## 변환 예시
- "CCTV 달 때 뭐 지켜야 해?" → ["영상정보처리기기 설치 운영 제한 요건", "CCTV 설치 시 안내판 고지 의무"]
- "개인정보 해외로 보내도 되나?" → ["개인정보 국외이전 요건", "개인정보 제3국 제공 동의 절차", "개인정보 국외이전 보호조치"]
- "벌금 얼마야?" → ["개인정보보호법 벌칙 과태료", "개인정보 위반 시 벌금 징역 형량"]

## 규칙
- queries는 최소 1개, 최대 3개
- 각 쿼리는 명사형 키워드 중심 (조사 최소화)
- 법률 조문에서 쓰이는 용어로 변환
- 원본 질문의 의미를 유지하되 검색 적합성을 높이세요`;

// ── HyDE 프롬프트 ───────────────────────────────────

const HYDE_PROMPT = `당신은 법령 전문가입니다. 아래 질문에 대한 답변이 포함된 법령 조문이나 해설 문서의 일부를 작성해주세요.

## 규칙
- 실제 법령 조문과 비슷한 형식으로 작성하세요
- 150~300자 정도의 짧은 문단 하나만 작성하세요
- 정확한 조문 번호는 추측하지 마세요
- 질문의 답변에 해당하는 핵심 내용을 포함하세요
- 법률 용어와 문체를 사용하세요
- JSON이 아닌 일반 텍스트로 작성하세요

## 예시
질문: "개인정보를 제3자에게 제공할 때 필요한 것은?"
가상 문서: "개인정보처리자는 정보주체의 개인정보를 제3자에게 제공하는 경우에는 정보주체에게 제공받는 자, 제공받는 자의 개인정보 이용 목적, 제공하는 개인정보의 항목, 개인정보를 제공받는 자의 개인정보 보유 및 이용 기간, 동의를 거부할 권리가 있다는 사실 및 동의 거부에 따른 불이익의 내용을 알리고 동의를 받아야 한다."`;

/**
 * 쿼리 리라이팅 — LLM으로 질문을 검색 최적화 쿼리로 변환
 * @param {string} question - 원본 질문
 * @param {Object} options - { provider, history }
 * @returns {{ intent: string, queries: string[], keywords: string[], timing: number }}
 */
async function rewriteQuery(question, options = {}) {
  const startTime = Date.now();
  const { provider = 'gemini', history = [] } = options;

  // 대화 히스토리가 있으면 맥락으로 추가
  let contextPrompt = '';
  if (history.length > 0) {
    const recentHistory = history.slice(-6);
    contextPrompt = '\n\n## 이전 대화 맥락\n' + recentHistory.map(h =>
      h.role === 'user' ? `사용자: ${h.content}` : `AI: ${h.content.substring(0, 100)}`
    ).join('\n') + '\n';
  }

  const prompt = `${REWRITE_PROMPT}${contextPrompt}\n\n## 현재 질문\n${question}`;

  try {
    const result = await callLLM(prompt, {
      provider,
      temperature: 0.1,
      maxTokens: 512,
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
 * @param {string} question - 원본 질문
 * @param {Object} options - { provider }
 * @returns {{ hypotheticalDoc: string, embedding: number[], timing: number }}
 */
async function generateHyDE(question, options = {}) {
  const startTime = Date.now();
  const { provider = 'gemini' } = options;

  try {
    // 1) LLM으로 가상 문서 생성
    const hypotheticalDoc = await callLLM(
      `${HYDE_PROMPT}\n\n## 질문\n${question}`,
      {
        provider,
        temperature: 0.3,
        maxTokens: 512,
        _endpoint: 'hyde',
      }
    );

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
