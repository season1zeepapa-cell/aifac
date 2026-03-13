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
const { buildKnowledgeGraph, getEntityGraph } = require('../lib/knowledge-graph');

// Neo4j 모듈은 neo4j-driver 설치 실패 시 graceful 처리
let neo4jMod, kgNeo4jMod, neo4jLoadError;
try {
  neo4jMod = require('../lib/neo4j');
  kgNeo4jMod = require('../lib/knowledge-graph-neo4j');
} catch (e) {
  console.warn('[KG Neo4j] neo4j 모듈 로드 실패:', e.message);
  neo4jLoadError = e.message;
  neo4jMod = null;
  kgNeo4jMod = null;
}

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
        if (!neo4jMod) {
          return res.json({ connected: false, message: `Neo4j 모듈 로드 실패: ${neo4jLoadError || '알 수 없음'}` });
        }
        const connStatus = await neo4jMod.checkConnection();
        return res.json(connStatus);
      }

      // Neo4j 그래프 조회
      if (!kgNeo4jMod) return res.json({ nodes: [], links: [], stats: {}, error: 'Neo4j 미설정' });
      const graph = await kgNeo4jMod.getEntityGraphNeo4j({
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
        if (!kgNeo4jMod) return res.json({ found: false, error: 'Neo4j 미설정' });
        const result = await kgNeo4jMod.findShortestPath(from, to, id);
        return res.json(result);
      }

      // 이웃 탐색
      if (neighbors) {
        if (!kgNeo4jMod) return res.json({ nodes: [], error: 'Neo4j 미설정' });
        const result = await kgNeo4jMod.findNeighbors(neighbors, id, hops || 2);
        return res.json(result);
      }

      // PG vs Neo4j 비교 구축
      if (compare) {
        console.log(`[KG Compare] PG vs Neo4j 비교 구축 시작: 문서 ${id}`);

        // PG 구축 (타이밍)
        const pgStart = Date.now();
        const pgStats = await buildKnowledgeGraph(query, id);
        const pgTiming = Date.now() - pgStart;

        // Neo4j 구축 (타이밍) — 60초 타임아웃
        let neo4jStats, neo4jTiming, neo4jError;
        try {
          if (!kgNeo4jMod) throw new Error('Neo4j 모듈 미설정');
          const neo4jStart = Date.now();
          neo4jStats = await Promise.race([
            kgNeo4jMod.buildKnowledgeGraphNeo4j(query, id),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Neo4j 구축 타임아웃 (60초)')), 60000)
            ),
          ]);
          neo4jTiming = Date.now() - neo4jStart;
        } catch (err) {
          neo4jError = err.message;
          neo4jTiming = 0;
        }

        // PG 조회 타이밍
        const pgQueryStart = Date.now();
        const pgGraph = await getEntityGraph(query, { documentId: id });
        const pgQueryTiming = Date.now() - pgQueryStart;

        // Neo4j 조회 타이밍 — 15초 타임아웃
        let neo4jGraph, neo4jQueryTiming;
        try {
          if (!kgNeo4jMod) throw new Error('Neo4j 모듈 미설정');
          const neo4jQueryStart = Date.now();
          neo4jGraph = await Promise.race([
            kgNeo4jMod.getEntityGraphNeo4j({ documentId: id }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Neo4j 조회 타임아웃 (15초)')), 15000)
            ),
          ]);
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
      if (!kgNeo4jMod) return res.status(500).json({ error: 'Neo4j 모듈 미설정' });
      console.log(`[KG Neo4j] 트리플 구축 시작: 문서 ${id}`);
      const stats = await kgNeo4jMod.buildKnowledgeGraphNeo4j(query, id);
      console.log(`[KG Neo4j] 완료: 엔티티 ${stats.entities.total}개, 트리플 ${stats.triples.total}개 (${stats.timing}ms)`);

      return res.json({ success: true, documentId: id, stats });
    }

    // DELETE
    if (req.method === 'DELETE') {
      const { docId } = req.body;
      if (!docId) return res.status(400).json({ error: 'docId가 필요합니다.' });

      const id = parseInt(docId, 10);
      if (!neo4jMod) return res.status(500).json({ error: 'Neo4j 모듈 미설정' });
      await neo4jMod.runCypher(
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
