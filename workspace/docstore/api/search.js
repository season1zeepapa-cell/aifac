// 텍스트 검색 + 벡터 유사도 검색 API
// GET /api/search?q=검색어&type=text|vector&limit=10&chapter=제1장&docId=5
const { query } = require('../lib/db');
const { generateEmbedding } = require('../lib/embeddings');
const { requireAdmin } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { checkRateLimit } = require('../lib/rate-limit');

module.exports = async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  }

  // 인증 체크
  const { error: authError } = requireAdmin(req);
  if (authError) return res.status(401).json({ error: authError });

  if (checkRateLimit(req, res, 'search')) return;

  const q = req.query.q;
  const type = req.query.type || 'text';
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  // 필터 옵션
  const chapter = req.query.chapter || '';  // 장 필터 (예: "제1장")
  const docId = req.query.docId || '';      // 특정 문서만 검색
  const tag = req.query.tag || '';          // 태그 필터

  if (!q || q.trim().length === 0) {
    return res.status(400).json({ error: '검색어(q)가 필요합니다.' });
  }

  try {
    if (type === 'vector') {
      // ── 벡터 유사도 검색 ──
      const embedding = await generateEmbedding(q.trim());
      const vecStr = `[${embedding.join(',')}]`;

      // 필터 조건 동적 생성
      let filterClauses = ['dc.embedding IS NOT NULL'];
      let params = [vecStr];
      let paramIdx = 2;

      if (docId) {
        filterClauses.push(`ds.document_id = $${paramIdx}`);
        params.push(parseInt(docId));
        paramIdx++;
      }
      if (chapter) {
        filterClauses.push(`ds.metadata->>'chapter' ILIKE $${paramIdx}`);
        params.push(`%${chapter}%`);
        paramIdx++;
      }
      if (tag) {
        filterClauses.push(`EXISTS (
          SELECT 1 FROM document_tags dt
          JOIN tags t ON t.id = dt.tag_id
          WHERE dt.document_id = ds.document_id AND t.name = $${paramIdx}
        )`);
        params.push(tag);
        paramIdx++;
      }
      params.push(limit);

      const result = await query(
        `SELECT
           dc.id AS chunk_id,
           dc.chunk_text,
           dc.enriched_text,
           dc.chunk_index,
           dc.section_id,
           ds.section_type,
           ds.section_index,
           ds.summary AS section_summary,
           ds.metadata AS section_metadata,
           ds.document_id,
           d.title AS document_title,
           d.category,
           d.summary AS document_summary,
           1 - (dc.embedding <=> $1::vector) AS similarity
         FROM document_chunks dc
         JOIN document_sections ds ON dc.section_id = ds.id
         JOIN documents d ON ds.document_id = d.id
         WHERE ${filterClauses.join(' AND ')}
         ORDER BY dc.embedding <=> $1::vector
         LIMIT $${paramIdx}`,
        params
      );

      res.json({
        type: 'vector',
        query: q,
        count: result.rows.length,
        results: result.rows.map(row => {
          const meta = row.section_metadata || {};
          return {
            chunkId: row.chunk_id,
            chunkText: row.chunk_text,
            chunkIndex: row.chunk_index,
            similarity: parseFloat(row.similarity).toFixed(4),
            sectionId: row.section_id,
            sectionType: row.section_type,
            sectionIndex: row.section_index,
            sectionSummary: row.section_summary || '',
            documentId: row.document_id,
            documentTitle: row.document_title,
            documentSummary: row.document_summary || '',
            category: row.category,
            // 계층 라벨 정보
            label: meta.label || '',
            chapter: meta.chapter || '',
            section: meta.section || '',
            articleTitle: meta.articleTitle || '',
          };
        }),
      });
    } else {
      // ── 텍스트 ILIKE 검색 ──
      let filterClauses = ['ds.raw_text ILIKE $1'];
      let params = [`%${q.trim()}%`];
      let paramIdx = 2;

      if (docId) {
        filterClauses.push(`ds.document_id = $${paramIdx}`);
        params.push(parseInt(docId));
        paramIdx++;
      }
      if (chapter) {
        filterClauses.push(`ds.metadata->>'chapter' ILIKE $${paramIdx}`);
        params.push(`%${chapter}%`);
        paramIdx++;
      }
      if (tag) {
        filterClauses.push(`EXISTS (
          SELECT 1 FROM document_tags dt
          JOIN tags t ON t.id = dt.tag_id
          WHERE dt.document_id = ds.document_id AND t.name = $${paramIdx}
        )`);
        params.push(tag);
        paramIdx++;
      }
      params.push(limit);

      const result = await query(
        `SELECT
           ds.id AS section_id,
           ds.section_type,
           ds.section_index,
           ds.raw_text,
           ds.summary AS section_summary,
           ds.metadata AS section_metadata,
           ds.document_id,
           d.title AS document_title,
           d.category,
           d.summary AS document_summary
         FROM document_sections ds
         JOIN documents d ON ds.document_id = d.id
         WHERE ${filterClauses.join(' AND ')}
         ORDER BY ds.document_id, ds.section_index
         LIMIT $${paramIdx}`,
        params
      );

      res.json({
        type: 'text',
        query: q,
        count: result.rows.length,
        results: result.rows.map(row => {
          const meta = row.section_metadata || {};
          return {
            sectionId: row.section_id,
            sectionType: row.section_type,
            sectionIndex: row.section_index,
            rawText: row.raw_text,
            sectionSummary: row.section_summary || '',
            documentId: row.document_id,
            documentTitle: row.document_title,
            documentSummary: row.document_summary || '',
            category: row.category,
            label: meta.label || '',
            chapter: meta.chapter || '',
            section: meta.section || '',
            articleTitle: meta.articleTitle || '',
          };
        }),
      });
    }
  } catch (err) {
    console.error('Search API 에러:', err);
    res.status(500).json({ error: err.message });
  }
};
