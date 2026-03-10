// 조문/섹션별 AI 요약 생성 API
// POST /api/summary
// { sectionId: 123 }        → 단일 섹션 요약
// { documentId: 5 }         → 문서 전체 섹션 일괄 요약
//
// 요약 결과는 document_sections.metadata.summary에 캐싱
const { query } = require('./db');
const { requireAdmin } = require('./auth');
const https = require('https');

// Gemini API 호출
function callGemini(prompt, apiKey) {
  return new Promise((resolve, reject) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 256 },
    });

    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
          resolve(text.trim());
        } catch {
          reject(new Error('Gemini 응답 파싱 실패'));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// 섹션 1개 요약 생성
async function summarizeSection(section, apiKey) {
  const text = section.raw_text || '';
  if (text.trim().length < 20) return '(내용이 짧아 요약 불필요)';

  const meta = section.metadata || {};
  const label = meta.label || '';

  const prompt = `다음 법령 조문(또는 문서 섹션)을 핵심만 1-2줄로 요약해주세요. 추가 설명 없이 요약만 반환하세요.

${label ? `[조문] ${label}\n` : ''}${text.substring(0, 2000)}`;

  return callGemini(prompt, apiKey);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  // 인증 체크
  const { error: authError } = requireAdmin(req);
  if (authError) return res.status(401).json({ error: authError });

  const { sectionId, documentId } = req.body;
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' });

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
        return res.json({ sectionId, summary: meta.summary, cached: true });
      }

      // 요약 생성
      const summary = await summarizeSection(section, apiKey);

      // metadata에 캐싱
      meta.summary = summary;
      await query(
        'UPDATE document_sections SET metadata = $1 WHERE id = $2',
        [JSON.stringify(meta), sectionId]
      );

      return res.json({ sectionId, summary, cached: false });
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
          const summary = await summarizeSection(section, apiKey);
          meta.summary = summary;
          await query(
            'UPDATE document_sections SET metadata = $1 WHERE id = $2',
            [JSON.stringify(meta), section.id]
          );
          generated++;
        } catch (err) {
          console.error(`[Summary] 섹션 ${section.id} 요약 실패:`, err.message);
          // 실패해도 계속 진행
        }
      }

      console.log(`[Summary] 문서 ${documentId}: ${generated}개 생성, ${skipped}개 캐시`);
      return res.json({
        documentId,
        total: sections.rows.length,
        generated,
        skipped,
      });
    }

    return res.status(400).json({ error: 'sectionId 또는 documentId가 필요합니다.' });
  } catch (err) {
    console.error('[Summary] 에러:', err);
    res.status(500).json({ error: err.message });
  }
};
