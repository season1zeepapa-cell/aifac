// 텍스트 검색 + 벡터 유사도 검색 API
// GET /api/search?q=검색어&type=text|vector&limit=10
const { query } = require('./db');
const { generateEmbedding } = require('../lib/embeddings');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  }

  const q = req.query.q;
  const type = req.query.type || 'text';
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);

  if (!q || q.trim().length === 0) {
    return res.status(400).json({ error: '검색어(q)가 필요합니다.' });
  }

  try {
    if (type === 'vector') {
      // ── 벡터 유사도 검색 ──────────────────────────
      // 검색어를 임베딩으로 변환
      const embedding = await generateEmbedding(q.trim());
      const vecStr = `[${embedding.join(',')}]`;

      // pgvector cosine 유사도 검색 (<=> 연산자)
      const result = await query(
        `SELECT
           dc.id AS chunk_id,
           dc.chunk_text,
           dc.chunk_index,
           dc.section_id,
           ds.section_type,
           ds.section_index,
           ds.document_id,
           d.title AS document_title,
           d.category,
           1 - (dc.embedding <=> $1::vector) AS similarity
         FROM document_chunks dc
         JOIN document_sections ds ON dc.section_id = ds.id
         JOIN documents d ON ds.document_id = d.id
         WHERE dc.embedding IS NOT NULL
         ORDER BY dc.embedding <=> $1::vector
         LIMIT $2`,
        [vecStr, limit]
      );

      res.json({
        type: 'vector',
        query: q,
        count: result.rows.length,
        results: result.rows.map(row => ({
          chunkId: row.chunk_id,
          chunkText: row.chunk_text,
          chunkIndex: row.chunk_index,
          similarity: parseFloat(row.similarity).toFixed(4),
          sectionId: row.section_id,
          sectionType: row.section_type,
          sectionIndex: row.section_index,
          documentId: row.document_id,
          documentTitle: row.document_title,
          category: row.category,
        })),
      });
    } else {
      // ── 텍스트 ILIKE 검색 ─────────────────────────
      const result = await query(
        `SELECT
           ds.id AS section_id,
           ds.section_type,
           ds.section_index,
           ds.raw_text,
           ds.document_id,
           d.title AS document_title,
           d.category
         FROM document_sections ds
         JOIN documents d ON ds.document_id = d.id
         WHERE ds.raw_text ILIKE $1
         ORDER BY ds.document_id, ds.section_index
         LIMIT $2`,
        [`%${q.trim()}%`, limit]
      );

      res.json({
        type: 'text',
        query: q,
        count: result.rows.length,
        results: result.rows.map(row => ({
          sectionId: row.section_id,
          sectionType: row.section_type,
          sectionIndex: row.section_index,
          rawText: row.raw_text,
          documentId: row.document_id,
          documentTitle: row.document_title,
          category: row.category,
        })),
      });
    }
  } catch (err) {
    console.error('Search API 에러:', err);
    res.status(500).json({ error: err.message });
  }
};
