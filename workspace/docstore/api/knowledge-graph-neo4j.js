// 지식 그래프 Neo4j API + PG/Neo4j 비교 API
//
// GET  /api/knowledge-graph-neo4j?docId=N          — Neo4j 그래프 조회
// GET  /api/knowledge-graph-neo4j?status=true      — Neo4j 연결 상태
// POST /api/knowledge-graph-neo4j { docId }        — Neo4j 트리플 구축
// POST /api/knowledge-graph-neo4j { docId, compare } — PG vs Neo4j 동시 구축 비교
// POST /api/knowledge-graph-neo4j { docId, path, from, to } — 최단 경로 탐색
// DELETE /api/knowledge-graph-neo4j { docId }      — Neo4j 트리플 삭제
const { query } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { sendError } = require('../lib/error-handler');
const { checkConnection, runCypher } = require('../lib/neo4j');
const {
  buildKnowledgeGraphNeo4j,
  getEntityGraphNeo4j,
  findShortestPath,
  findNeighbors,
} = require('../lib/knowledge-graph-neo4j');
const {
  buildKnowledgeGraph,
  getEntityGraph,
} = require('../lib/knowledge-graph');

module.exports = async (req, res) => {
  if (setCors(req, res, { methods: 'GET, POST, DELETE, OPTIONS' })) return;

  const { error: authError } = requireAuth(req);
  if (authError) return res.status(401).json({ error: authError });

  try {
    // GET
    if (req.method === 'GET') {
      const { docId, status, search } = req.query;

      // Neo4j 연결 상태 확인
      if (status === 'true') {
        const connStatus = await checkConnection();
        return res.json(connStatus);
      }

      // Neo4j 그래프 조회
      const graph = await getEntityGraphNeo4j({
        documentId: docId ? parseInt(docId, 10) : undefined,
        search: search || undefined,
      });
      return res.json(graph);
    }

    // POST
    if (req.method === 'POST') {
      const { docId, compare, path: pathMode, from, to, neighbors, hops } = req.body;
      if (!docId) return res.status(400).json({ error: 'docId가 필요합니다.' });
      const id = parseInt(docId, 10);

      // 최단 경로 탐색
      if (pathMode && from && to) {
        const result = await findShortestPath(from, to, id);
        return res.json(result);
      }

      // 이웃 탐색
      if (neighbors) {
        const result = await findNeighbors(neighbors, id, hops || 2);
        return res.json(result);
      }

      // PG vs Neo4j 비교 구축
      if (compare) {
        console.log(`[KG Compare] PG vs Neo4j 비교 구축 시작: 문서 ${id}`);

        // PG 구축 (타이밍)
        const pgStart = Date.now();
        const pgStats = await buildKnowledgeGraph(query, id);
        const pgTiming = Date.now() - pgStart;

        // Neo4j 구축 (타이밍)
        let neo4jStats, neo4jTiming, neo4jError;
        try {
          const neo4jStart = Date.now();
          neo4jStats = await buildKnowledgeGraphNeo4j(query, id);
          neo4jTiming = Date.now() - neo4jStart;
        } catch (err) {
          neo4jError = err.message;
          neo4jTiming = 0;
        }

        // PG 조회 타이밍
        const pgQueryStart = Date.now();
        const pgGraph = await getEntityGraph(query, { documentId: id });
        const pgQueryTiming = Date.now() - pgQueryStart;

        // Neo4j 조회 타이밍
        let neo4jGraph, neo4jQueryTiming;
        try {
          const neo4jQueryStart = Date.now();
          neo4jGraph = await getEntityGraphNeo4j({ documentId: id });
          neo4jQueryTiming = Date.now() - neo4jQueryStart;
        } catch (err) {
          neo4jGraph = { nodes: [], links: [], stats: {} };
          neo4jQueryTiming = 0;
        }

        return res.json({
          success: true,
          documentId: id,
          comparison: {
            pg: {
              build: { ...pgStats, timing: pgTiming },
              query: { ...pgGraph.stats, timing: pgQueryTiming },
              graph: pgGraph,
            },
            neo4j: {
              build: neo4jError
                ? { error: neo4jError, timing: 0 }
                : { ...neo4jStats, timing: neo4jTiming },
              query: { ...neo4jGraph.stats, timing: neo4jQueryTiming },
              graph: neo4jGraph,
            },
          },
        });
      }

      // Neo4j 단독 구축
      console.log(`[KG Neo4j] 트리플 구축 시작: 문서 ${id}`);
      const stats = await buildKnowledgeGraphNeo4j(query, id);
      console.log(`[KG Neo4j] 완료: 엔티티 ${stats.entities.total}개, 트리플 ${stats.triples.total}개 (${stats.timing}ms)`);

      return res.json({ success: true, documentId: id, stats });
    }

    // DELETE
    if (req.method === 'DELETE') {
      const { docId } = req.body;
      if (!docId) return res.status(400).json({ error: 'docId가 필요합니다.' });

      const id = parseInt(docId, 10);
      await runCypher(
        'MATCH (e:Entity {documentId: $docId}) DETACH DELETE e',
        { docId: id }
      );
      console.log(`[KG Neo4j] 문서 ${id} 트리플 삭제 완료`);
      return res.json({ success: true, documentId: id });
    }

    return res.status(405).json({ error: 'GET, POST 또는 DELETE만 허용' });
  } catch (err) {
    sendError(res, err, '[KG Neo4j]');
  }
};
