// LLM 기반 NER (Named Entity Recognition)
// 정규식 NER이 놓치는 엔티티를 LLM Few-shot으로 보완하는 2단계 파이프라인
//
// 동작 방식:
//   1단계: extractEntities()(정규식+사전) → 기본 엔티티 추출
//   2단계: extractEntitiesWithLLM() → 정규식 결과를 힌트로 전달, 미탐지 엔티티를 LLM이 보완
//   병합: 정규식 결과 + LLM 결과를 합쳐서 중복 제거
//
// 사용법:
//   const { hybridExtractEntities } = require('./llm-ner');
//   const entities = await hybridExtractEntities(text, selfLawName, { useLLM: true });

const { callGemini } = require('./gemini');
const { extractEntities, CONCEPT_DICT } = require('./knowledge-graph');

// ── Few-shot 프롬프트 ──────────────────────────────────
// LLM에게 엔티티 추출을 요청하는 프롬프트
// 정규식이 이미 찾은 엔티티를 "힌트"로 제공하여 중복 작업을 줄임

/**
 * LLM NER용 프롬프트 생성
 * @param {string} text - 분석할 텍스트
 * @param {{ name: string, type: string }[]} regexEntities - 정규식으로 이미 찾은 엔티티
 * @returns {string} LLM 프롬프트
 */
function buildNERPrompt(text, regexEntities) {
  // 정규식이 이미 찾은 엔티티 목록 (LLM이 중복 추출하지 않도록)
  const alreadyFound = regexEntities.length > 0
    ? regexEntities.map(e => `  - ${e.name} (${e.type})`).join('\n')
    : '  (없음)';

  return `당신은 한국 법률 문서 전문 NER(Named Entity Recognition) 시스템입니다.
아래 텍스트에서 정규식이 놓친 엔티티를 추가로 찾아주세요.

## 엔티티 타입 (5가지)
- law: 법령명 (예: 개인정보 보호법, 정보통신망법, 전자서명법)
- article: 조문 번호 (예: 제10조, 제15조의2제3항)
- organization: 기관/조직 (예: 개인정보보호위원회, 방송통신위원회, 한국인터넷진흥원)
- concept: 법률 개념/용어 (예: 정보주체, 개인정보처리자, 동의, 제3자제공, 가명처리)
- duty: 의무/권리/책임 (예: 고지의무, 열람권, 삭제요구권, 접근권한관리의무)

## 정규식이 이미 찾은 엔티티 (이것은 건너뛰세요)
${alreadyFound}

## Few-shot 예시

### 입력 텍스트
"개인정보처리자는 정보주체의 개인정보를 수집·이용하려면 사전에 동의를 받아야 하며, 개인정보 보호법에 따라 보유기간이 경과한 개인정보는 지체 없이 파기하여야 한다."

### 출력 (이미 찾은 엔티티는 제외)
[
  {"name": "수집", "type": "concept"},
  {"name": "이용", "type": "concept"},
  {"name": "파기의무", "type": "duty"},
  {"name": "동의의무", "type": "duty"}
]

### 입력 텍스트
"과학기술정보통신부장관은 전기통신사업법 제22조에 따른 이용약관의 인가 또는 신고와 관련하여 방송통신위원회의 의견을 들어야 한다."

### 출력 (이미 찾은 엔티티는 제외)
[
  {"name": "전기통신사업법", "type": "law"},
  {"name": "이용약관", "type": "concept"},
  {"name": "인가", "type": "concept"},
  {"name": "과학기술정보통신부장관", "type": "organization"}
]

## 분석할 텍스트
${text.substring(0, 2000)}

## 지침
1. 위에서 "이미 찾은 엔티티"에 포함된 것은 절대 출력하지 마세요
2. 정규식이 놓쳤을 가능성이 높은 것: 복합 법률 용어, 약칭 법령명, 비정형 기관명, 관계 동사에서 파생된 의무/권리
3. 최소 2자 이상의 의미 있는 엔티티만 추출하세요
4. JSON 배열만 출력하세요 (설명 없이)
5. 확실하지 않으면 빈 배열 [] 을 반환하세요

## 출력 (JSON 배열만)`;
}

/**
 * LLM을 사용한 엔티티 추출
 * @param {string} text - 원문 텍스트
 * @param {{ name: string, type: string }[]} regexEntities - 정규식으로 찾은 엔티티
 * @param {object} [options] - { model, temperature, timeout }
 * @returns {Promise<{ name: string, type: string, offset: number, source: string }[]>}
 */
async function extractEntitiesWithLLM(text, regexEntities, options = {}) {
  if (!text || text.length < 10) return [];

  const prompt = buildNERPrompt(text, regexEntities);

  try {
    const response = await callGemini(prompt, {
      model: options.model || 'gemini-2.0-flash',
      temperature: options.temperature ?? 0.1,
      maxTokens: options.maxTokens || 1024,
      timeout: options.timeout || 15000,
    });

    // JSON 파싱 (코드 블록 제거)
    const cleaned = response
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    // 유효한 엔티티 타입만 필터링
    const validTypes = new Set(['law', 'article', 'organization', 'concept', 'duty']);
    const regexNames = new Set(regexEntities.map(e => e.name));

    return parsed
      .filter(e =>
        e.name &&
        e.type &&
        validTypes.has(e.type) &&
        e.name.length >= 2 &&
        !regexNames.has(e.name) // 정규식과 중복 제거
      )
      .map(e => ({
        name: e.name.replace(/\s+/g, ' ').trim(),
        type: e.type,
        offset: text.indexOf(e.name), // 원문에서 위치 찾기
        source: 'llm', // 출처 표시
      }));
  } catch (err) {
    console.warn('[LLM-NER] LLM 엔티티 추출 실패:', err.message);
    return [];
  }
}

/**
 * 하이브리드 NER: 정규식 + LLM 2단계 파이프라인
 *
 * @param {string} text - 원문 텍스트
 * @param {string} [selfLawName] - 자기 법령명
 * @param {object} [options]
 * @param {boolean} [options.useLLM=true] - LLM 보완 사용 여부
 * @param {string} [options.model] - LLM 모델
 * @param {number} [options.minTextLength=50] - LLM 호출 최소 텍스트 길이
 * @returns {Promise<{ name: string, type: string, offset: number, source: string }[]>}
 */
async function hybridExtractEntities(text, selfLawName, options = {}) {
  const { useLLM = true, minTextLength = 50 } = options;

  // 1단계: 정규식 NER (항상 실행, 매우 빠름)
  const regexEntities = extractEntities(text, selfLawName)
    .map(e => ({ ...e, source: 'regex' }));

  // LLM 비활성화이거나 텍스트가 너무 짧으면 정규식 결과만 반환
  if (!useLLM || !text || text.length < minTextLength) {
    return regexEntities;
  }

  // 2단계: LLM NER (정규식 결과를 힌트로 전달)
  const llmEntities = await extractEntitiesWithLLM(text, regexEntities, options);

  // 3단계: 병합 + 중복 제거
  const merged = [...regexEntities];
  const seen = new Set(regexEntities.map(e => `${e.type}:${e.name}`));

  for (const ent of llmEntities) {
    const key = `${ent.type}:${ent.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(ent);
    }
  }

  return merged;
}

/**
 * LLM 기반 관계 추출 (트리플 보완)
 * 정규식으로 패턴 매칭이 안 되는 복잡한 관계를 LLM이 추출
 *
 * @param {string} text - 원문 텍스트
 * @param {{ name: string, type: string }[]} entities - 엔티티 목록
 * @param {{ subject: string, predicate: string, object: string }[]} regexTriples - 정규식 트리플
 * @param {object} [options]
 * @returns {Promise<{ subject, subjectType, predicate, object, objectType, confidence, context, source }[]>}
 */
async function extractTriplesWithLLM(text, entities, regexTriples, options = {}) {
  if (!text || text.length < 50 || entities.length < 2) return [];

  // 이미 찾은 관계 요약
  const existingRelations = regexTriples.length > 0
    ? regexTriples.slice(0, 10).map(t => `  - ${t.subject} → ${t.predicate} → ${t.object}`).join('\n')
    : '  (없음)';

  // 엔티티 목록
  const entityList = entities.slice(0, 30).map(e => `${e.name}(${e.type})`).join(', ');

  const prompt = `당신은 한국 법률 문서에서 개체 간 관계를 추출하는 전문가입니다.

## 사용 가능한 관계(predicate) 14가지
준용, 적용, 예외, 의거, 위반, 정의, 위임, 관할, 소속, 근거, 제한, 부과, 보호, 고지

## 텍스트에 등장하는 엔티티
${entityList}

## 정규식이 이미 찾은 관계 (이것은 건너뛰세요)
${existingRelations}

## 텍스트
${text.substring(0, 1500)}

## 지침
1. 위 14가지 관계 중에서만 선택하세요
2. 이미 찾은 관계와 동일한 것은 제외하세요
3. 주어(subject)와 목적어(object)는 반드시 위 엔티티 목록에 있는 이름이어야 합니다
4. confidence는 0.6~1.0 사이로 설정하세요
5. JSON 배열만 출력하세요

## 출력 형식
[{"subject": "엔티티A", "subjectType": "law", "predicate": "관계", "object": "엔티티B", "objectType": "concept", "confidence": 0.8, "context": "관련 문장 발췌 (50자 이내)"}]

## 출력 (JSON 배열만)`;

  try {
    const response = await callGemini(prompt, {
      model: options.model || 'gemini-2.0-flash',
      temperature: 0.1,
      maxTokens: 1024,
      timeout: 15000,
    });

    const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    const validPredicates = new Set([
      '준용', '적용', '예외', '의거', '위반', '정의', '위임',
      '관할', '소속', '근거', '제한', '부과', '보호', '고지',
    ]);
    const entityNames = new Set(entities.map(e => e.name));
    const existingKeys = new Set(regexTriples.map(t => `${t.subject}|${t.predicate}|${t.object}`));

    return parsed
      .filter(t =>
        t.subject && t.object && t.predicate &&
        validPredicates.has(t.predicate) &&
        entityNames.has(t.subject) &&
        entityNames.has(t.object) &&
        t.subject !== t.object &&
        !existingKeys.has(`${t.subject}|${t.predicate}|${t.object}`)
      )
      .map(t => ({
        subject: t.subject,
        subjectType: t.subjectType || 'concept',
        predicate: t.predicate,
        object: t.object,
        objectType: t.objectType || 'concept',
        confidence: Math.min(Math.max(parseFloat(t.confidence) || 0.7, 0.5), 1.0),
        context: (t.context || '').substring(0, 100),
        source: 'llm',
      }));
  } catch (err) {
    console.warn('[LLM-NER] LLM 관계 추출 실패:', err.message);
    return [];
  }
}

module.exports = {
  hybridExtractEntities,
  extractEntitiesWithLLM,
  extractTriplesWithLLM,
  buildNERPrompt,
};
