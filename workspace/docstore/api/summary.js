// 조문/섹션별 AI 요약 생성 API
// POST /api/summary
// { sectionId: 123, provider: "gemini" }  → 단일 섹션 요약
// { documentId: 5, provider: "openai" }   → 문서 전체 섹션 일괄 요약
//
// 요약 결과는 document_sections.metadata.summary에 캐싱
const { query } = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { checkRateLimit } = require('../lib/rate-limit');
const { callLLM } = require('../lib/gemini');
const { sendError } = require('../lib/error-handler');

// 섹션 1개 요약 생성
async function summarizeSection(section, options = {}) {
  const text = section.raw_text || '';
  if (text.trim().length < 20) return '(내용이 짧아 요약 불필요)';

  const meta = section.metadata || {};
  const label = meta.label || '';

  const prompt = `다음 법령 조문(또는 문서 섹션)을 핵심만 1-2줄로 요약해주세요. 추가 설명 없이 요약만 반환하세요.

${label ? `[조문] ${label}\n` : ''}${text.substring(0, 2000)}`;

  return callLLM(prompt, { ...options, maxTokens: 256, timeout: 15000 });
}

module.exports = async (req, res) => {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  // 인증 체크
  const { error: authError } = requireAdmin(req);
  if (authError) return res.status(401).json({ error: authError });

  if (checkRateLimit(req, res, 'summary')) return;

  const { sectionId, documentId, provider = 'gemini' } = req.body;
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

      // 이미 요약이 있으면 캐시 반환
      if (meta.summary) {
        return res.json({ sectionId, summary: meta.summary, cached: true, provider });
      }

      // 요약 생성
      const summary = await summarizeSection(section, llmOptions);

      // metadata에 캐싱
      meta.summary = summary;
      await query(
        'UPDATE document_sections SET metadata = $1 WHERE id = $2',
        [JSON.stringify(meta), sectionId]
      );

      return res.json({ sectionId, summary, cached: false, provider });
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
        if (meta.summary) {
          skipped++;
          continue;
        }

        try {
          const summary = await summarizeSection(section, llmOptions);
          meta.summary = summary;
          await query(
            'UPDATE document_sections SET metadata = $1 WHERE id = $2',
            [JSON.stringify(meta), section.id]
          );
          generated++;
        } catch (err) {
          console.error(`[Summary] 섹션 ${section.id} 요약 실패 (${provider}):`, err.message);
        }
      }

      console.log(`[Summary] 문서 ${documentId} (${provider}): ${generated}개 생성, ${skipped}개 캐시`);
      return res.json({
        documentId,
        total: sections.rows.length,
        generated,
        skipped,
        provider,
      });
    }

    return res.status(400).json({ error: 'sectionId 또는 documentId가 필요합니다.' });
  } catch (err) {
    sendError(res, err, '[Summary]');
  }
};
