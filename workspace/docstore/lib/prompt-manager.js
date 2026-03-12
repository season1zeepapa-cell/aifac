// 프롬프트 템플릿 관리 엔진
//
// DB에 저장된 프롬프트 템플릿을 로드하고, 변수를 치환하여 최종 프롬프트를 생성한다.
// DB에 템플릿이 없으면 하드코딩된 기본값(FALLBACK_TEMPLATES)을 사용한다.
//
// 핵심 기능:
//   1. 카테고리별 프롬프트 선택 (법령/규정/기출/일반)
//   2. Few-shot 예시 자동 삽입
//   3. 프롬프트 체인 (query-analysis → rag-answer → verify)
//   4. 메모리 캐시 (5분 TTL)

// ── 캐시 설정 ──
const CACHE_TTL = 5 * 60 * 1000; // 5분
let _cache = new Map(); // key: "name:category" → { template, timestamp }
let _dbQuery = null; // DB 쿼리 함수 참조

/**
 * DB 쿼리 함수를 설정 (앱 시작 시 1회 호출)
 */
function setDbQuery(queryFn) {
  _dbQuery = queryFn;
}

/**
 * 캐시 초기화 (템플릿 수정 후 호출)
 */
function clearCache() {
  _cache.clear();
}

// ── 폴백 템플릿 (DB 없이도 동작) ──
const FALLBACK_TEMPLATES = {
  'rag-answer:default': {
    template: `당신은 전문 AI 어시스턴트입니다. 아래 근거 자료를 참고하여 사용자의 질문에 정확하게 답변해주세요.

## 답변 형식

반드시 아래 JSON 형식으로만 답변하세요. JSON 외의 텍스트는 절대 포함하지 마세요.

\`\`\`json
{
  "conclusion": "질문에 대한 직접 답변 (1~3문장, 한국어)",
  "evidenceChain": [
    {
      "sourceIndex": 1,
      "sourceLabel": "출처명",
      "quote": "핵심 내용 인용",
      "reasoning": "이 근거가 의미하는 바 설명"
    }
  ],
  "crossReferences": [
    {
      "from": "출처A",
      "to": "출처B",
      "relation": "준용|적용|예외|관련"
    }
  ],
  "caveats": "예외 사항, 주의할 점 (없으면 빈 문자열)"
}
\`\`\`

## 규칙
- 근거 자료에 있는 내용만 바탕으로 답변하세요
- 근거 자료에 없는 내용은 "해당 내용은 제공된 자료에서 확인할 수 없습니다"라고 답변하세요
- sourceIndex는 근거 자료 번호(1부터)와 정확히 일치해야 합니다
- evidenceChain은 결론에 이르는 논리 경로를 단계별로 작성하세요
- crossReferences는 근거 자료 사이의 참조/준용/예외 관계만 포함 (없으면 빈 배열)
- 답변은 한국어로 작성하세요
- 이전 대화가 있으면 맥락을 이어서 답변하세요

{{fewShotBlock}}

--- 근거 자료 (총 {{sourceCount}}건) ---
{{contextText}}
{{historyText}}

--- 현재 질문 ---
{{question}}`,
    few_shot_examples: [
      {
        input: '개인정보 수집 시 동의를 받아야 하나요?',
        output: '{"conclusion":"개인정보보호법 제15조에 따라 개인정보를 수집할 때는 정보주체의 동의를 받아야 합니다.","evidenceChain":[{"sourceIndex":1,"sourceLabel":"제15조 개인정보의 수집·이용","quote":"개인정보처리자는 정보주체의 동의를 받은 경우 개인정보를 수집할 수 있다","reasoning":"개인정보 수집의 법적 근거로 동의를 명시하고 있다"}],"crossReferences":[],"caveats":"다만 법률에 특별한 규정이 있거나 법령상 의무를 준수하기 위해 불가피한 경우 등 예외가 존재합니다."}'
      }
    ],
    model_params: { temperature: 0.3, maxTokens: 3072 },
  },

  'query-rewrite:default': {
    template: `당신은 법령 검색 전문가입니다. 사용자의 질문을 검색에 최적화된 쿼리로 변환해주세요.

## 작업
1. 원본 질문의 핵심 의도를 파악하세요
2. 일상적 표현을 법률 용어로 변환하세요
3. 복합 질문이면 2~3개의 하위 질문으로 분해하세요
4. 각 쿼리는 독립적으로 검색 가능해야 합니다

## 출력 형식
반드시 아래 JSON만 출력하세요. 다른 텍스트는 포함하지 마세요.
{"intent":"질문의 핵심 의도 (1문장)","queries":["검색 쿼리1","검색 쿼리2","검색 쿼리3"],"keywords":["핵심 키워드1","핵심 키워드2"]}

{{fewShotBlock}}

--- 질문 ---
{{question}}`,
    few_shot_examples: [],
    model_params: { temperature: 0.1, maxTokens: 512 },
  },

  'hyde:default': {
    template: `당신은 법령 전문가입니다. 아래 질문에 대한 답변이 포함된 법령 조문이나 해설 문서의 일부를 작성해주세요.

## 규칙
- 실제 법령 조문과 비슷한 형식으로 작성하세요
- 150~300자 정도의 짧은 문단 하나만 작성하세요
- 정확한 조문 번호는 추측하지 마세요
- 질문의 답변에 해당하는 핵심 내용을 포함하세요
- 법률 용어와 문체를 사용하세요
- JSON이 아닌 일반 텍스트로 작성하세요

--- 질문 ---
{{question}}`,
    few_shot_examples: [],
    model_params: { temperature: 0.3, maxTokens: 512 },
  },
};

/**
 * DB에서 프롬프트 템플릿 로드 (캐시 우선)
 *
 * 조회 우선순위:
 *   1. 정확한 name + category 매칭
 *   2. name + 'default' 카테고리 폴백
 *   3. FALLBACK_TEMPLATES 하드코딩 폴백
 *
 * @param {string} name - 템플릿 이름 ('rag-answer', 'query-rewrite', 'hyde', 등)
 * @param {string} [category='default'] - 문서 카테고리 ('법령', '규정', '기출', 'default')
 * @returns {Promise<Object>} { template, few_shot_examples, model_params }
 */
async function loadTemplate(name, category = 'default') {
  // 캐시 키: "name:category"
  const cacheKey = `${name}:${category}`;

  // 1) 캐시 확인
  const cached = _cache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return cached.data;
  }

  // 2) DB 조회 시도
  if (_dbQuery) {
    try {
      // 정확한 카테고리 매칭 → default 폴백 순서로 조회
      const result = await _dbQuery(
        `SELECT template, few_shot_examples, model_params, category
         FROM prompt_templates
         WHERE name = $1 AND category IN ($2, 'default') AND is_active = true
         ORDER BY CASE WHEN category = $2 THEN 0 ELSE 1 END
         LIMIT 1`,
        [name, category]
      );

      if (result.rows.length > 0) {
        const row = result.rows[0];
        const data = {
          template: row.template,
          few_shot_examples: row.few_shot_examples || [],
          model_params: row.model_params || {},
          fromDb: true,
          matchedCategory: row.category,
        };
        _cache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
      }
    } catch (err) {
      console.warn('[PromptManager] DB 조회 실패, 폴백 사용:', err.message);
    }
  }

  // 3) 하드코딩 폴백
  const fallbackKey = `${name}:${category}`;
  const defaultKey = `${name}:default`;
  const fallback = FALLBACK_TEMPLATES[fallbackKey] || FALLBACK_TEMPLATES[defaultKey];

  if (fallback) {
    const data = {
      template: fallback.template,
      few_shot_examples: fallback.few_shot_examples || [],
      model_params: fallback.model_params || {},
      fromDb: false,
      matchedCategory: 'default',
    };
    _cache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  }

  // 아무것도 못 찾으면 null
  return null;
}

/**
 * Few-shot 예시를 프롬프트에 삽입할 텍스트로 변환
 *
 * @param {Array} examples - [{ input, output }] 배열
 * @returns {string} 포맷된 예시 텍스트 (비어있으면 빈 문자열)
 */
function formatFewShotExamples(examples) {
  if (!examples || examples.length === 0) return '';

  const lines = ['', '## 예시'];
  for (let i = 0; i < examples.length; i++) {
    const ex = examples[i];
    lines.push(`### 예시 ${i + 1}`);
    lines.push(`질문: ${ex.input}`);
    lines.push(`답변: ${ex.output}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * 템플릿에 변수를 치환하여 최종 프롬프트 생성
 *
 * 지원 변수:
 *   {{question}}     - 사용자 질문
 *   {{contextText}}  - 검색된 근거 자료
 *   {{historyText}}  - 대화 히스토리
 *   {{sourceCount}}  - 근거 자료 수
 *   {{fewShotBlock}} - Few-shot 예시 (자동 생성)
 *   {{answer}}       - AI 답변 (검증 단계용)
 *   기타 커스텀 변수도 가능
 *
 * @param {string} template - 템플릿 문자열
 * @param {Object} variables - { question, contextText, historyText, ... }
 * @param {Array} [fewShotExamples] - Few-shot 예시 배열
 * @returns {string} 완성된 프롬프트
 */
function renderTemplate(template, variables = {}, fewShotExamples = []) {
  let result = template;

  // Few-shot 블록 생성
  const fewShotBlock = formatFewShotExamples(fewShotExamples);
  variables.fewShotBlock = fewShotBlock;

  // {{variable}} 패턴 치환
  for (const [key, value] of Object.entries(variables)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(pattern, value ?? '');
  }

  return result;
}

/**
 * 프롬프트 체인 실행
 * 여러 단계의 프롬프트를 순서대로 실행하고, 이전 단계의 출력을 다음 단계 입력으로 전달
 *
 * @param {Object} options - {
 *   category: string,
 *   question: string,
 *   contextText: string,
 *   historyText: string,
 *   sourceCount: number,
 *   callLLM: Function,     // LLM 호출 함수
 *   llmOptions: Object,    // LLM 옵션 (provider, temperature 등)
 *   stages: string[],      // 실행할 단계들 ['query-analysis', 'rag-answer', 'rag-verify']
 *   onStageComplete: Function, // 단계 완료 콜백
 * }
 * @returns {Promise<Object>} { stages: { [name]: { prompt, output, timing } }, finalOutput }
 */
async function executePromptChain(options) {
  const {
    category = 'default',
    question,
    contextText = '',
    historyText = '',
    sourceCount = 0,
    callLLM,
    llmOptions = {},
    stages = ['rag-answer'],
    onStageComplete = null,
  } = options;

  const results = {};
  let previousOutput = null;

  for (const stageName of stages) {
    const startTime = Date.now();

    // 단계별 프롬프트 이름 매핑
    const templateName = stageName;
    const templateData = await loadTemplate(templateName, category);

    if (!templateData) {
      console.warn(`[PromptChain] 템플릿 없음: ${templateName} (${category}), 건너뜀`);
      continue;
    }

    // 변수 준비
    const variables = {
      question,
      contextText,
      historyText,
      sourceCount: String(sourceCount),
    };

    // 검증 단계에서는 이전 답변을 변수로 전달
    if (stageName === 'rag-verify' && previousOutput) {
      variables.answer = previousOutput;
    }

    // 프롬프트 렌더링
    const prompt = renderTemplate(
      templateData.template,
      variables,
      templateData.few_shot_examples
    );

    // 모델 파라미터 병합 (템플릿 설정 < 사용자 설정)
    const mergedOpts = {
      ...llmOptions,
      temperature: llmOptions.temperature ?? templateData.model_params?.temperature,
      maxTokens: llmOptions.maxTokens ?? templateData.model_params?.maxTokens,
      _endpoint: `prompt-chain-${stageName}`,
    };

    // LLM 호출
    try {
      const output = await callLLM(prompt, mergedOpts);
      const timing = Date.now() - startTime;

      results[stageName] = {
        prompt: prompt.substring(0, 200) + '...',
        output,
        timing,
        templateCategory: templateData.matchedCategory,
        fromDb: templateData.fromDb,
      };

      previousOutput = output;

      if (onStageComplete) {
        onStageComplete({ stage: stageName, output, timing });
      }
    } catch (err) {
      results[stageName] = {
        error: err.message,
        timing: Date.now() - startTime,
      };
      // 답변 생성 단계 실패 시 체인 중단
      if (stageName === 'rag-answer') break;
    }
  }

  return {
    stages: results,
    finalOutput: previousOutput,
  };
}

/**
 * 문서 카테고리를 기반으로 최적 프롬프트 로드 + 렌더링 (간편 함수)
 *
 * @param {string} name - 프롬프트 이름
 * @param {string} category - 문서 카테고리
 * @param {Object} variables - 템플릿 변수
 * @returns {Promise<{ prompt: string, modelParams: Object }>}
 */
async function buildPrompt(name, category, variables) {
  const templateData = await loadTemplate(name, category);
  if (!templateData) {
    throw new Error(`프롬프트 템플릿을 찾을 수 없습니다: ${name} (${category})`);
  }

  const prompt = renderTemplate(
    templateData.template,
    variables,
    templateData.few_shot_examples
  );

  return {
    prompt,
    modelParams: templateData.model_params || {},
    matchedCategory: templateData.matchedCategory,
    fromDb: templateData.fromDb,
  };
}

module.exports = {
  setDbQuery,
  clearCache,
  loadTemplate,
  renderTemplate,
  formatFewShotExamples,
  executePromptChain,
  buildPrompt,
  FALLBACK_TEMPLATES,
};
