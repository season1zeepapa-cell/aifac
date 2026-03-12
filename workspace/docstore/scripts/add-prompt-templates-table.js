// prompt_templates 테이블 생성 마이그레이션
// 프롬프트 템플릿을 DB에 저장하여 재배포 없이 수정 가능하게 함
//
// 실행: node scripts/add-prompt-templates-table.js
require('dotenv').config();
const { query } = require('../lib/db');

async function migrate() {
  console.log('[마이그레이션] prompt_templates 테이블 생성 시작...');

  await query(`
    CREATE TABLE IF NOT EXISTS prompt_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'default',
      stage TEXT NOT NULL DEFAULT 'main',
      template TEXT NOT NULL,
      few_shot_examples JSONB DEFAULT '[]',
      model_params JSONB DEFAULT '{}',
      is_active BOOLEAN DEFAULT true,
      version INTEGER DEFAULT 1,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(name, category)
    )
  `);

  // name+category 복합 유니크 인덱스 (이미 UNIQUE 제약이 있지만 검색 성능용)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_prompt_templates_name_category
    ON prompt_templates(name, category)
  `);

  // 활성 템플릿 빠른 조회용
  await query(`
    CREATE INDEX IF NOT EXISTS idx_prompt_templates_active
    ON prompt_templates(is_active, name)
  `);

  console.log('[마이그레이션] prompt_templates 테이블 생성 완료');

  // 기존 데이터 확인
  const existing = await query('SELECT COUNT(*) AS cnt FROM prompt_templates');
  if (parseInt(existing.rows[0].cnt) > 0) {
    console.log(`[마이그레이션] 이미 ${existing.rows[0].cnt}개 템플릿이 존재합니다. 기본값 삽입을 건너뜁니다.`);
    return;
  }

  console.log('[마이그레이션] 기본 프롬프트 템플릿 삽입 중...');

  // ── 기본 프롬프트 템플릿들 삽입 ──
  const templates = [
    // 1) RAG 답변 - default (기본)
    {
      name: 'rag-answer',
      category: 'default',
      stage: 'main',
      description: 'RAG 답변 생성 기본 프롬프트',
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
      few_shot_examples: JSON.stringify([
        {
          input: '개인정보 수집 시 동의를 받아야 하나요?',
          output: '{"conclusion":"개인정보보호법 제15조에 따라 개인정보를 수집할 때는 정보주체의 동의를 받아야 합니다.","evidenceChain":[{"sourceIndex":1,"sourceLabel":"제15조 개인정보의 수집·이용","quote":"개인정보처리자는 정보주체의 동의를 받은 경우 개인정보를 수집할 수 있다","reasoning":"개인정보 수집의 법적 근거로 동의를 명시하고 있다"}],"crossReferences":[],"caveats":"다만 법률에 특별한 규정이 있거나 법령상 의무를 준수하기 위해 불가피한 경우 등 예외가 존재합니다."}'
        }
      ]),
      model_params: JSON.stringify({ temperature: 0.3, maxTokens: 3072 }),
    },

    // 2) RAG 답변 - 법령 카테고리
    {
      name: 'rag-answer',
      category: '법령',
      stage: 'main',
      description: 'RAG 답변 - 법령 문서 전용 (조문 번호, 법적 근거 중시)',
      template: `당신은 법령 및 법률 해석 전문 AI 어시스턴트입니다. 아래 근거 자료(법률 조문)를 참고하여 사용자의 질문에 정확하게 답변해주세요.

## 답변 형식

반드시 아래 JSON 형식으로만 답변하세요.

\`\`\`json
{
  "conclusion": "질문에 대한 직접 답변 (법적 근거를 명시하며 1~3문장, 한국어)",
  "evidenceChain": [
    {
      "sourceIndex": 1,
      "sourceLabel": "출처 조문명 (예: 제25조 영상정보처리기기의 설치·운영 제한)",
      "quote": "해당 조문의 핵심 내용 인용 (원문 그대로)",
      "reasoning": "이 조문이 질문에 대한 근거가 되는 이유"
    }
  ],
  "crossReferences": [
    {
      "from": "조문A (예: 제15조)",
      "to": "조문B (예: 제39조)",
      "relation": "준용|적용|예외|의거|위반"
    }
  ],
  "caveats": "단서 조항, 예외 규정, 적용 제한 사항 (없으면 빈 문자열)"
}
\`\`\`

## 법령 답변 규칙
- 반드시 조문 번호(제N조)와 항 번호(제N항)를 명시하세요
- 근거 조문의 원문을 정확히 인용하세요 (의역 금지)
- 준용/적용/예외 관계가 있으면 crossReferences에 반드시 포함하세요
- 단서 조항("다만", "그러하지 아니하다")이 있으면 caveats에 명시하세요
- 벌칙/과태료가 관련되면 해당 조문도 evidenceChain에 포함하세요
- 근거 자료에 없는 내용은 추측하지 마세요
- 이전 대화가 있으면 맥락을 이어서 답변하세요

{{fewShotBlock}}

--- 근거 자료 (총 {{sourceCount}}건) ---
{{contextText}}
{{historyText}}

--- 현재 질문 ---
{{question}}`,
      few_shot_examples: JSON.stringify([
        {
          input: 'CCTV 설치 시 안내판을 꼭 설치해야 하나요?',
          output: '{"conclusion":"개인정보 보호법 제25조제4항에 따라 영상정보처리기기를 설치·운영하는 자는 정보주체가 쉽게 인식할 수 있도록 안내판을 설치하여야 합니다.","evidenceChain":[{"sourceIndex":1,"sourceLabel":"제25조제4항 영상정보처리기기의 설치·운영 제한","quote":"영상정보처리기기운영자는 영상정보처리기기가 설치·운영되고 있음을 정보주체가 쉽게 인식할 수 있도록 안내판 설치 등 필요한 조치를 하여야 한다","reasoning":"CCTV 설치 시 안내판 설치가 법적 의무임을 명시하고 있다"}],"crossReferences":[{"from":"제25조제4항","to":"시행령 제24조","relation":"의거"}],"caveats":"안내판에는 설치 목적, 장소, 촬영 범위·시간, 관리책임자 연락처 등을 기재해야 합니다(시행령 제24조)."}'
        }
      ]),
      model_params: JSON.stringify({ temperature: 0.2, maxTokens: 3072 }),
    },

    // 3) RAG 답변 - 기출 카테고리
    {
      name: 'rag-answer',
      category: '기출',
      stage: 'main',
      description: 'RAG 답변 - 기출문제 해설 전용 (정답 근거 명시)',
      template: `당신은 자격시험 문제 해설 전문 AI입니다. 아래 근거 자료를 참고하여 사용자의 질문에 정확하게 답변해주세요.

## 답변 형식

반드시 아래 JSON 형식으로만 답변하세요.

\`\`\`json
{
  "conclusion": "질문에 대한 직접 답변 (정답과 그 이유를 1~3문장으로, 한국어)",
  "evidenceChain": [
    {
      "sourceIndex": 1,
      "sourceLabel": "출처명",
      "quote": "정답의 근거가 되는 핵심 내용",
      "reasoning": "이 근거로 해당 보기가 정답/오답인 이유"
    }
  ],
  "crossReferences": [],
  "caveats": "오답 함정, 자주 혼동되는 개념 (없으면 빈 문자열)"
}
\`\`\`

## 기출 해설 규칙
- 정답의 법적 근거를 조문 번호와 함께 명시하세요
- 각 보기가 맞는지/틀린지 근거를 설명하세요
- 자주 출제되는 포인트나 함정을 caveats에 포함하세요
- 유사 문제 출제 경향이 있으면 언급하세요
- 근거 자료에 없는 내용은 추측하지 마세요

{{fewShotBlock}}

--- 근거 자료 (총 {{sourceCount}}건) ---
{{contextText}}
{{historyText}}

--- 현재 질문 ---
{{question}}`,
      few_shot_examples: JSON.stringify([
        {
          input: '개인정보 처리 위탁 시 반드시 서면으로 해야 하나요?',
          output: '{"conclusion":"개인정보 보호법 제26조제1항에 따라 개인정보 처리 위탁 시 반드시 문서(서면)에 의하여야 합니다. 시험에서 자주 출제되는 포인트입니다.","evidenceChain":[{"sourceIndex":1,"sourceLabel":"제26조 업무위탁에 따른 개인정보의 처리 제한","quote":"위탁하는 업무의 내용과 개인정보 처리 업무를 위탁받아 처리하는 자를 문서에 의하여야 한다","reasoning":"위탁 계약은 반드시 서면(문서)으로 해야 하며, 구두 계약은 불가하다"}],"crossReferences":[],"caveats":"시험에서 \\"구두 합의로 가능하다\\"는 선지가 오답 함정으로 자주 출제됩니다."}'
        }
      ]),
      model_params: JSON.stringify({ temperature: 0.2, maxTokens: 3072 }),
    },

    // 4) RAG 답변 - 규정 카테고리
    {
      name: 'rag-answer',
      category: '규정',
      stage: 'main',
      description: 'RAG 답변 - 내부 규정/지침 전용',
      template: `당신은 조직 내부 규정 및 지침 해석 전문 AI 어시스턴트입니다. 아래 근거 자료(내부 규정)를 참고하여 사용자의 질문에 정확하게 답변해주세요.

## 답변 형식

반드시 아래 JSON 형식으로만 답변하세요.

\`\`\`json
{
  "conclusion": "질문에 대한 직접 답변 (해당 규정의 핵심을 1~3문장으로, 한국어)",
  "evidenceChain": [
    {
      "sourceIndex": 1,
      "sourceLabel": "출처 규정명",
      "quote": "해당 규정의 핵심 내용 인용",
      "reasoning": "이 규정이 질문에 대한 답변 근거인 이유"
    }
  ],
  "crossReferences": [
    {
      "from": "규정A",
      "to": "규정B",
      "relation": "준용|적용|예외|관련"
    }
  ],
  "caveats": "적용 범위 제한, 예외 사항, 상위 법령과의 관계 (없으면 빈 문자열)"
}
\`\`\`

## 규정 답변 규칙
- 규정의 적용 대상과 범위를 명확히 하세요
- 상위 법령(근거 법률)이 언급되면 함께 안내하세요
- 절차나 프로세스가 있으면 단계별로 설명하세요
- 담당 부서나 책임자가 명시되어 있으면 포함하세요
- 근거 자료에 없는 내용은 추측하지 마세요

{{fewShotBlock}}

--- 근거 자료 (총 {{sourceCount}}건) ---
{{contextText}}
{{historyText}}

--- 현재 질문 ---
{{question}}`,
      few_shot_examples: JSON.stringify([]),
      model_params: JSON.stringify({ temperature: 0.3, maxTokens: 3072 }),
    },

    // 5) 쿼리 리라이팅
    {
      name: 'query-rewrite',
      category: 'default',
      stage: 'query-analysis',
      description: '검색 쿼리 최적화 (사용자 질문 → 검색 쿼리 변환)',
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
      few_shot_examples: JSON.stringify([
        {
          input: 'CCTV를 어디에 설치할 수 있어?',
          output: '{"intent":"영상정보처리기기 설치 가능 장소 확인","queries":["영상정보처리기기 설치 장소 제한","CCTV 설치 허용 구역 개인정보보호법","영상정보처리기기 설치 운영 제한 제25조"],"keywords":["영상정보처리기기","설치","제25조","설치 제한"]}'
        }
      ]),
      model_params: JSON.stringify({ temperature: 0.1, maxTokens: 512 }),
    },

    // 6) HyDE 가상 문서 생성
    {
      name: 'hyde',
      category: 'default',
      stage: 'query-analysis',
      description: 'HyDE 가상 문서 생성 (검색 품질 향상용)',
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
      few_shot_examples: JSON.stringify([]),
      model_params: JSON.stringify({ temperature: 0.3, maxTokens: 512 }),
    },

    // 7) 답변 검증 프롬프트 (프롬프트 체인 - 검증 단계)
    {
      name: 'rag-verify',
      category: 'default',
      stage: 'verify',
      description: '답변 검증 (근거 정확성 + 논리 일관성 확인)',
      template: `당신은 법령 답변 검증 전문가입니다. 아래 답변이 근거 자료에 의해 정확히 뒷받침되는지 검증해주세요.

## 검증 항목
1. 결론(conclusion)이 근거 자료에 의해 뒷받침되는가?
2. 인용(quote)이 근거 자료 원문과 일치하는가?
3. 추론(reasoning)이 논리적으로 타당한가?
4. 근거 자료에 없는 내용을 답변에 포함했는가?
5. 누락된 중요 조문이나 단서 조항이 있는가?

## 출력 형식
\`\`\`json
{
  "isValid": true 또는 false,
  "confidence": 0.0~1.0,
  "issues": ["발견된 문제1", "발견된 문제2"],
  "suggestions": ["개선 제안1"],
  "missingReferences": ["누락된 참조1"]
}
\`\`\`

--- 원래 질문 ---
{{question}}

--- AI 답변 ---
{{answer}}

--- 근거 자료 ---
{{contextText}}`,
      few_shot_examples: JSON.stringify([]),
      model_params: JSON.stringify({ temperature: 0.1, maxTokens: 1024 }),
    },

    // 8) 쿼리 분석 프롬프트 (프롬프트 체인 - 분석 단계)
    {
      name: 'query-analysis',
      category: 'default',
      stage: 'query-analysis',
      description: '질문 유형 분석 + 카테고리 자동 감지',
      template: `사용자의 질문을 분석하여 검색 전략을 결정해주세요.

## 출력 형식
\`\`\`json
{
  "questionType": "factual|procedural|comparative|opinion",
  "suggestedCategory": "법령|규정|기출|일반",
  "keyEntities": ["핵심 엔티티1", "핵심 엔티티2"],
  "searchStrategy": "broad|focused|cross-reference",
  "needsMultiHop": true 또는 false
}
\`\`\`

- factual: 사실 확인 질문 ("~은 무엇인가?")
- procedural: 절차/방법 질문 ("~하려면 어떻게 해야 하나?")
- comparative: 비교 질문 ("~와 ~의 차이는?")
- opinion: 해석/판단 질문 ("~에 해당하나요?")

--- 질문 ---
{{question}}`,
      few_shot_examples: JSON.stringify([
        {
          input: '개인정보 보호법과 정보통신망법의 개인정보 수집 동의 요건 차이는?',
          output: '{"questionType":"comparative","suggestedCategory":"법령","keyEntities":["개인정보 보호법","정보통신망법","수집 동의"],"searchStrategy":"cross-reference","needsMultiHop":true}'
        }
      ]),
      model_params: JSON.stringify({ temperature: 0.1, maxTokens: 256 }),
    },
  ];

  // 배치 삽입
  for (const t of templates) {
    await query(
      `INSERT INTO prompt_templates (name, category, stage, template, few_shot_examples, model_params, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [t.name, t.category, t.stage, t.template,
       typeof t.few_shot_examples === 'string' ? t.few_shot_examples : JSON.stringify(t.few_shot_examples),
       typeof t.model_params === 'string' ? t.model_params : JSON.stringify(t.model_params),
       t.description]
    );
    console.log(`  ✓ ${t.name} (${t.category}) 삽입 완료`);
  }

  console.log(`[마이그레이션] 총 ${templates.length}개 기본 템플릿 삽입 완료`);
}

migrate()
  .then(() => { console.log('완료'); process.exit(0); })
  .catch(err => { console.error('실패:', err); process.exit(1); });
