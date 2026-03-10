// 교차 참조 매트릭스 API
// GET  /api/cross-references?docId=N          — 문서의 교차 참조 조회
// POST /api/cross-references { docId, type }  — 교차 참조 구축 트리거
// GET  /api/cross-references?matrix=true      — 전체 교차 참조 매트릭스 조회
const { query } = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { sendError } = require('../lib/error-handler');
const {
  buildExplicitCrossRefs,
  buildSemanticCrossRefs,
  getCrossReferences,
} = require('../lib/cross-reference');

module.exports = async (req, res) => {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return;

  const { error: authError } = requireAdmin(req);
  if (authError) return res.status(401).json({ error: authError });

  try {
    // GET: 교차 참조 조회
    if (req.method === 'GET') {
      const { docId, matrix } = req.query;

      // 전체 매트릭스: 문서 간 교차 참조 요약
      if (matrix === 'true') {
        const result = await query(
          `SELECT
             cr.source_document_id, cr.target_document_id,
             sd.title AS source_title, td.title AS target_title,
             cr.relation_type, COUNT(*) AS ref_count,
             AVG(cr.confidence) AS avg_confidence
           FROM cross_references cr
           JOIN documents sd ON cr.source_document_id = sd.id
           JOIN documents td ON cr.target_document_id = td.id
           WHERE sd.deleted_at IS NULL AND td.deleted_at IS NULL
           GROUP BY cr.source_document_id, cr.target_document_id,
                    sd.title, td.title, cr.relation_type
           ORDER BY ref_count DESC`
        );
        return res.json({ matrix: result.rows });
      }

      // 특정 문서의 교차 참조
      if (!docId) return res.status(400).json({ error: 'docId가 필요합니다.' });
      const refs = await getCrossReferences(query, parseInt(docId, 10));

      // 요약 통계
      const stats = {
        total: refs.length,
        explicit: refs.filter(r => r.relation_type !== 'semantic').length,
        semantic: refs.filter(r => r.relation_type === 'semantic').length,
        relatedDocs: [...new Set(refs.map(r =>
          r.source_document_id === parseInt(docId, 10)
            ? r.target_doc_title
            : r.source_doc_title
        ))],
      };

      return res.json({ references: refs, stats });
    }

    // POST: 교차 참조 구축
    if (req.method === 'POST') {
      const { docId, type = 'all', threshold } = req.body;
      if (!docId) return res.status(400).json({ error: 'docId가 필요합니다.' });

      const id = parseInt(docId, 10);
      const results = {};

      if (type === 'explicit' || type === 'all') {
        console.log(`[CrossRef] 명시적 교차 참조 구축 시작: 문서 ${id}`);
        results.explicit = await buildExplicitCrossRefs(query, id);
        console.log(`[CrossRef] 명시적: ${results.explicit.found}건 감지, ${results.explicit.saved}건 저장`);
      }

      if (type === 'semantic' || type === 'all') {
        console.log(`[CrossRef] 시맨틱 교차 참조 구축 시작: 문서 ${id}`);
        results.semantic = await buildSemanticCrossRefs(query, id, {
          threshold: threshold || 0.85,
        });
        console.log(`[CrossRef] 시맨틱: ${results.semantic.found}건 감지, ${results.semantic.saved}건 저장`);
      }

      return res.json({ success: true, documentId: id, results });
    }

    return res.status(405).json({ error: 'GET 또는 POST만 허용' });
  } catch (err) {
    sendError(res, err, '[CrossRef]');
  }
};
