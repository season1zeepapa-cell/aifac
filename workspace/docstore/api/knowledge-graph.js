// 지식 그래프 트리플스토어 API
// GET  /api/knowledge-graph?docId=N         — 문서별 트리플 그래프
// GET  /api/knowledge-graph?entityId=N      — 엔티티 중심 그래프
// GET  /api/knowledge-graph?search=keyword  — 엔티티 검색
// POST /api/knowledge-graph { docId }       — 트리플 구축 트리거
// DELETE /api/knowledge-graph { docId }     — 문서 트리플 삭제
const { query } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { sendError } = require('../lib/error-handler');
const {
  buildKnowledgeGraph,
  getEntityGraph,
} = require('../lib/knowledge-graph');

module.exports = async (req, res) => {
  if (setCors(req, res, { methods: 'GET, POST, DELETE, OPTIONS' })) return;

  const { error: authError } = requireAuth(req);
  if (authError) return res.status(401).json({ error: authError });

  try {
    // GET: 지식 그래프 조회
    if (req.method === 'GET') {
      const { docId, entityId, search } = req.query;

      const graph = await getEntityGraph(query, {
        documentId: docId ? parseInt(docId, 10) : undefined,
        entityId: entityId ? parseInt(entityId, 10) : undefined,
        search: search || undefined,
      });

      return res.json(graph);
    }

    // POST: 지식 그래프 구축
    if (req.method === 'POST') {
      const { docId, useLLM, llmModel } = req.body;
      if (!docId) return res.status(400).json({ error: 'docId가 필요합니다.' });

      const id = parseInt(docId, 10);
      const mode = useLLM ? 'Hybrid(정규식+LLM)' : '정규식';
      console.log(`[KnowledgeGraph] 트리플 구축 시작: 문서 ${id} (${mode})`);

      const stats = await buildKnowledgeGraph(query, id, { useLLM: !!useLLM, llmModel });
      console.log(`[KnowledgeGraph] 완료: 엔티티 ${stats.entities.total}개 (정규식: ${stats.entities.bySource?.regex || 0}, LLM: ${stats.entities.bySource?.llm || 0}), 트리플 ${stats.triples.total}개`);

      return res.json({ success: true, documentId: id, stats });
    }

    // DELETE: 문서 트리플 삭제
    if (req.method === 'DELETE') {
      const { docId } = req.body;
      if (!docId) return res.status(400).json({ error: 'docId가 필요합니다.' });

      const id = parseInt(docId, 10);
      await query('DELETE FROM knowledge_triples WHERE source_document_id = $1', [id]);
      await query('DELETE FROM entities WHERE document_id = $1', [id]);

      console.log(`[KnowledgeGraph] 문서 ${id} 트리플 삭제 완료`);
      return res.json({ success: true, documentId: id });
    }

    return res.status(405).json({ error: 'GET, POST 또는 DELETE만 허용' });
  } catch (err) {
    sendError(res, err, '[KnowledgeGraph]');
  }
};
