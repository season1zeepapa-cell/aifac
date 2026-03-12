// 청크 분할 미리보기 API
// POST /api/split-preview
// Body: { text, strategy, chunkSize, overlap }
// → 분할 결과 미리보기 (첫 3개 청크 + 통계)
const { smartChunk, STRATEGIES } = require('../lib/text-splitters');
const { requireAuth } = require('../lib/auth');
const { setCors } = require('../lib/cors');

module.exports = async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  }

  const { error: authError } = requireAuth(req);
  if (authError) return res.status(401).json({ error: authError });

  try {
    const { text, strategy = 'sentence', chunkSize = 500, overlap = 100 } = req.body;

    if (!text || text.trim().length === 0) {
      return res.json({ totalChunks: 0, preview: [], distribution: null });
    }

    // 미리보기용으로 텍스트 길이 제한 (최대 5000자)
    const previewText = text.slice(0, 5000);

    // 분할 실행
    const chunks = await smartChunk(previewText, strategy, {
      chunkSize: parseInt(chunkSize) || 500,
      overlap: parseInt(overlap) || 100,
    });

    // 통계 계산
    const lengths = chunks.map(c => c.length);
    const distribution = lengths.length > 0 ? {
      min: Math.min(...lengths),
      max: Math.max(...lengths),
      avg: Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length),
    } : null;

    res.json({
      totalChunks: chunks.length,
      preview: chunks.slice(0, 3).map((c, i) => ({
        index: i,
        text: c.slice(0, 200) + (c.length > 200 ? '...' : ''),
        length: c.length,
      })),
      distribution,
      strategies: STRATEGIES,
    });
  } catch (err) {
    console.error('[SplitPreview] 에러:', err.message);
    res.status(500).json({ error: err.message });
  }
};
