// 조문/섹션별 AI 요약 생성 API
// POST /api/summary
// { sectionId: 123, provider: "gemini" }           → 단일 섹션 요약 (기본)
// { sectionId: 123, useCoD: true, provider: "gemini" } → CoD 고밀도 요약
// { documentId: 5, provider: "openai" }             → 문서 전체 섹션 일괄 요약
// { documentId: 5, useCoD: true }                   → 문서 전체 CoD 일괄 요약
//
// useCoD=true 시 Chain of Density 전략으로 5회 반복 요약 (정보 밀도 ↑)
// 요약 결과는 document_sections.metadata.summary에 캐싱
// CoD 결과는 metadata.codSteps에 각 단계별 과정도 저장
const { query } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { checkRateLimit } = require('../lib/rate-limit');
const { callLLM } = require('../lib/gemini');
const { sendError } = require('../lib/error-handler');
const { chainOfDensitySummarize } = require('../lib/chain-of-density');

// 섹션 1개 요약 생성 (기본 모드)
async function summarizeSection(section, options = {}) {
  const text = section.raw_text || '';
  if (text.trim().length < 20) return '(내용이 짧아 요약 불필요)';

  const meta = section.metadata || {};
  const label = meta.label || '';

  const prompt = `다음 법령 조문(또는 문서 섹션)을 핵심만 1-2줄로 요약해주세요. 추가 설명 없이 요약만 반환하세요.

${label ? `[조문] ${label}\n` : ''}${text.substring(0, 2000)}`;

  return callLLM(prompt, { ...options, maxTokens: 256, timeout: 15000, _endpoint: 'summary' });
}

// 섹션 1개 CoD 요약 생성 (5회 반복 고밀도)
async function summarizeSectionCoD(section, options = {}) {
  const text = section.raw_text || '';
  if (text.trim().length < 50) return { finalSummary: '(내용이 짧아 CoD 불필요)', steps: [] };

  const meta = section.metadata || {};
  const label = meta.label || '';

  return chainOfDensitySummarize(text, {
    provider: options.provider || 'gemini',
    model: options.model,
    label,
    length: options.codLength || 'medium',
    iterations: options.codIterations || 5,
    trackEntities: options.codTrackEntities !== false,
    onStep: options.onStep,
  });
}

module.exports = async (req, res) => {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  // 인증 체크
  const { error: authError } = requireAuth(req);
  if (authError) return res.status(401).json({ error: authError });

  if (await checkRateLimit(req, res, 'summary')) return;

  const {
    sectionId, documentId, provider = 'gemini',
    useCoD = false, codLength = 'medium', codIterations = 5,
    forceRegenerate = false,
  } = req.body;
  const llmOptions = { provider };

  try {
    // ── 단일 섹션 요약 ──
    if (sectionId) {
      const result = await query(
        'SELECT id, raw_text, metadata FROM document_sections WHERE id = $1',
        [sectionId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: '섹션을 찾을 수 없습니다.' });
      }

      const section = result.rows[0];
      const meta = section.metadata || {};

      // 캐시 확인 (forceRegenerate=true면 무시)
      const cacheKey = useCoD ? 'codSummary' : 'summary';
      if (!forceRegenerate && meta[cacheKey]) {
        return res.json({
          sectionId,
          summary: meta[cacheKey],
          cached: true,
          provider,
          mode: useCoD ? 'cod' : 'basic',
          ...(useCoD && meta.codSteps ? { codSteps: meta.codSteps } : {}),
        });
      }

      if (useCoD) {
        // ── CoD 고밀도 요약 ──
        const codResult = await summarizeSectionCoD(section, {
          provider, codLength, codIterations,
        });

        meta.codSummary = codResult.finalSummary;
        meta.summary = codResult.finalSummary; // 기본 요약도 업데이트
        meta.codSteps = codResult.steps;
        meta.codProvider = provider;
        meta.codIterations = codResult.iterations;

        await query(
          'UPDATE document_sections SET metadata = $1 WHERE id = $2',
          [JSON.stringify(meta), sectionId]
        );

        return res.json({
          sectionId,
          summary: codResult.finalSummary,
          cached: false,
          provider,
          mode: 'cod',
          codSteps: codResult.steps,
          iterations: codResult.iterations,
        });
      } else {
        // ── 기본 요약 ──
        const summary = await summarizeSection(section, llmOptions);

        meta.summary = summary;
        await query(
          'UPDATE document_sections SET metadata = $1 WHERE id = $2',
          [JSON.stringify(meta), sectionId]
        );

        return res.json({ sectionId, summary, cached: false, provider, mode: 'basic' });
      }
    }

    // ── 문서 전체 일괄 요약 ──
    if (documentId) {
      const sections = await query(
        'SELECT id, raw_text, metadata FROM document_sections WHERE document_id = $1 ORDER BY section_index',
        [documentId]
      );

      if (sections.rows.length === 0) {
        return res.status(404).json({ error: '문서 섹션을 찾을 수 없습니다.' });
      }

      let generated = 0;
      let skipped = 0;

      for (const section of sections.rows) {
        const meta = section.metadata || {};
        const cacheKey = useCoD ? 'codSummary' : 'summary';
        if (!forceRegenerate && meta[cacheKey]) {
          skipped++;
          continue;
        }

        try {
          if (useCoD) {
            const codResult = await summarizeSectionCoD(section, {
              provider, codLength, codIterations,
            });
            meta.codSummary = codResult.finalSummary;
            meta.summary = codResult.finalSummary;
            meta.codSteps = codResult.steps;
          } else {
            const summary = await summarizeSection(section, llmOptions);
            meta.summary = summary;
          }

          await query(
            'UPDATE document_sections SET metadata = $1 WHERE id = $2',
            [JSON.stringify(meta), section.id]
          );
          generated++;
        } catch (err) {
          console.error(`[Summary] 섹션 ${section.id} ${useCoD ? 'CoD ' : ''}요약 실패 (${provider}):`, err.message);
        }
      }

      const mode = useCoD ? 'cod' : 'basic';
      console.log(`[Summary] 문서 ${documentId} (${provider}, ${mode}): ${generated}개 생성, ${skipped}개 캐시`);
      return res.json({
        documentId,
        total: sections.rows.length,
        generated,
        skipped,
        provider,
        mode,
      });
    }

    return res.status(400).json({ error: 'sectionId 또는 documentId가 필요합니다.' });
  } catch (err) {
    sendError(res, err, '[Summary]');
  }
};
