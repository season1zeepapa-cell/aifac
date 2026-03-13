// Chain of Density (CoD) 반복 요약 엔진
//
// 원본 텍스트를 5회 반복 요약하며 매 회차마다 빠진 핵심 엔티티를 추가한다.
// 길이는 비슷하게 유지하면서 정보 밀도를 점진적으로 높이는 전략.
//
// 참고 논문: "From Sparse to Dense: GPT-4 Summarization with Chain of Density Prompting"
// (Adams et al., 2023)
//
// 사용법:
//   const { chainOfDensitySummarize } = require('./chain-of-density');
//   const result = await chainOfDensitySummarize(text, { provider, onStep });

const { callLLM } = require('./gemini');

// 기본 반복 횟수
const DEFAULT_ITERATIONS = 5;

// 요약 목표 길이 (한국어 기준 글자 수)
const TARGET_LENGTH = { short: 100, medium: 200, long: 400 };

/**
 * 1단계 프롬프트: 초기 요약 생성
 * 핵심만 뽑은 sparse한 요약을 만든다.
 *
 * @param {string} text - 원본 텍스트
 * @param {string} lengthGuide - 목표 길이 안내
 * @returns {string} 프롬프트
 */
function buildInitialPrompt(text, lengthGuide) {
  return `다음 문서를 ${lengthGuide} 분량으로 요약해주세요.
핵심 주제만 간략하게 다루되, 구체적인 수치나 세부 조항은 생략해도 됩니다.
추가 설명 없이 요약문만 반환하세요.

[문서]
${text}`;
}

/**
 * 2~5단계 프롬프트: 밀도 증가 요약
 * 이전 요약에서 빠진 핵심 엔티티를 찾아 추가한다.
 *
 * @param {string} text - 원본 텍스트
 * @param {string} prevSummary - 이전 회차 요약
 * @param {number} step - 현재 회차 (2~5)
 * @param {number} totalSteps - 총 반복 횟수
 * @param {string} lengthGuide - 목표 길이 안내
 * @returns {string} 프롬프트
 */
function buildDensifyPrompt(text, prevSummary, step, totalSteps, lengthGuide) {
  return `당신은 문서 요약 전문가입니다. Chain of Density 전략을 사용합니다.

## 작업
아래 [이전 요약]을 읽고, [원본 문서]에서 빠진 핵심 엔티티(법률 용어, 기관명, 조문 번호, 수치, 날짜, 핵심 개념 등)를 1~3개 찾아 요약에 추가해주세요.

## 규칙
1. 요약 길이는 ${lengthGuide}으로 이전과 비슷하게 유지
2. 덜 중요한 표현을 압축하여 새 엔티티를 위한 공간 확보
3. 추가하는 엔티티는 문서 이해에 꼭 필요한 것만 선별
4. 모든 정보는 원본 문서에 있는 내용이어야 함
5. 자연스러운 문장으로 통합 (나열식 금지)

## 현재 진행: ${step}/${totalSteps}단계
${step <= 3 ? '→ 주요 법률 개념, 기관, 조문을 중심으로 추가' : '→ 수치, 예외 조건, 관계 등 세부 정보까지 포함'}

[이전 요약]
${prevSummary}

[원본 문서]
${text}

위 규칙에 따라 개선된 요약문만 반환하세요. 설명이나 메타 정보는 포함하지 마세요.`;
}

/**
 * 엔티티 추출 프롬프트 (각 단계에서 추가된 엔티티 파악용)
 *
 * @param {string} prevSummary - 이전 요약
 * @param {string} currentSummary - 현재 요약
 * @returns {string} 프롬프트
 */
function buildEntityDiffPrompt(prevSummary, currentSummary) {
  return `다음 두 요약을 비교하여, [현재 요약]에 새로 추가된 핵심 엔티티(용어, 기관, 조문, 수치 등)를 쉼표로 구분하여 나열해주세요. 엔티티만 반환하세요.

[이전 요약]
${prevSummary}

[현재 요약]
${currentSummary}`;
}

/**
 * Chain of Density 반복 요약 실행
 *
 * 원본 텍스트를 N회 반복하며 점진적으로 고밀도 요약을 생성한다.
 * 매 회차의 요약과 추가된 엔티티를 기록하여 반환한다.
 *
 * @param {string} text - 원본 텍스트
 * @param {Object} [options]
 * @param {string} [options.provider='gemini'] - LLM 프로바이더
 * @param {string} [options.model] - 모델명 (미지정 시 프로바이더 기본값)
 * @param {number} [options.iterations=5] - 반복 횟수
 * @param {string} [options.length='medium'] - 목표 길이 (short/medium/long)
 * @param {string} [options.label] - 섹션/조문 라벨 (컨텍스트용)
 * @param {Function} [options.onStep] - 각 단계 완료 시 콜백 (step, summary, entities)
 * @param {boolean} [options.trackEntities=true] - 엔티티 추적 여부 (false면 LLM 호출 절약)
 * @returns {Promise<{
 *   finalSummary: string,
 *   steps: Array<{ step: number, summary: string, addedEntities: string[] }>,
 *   iterations: number,
 *   provider: string,
 *   model: string
 * }>}
 */
async function chainOfDensitySummarize(text, options = {}) {
  const {
    provider = 'gemini',
    model,
    iterations = DEFAULT_ITERATIONS,
    length = 'medium',
    label = '',
    onStep,
    trackEntities = true,
  } = options;

  // 텍스트가 너무 짧으면 CoD 불필요
  if (!text || text.trim().length < 50) {
    return {
      finalSummary: text?.trim() || '(내용 없음)',
      steps: [],
      iterations: 0,
      provider,
      model: model || 'N/A',
    };
  }

  // 원본 텍스트 길이 제한 (토큰 절약)
  const maxTextLen = 4000;
  const truncatedText = text.length > maxTextLen
    ? text.substring(0, maxTextLen) + '\n... (이하 생략)'
    : text;

  // 라벨이 있으면 원본에 포함
  const docText = label
    ? `[${label}]\n${truncatedText}`
    : truncatedText;

  // 목표 길이 안내 텍스트
  const targetChars = TARGET_LENGTH[length] || TARGET_LENGTH.medium;
  const lengthGuide = `약 ${targetChars}자 (${Math.ceil(targetChars / 40)}~${Math.ceil(targetChars / 30)}문장)`;

  // LLM 호출 공통 옵션
  const llmOpts = {
    provider,
    ...(model && { model }),
    maxTokens: 512,
    temperature: 0.3,
    timeout: 30000,
    _endpoint: 'cod-summary',
  };

  const steps = [];
  let currentSummary = '';

  // ── 1단계: 초기 요약 (sparse) ──
  const initialPrompt = buildInitialPrompt(docText, lengthGuide);
  currentSummary = await callLLM(initialPrompt, llmOpts);

  steps.push({
    step: 1,
    summary: currentSummary,
    addedEntities: [],
  });

  if (onStep) {
    onStep(1, currentSummary, []);
  }

  // ── 2~N단계: 밀도 증가 반복 ──
  for (let step = 2; step <= iterations; step++) {
    const prevSummary = currentSummary;

    // 밀도 증가 요약 생성
    const densifyPrompt = buildDensifyPrompt(
      docText, prevSummary, step, iterations, lengthGuide
    );
    currentSummary = await callLLM(densifyPrompt, llmOpts);

    // 추가된 엔티티 추적 (선택적)
    let addedEntities = [];
    if (trackEntities) {
      try {
        const entityPrompt = buildEntityDiffPrompt(prevSummary, currentSummary);
        const entityResult = await callLLM(entityPrompt, {
          ...llmOpts,
          maxTokens: 128,
          _endpoint: 'cod-entity-diff',
        });
        addedEntities = entityResult
          .split(/[,，]/)
          .map(e => e.trim())
          .filter(e => e.length > 0 && e.length < 50);
      } catch {
        // 엔티티 추적 실패해도 요약은 계속 진행
      }
    }

    steps.push({
      step,
      summary: currentSummary,
      addedEntities,
    });

    if (onStep) {
      onStep(step, currentSummary, addedEntities);
    }
  }

  return {
    finalSummary: currentSummary,
    steps,
    iterations,
    provider,
    model: model || 'default',
  };
}

module.exports = {
  chainOfDensitySummarize,
  DEFAULT_ITERATIONS,
  TARGET_LENGTH,
};
