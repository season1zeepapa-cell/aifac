// 문서 AI 분석 모듈 — 요약, 키워드, 태그 자동 생성 (Gemini)
//
// 업로드/임포트 파이프라인에서 호출:
//   const { analyzeDocument, analyzeSections } = require('../lib/doc-analyzer');
//   const analysis = await analyzeDocument(sectionsText, title, category);
//   const sectionSummaries = await analyzeSections(sections);
const { callLLM } = require('./gemini');

/**
 * 문서 전체 분석 — 요약, 키워드, 태그 추천
 * @param {string} text - 문서 전체 텍스트 (섹션들 합친 것)
 * @param {string} title - 문서 제목
 * @param {string} category - 현재 카테고리
 * @returns {Promise<{summary: string, keywords: string[], tags: string[]}>}
 */
async function analyzeDocument(text, title, category) {
  // 텍스트가 너무 짧으면 분석 스킵
  if (!text || text.trim().length < 50) {
    return { summary: '', keywords: [], tags: [] };
  }

  // 입력 텍스트를 4000자로 제한 (비용 절감)
  const truncated = text.substring(0, 4000);

  const prompt = `다음 문서를 분석하여 JSON으로 반환해주세요.

규칙:
- summary: 문서 전체를 1~3줄로 요약 (한국어)
- keywords: 핵심 키워드 5~10개 (배열, 한국어)
- tags: 분류/검색에 유용한 태그 3~7개 (배열, 한국어)
  태그는 주제, 분야, 관련 법령, 대상 등을 포함

JSON만 반환하세요. 다른 텍스트는 포함하지 마세요:
{"summary":"...","keywords":["..."],"tags":["..."]}

--- 문서 정보 ---
제목: ${title}
카테고리: ${category || '미분류'}

--- 문서 내용 ---
${truncated}`;

  try {
    const raw = await callLLM(prompt, { provider: 'gemini', _endpoint: 'doc-analyzer', maxTokens: 2048, timeout: 60000 });
    // JSON 파싱 (마크다운 코드블록 제거)
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const result = JSON.parse(cleaned);
    return {
      summary: result.summary || '',
      keywords: Array.isArray(result.keywords) ? result.keywords.slice(0, 10) : [],
      tags: Array.isArray(result.tags) ? result.tags.slice(0, 7) : [],
    };
  } catch (err) {
    console.error('[DocAnalyzer] 문서 분석 실패:', err.message);
    return { summary: '', keywords: [], tags: [] };
  }
}

/**
 * 섹션별 1줄 요약 생성 (배치)
 * @param {Array<{id: number, raw_text: string, metadata: object}>} sections
 * @returns {Promise<Map<number, string>>} sectionId → summary
 */
async function analyzeSections(sections) {
  const summaries = new Map();
  if (!sections || sections.length === 0) return summaries;

  // 섹션들을 20개씩 묶어 배치 생성
  const BATCH_SIZE = 20;
  const batches = [];

  for (let i = 0; i < sections.length; i += BATCH_SIZE) {
    const batch = sections.slice(i, i + BATCH_SIZE);
    const validBatch = batch.filter(s => s.raw_text && s.raw_text.trim().length >= 30);
    if (validBatch.length > 0) batches.push(validBatch);
  }

  // 2개 배치씩 병렬 처리 (Gemini rate limit 고려)
  const PARALLEL = 2;
  for (let bi = 0; bi < batches.length; bi += PARALLEL) {
    const parallelBatches = batches.slice(bi, bi + PARALLEL);

    const results = await Promise.all(parallelBatches.map(async (validBatch) => {
      const sectionList = validBatch.map((s, idx) => {
        const meta = s.metadata || {};
        const label = meta.label || `섹션 ${s.id}`;
        const text = s.raw_text.substring(0, 500);
        return `[${idx}] ${label}\n${text}`;
      }).join('\n---\n');

      const prompt = `다음 문서 섹션들 각각을 1줄로 요약해주세요.

규칙:
- 각 섹션을 핵심만 1줄(30~80자)로 요약
- JSON 배열로 반환: [{"index":0,"summary":"..."},{"index":1,"summary":"..."}]
- 다른 텍스트 없이 JSON만 반환

--- 섹션 목록 ---
${sectionList}`;

      try {
        const raw = await callLLM(prompt, { provider: 'gemini', _endpoint: 'doc-analyzer', maxTokens: 4096, timeout: 60000 });
        const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(cleaned);
        return { validBatch, parsed };
      } catch (err) {
        console.error(`[DocAnalyzer] 섹션 배치 요약 실패:`, err.message);
        return { validBatch, parsed: [] };
      }
    }));

    for (const { validBatch, parsed } of results) {
      if (Array.isArray(parsed)) {
        for (const r of parsed) {
          if (r.index !== undefined && r.summary && validBatch[r.index]) {
            summaries.set(validBatch[r.index].id, r.summary);
          }
        }
      }
    }
  }

  return summaries;
}

module.exports = { analyzeDocument, analyzeSections };
