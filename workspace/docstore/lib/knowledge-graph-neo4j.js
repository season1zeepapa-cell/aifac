// 지식 그래프 트리플스토어 — Neo4j 버전
// PostgreSQL 버전(lib/knowledge-graph.js)과 동일한 인터페이스
// 엔티티 추출/트리플 추출은 공통 모듈 재활용, 저장/조회만 Neo4j Cypher 사용
//
// Neo4j 데이터 모델:
//   (:Entity {name, type, documentId, sectionId}) -[:RELATION {predicate, confidence, context}]-> (:Entity)

const { runCypher, checkConnection } = require('./neo4j');
const { extractEntities, extractTriples } = require('./knowledge-graph');

/**
 * Neo4j 인덱스/제약 초기화 (최초 1회)
 */
async function ensureIndexes() {
  // 유니크 제약 (이름+타입+문서 조합)
  await runCypher(`
    CREATE CONSTRAINT entity_unique IF NOT EXISTS
    FOR (e:Entity) REQUIRE (e.name, e.type, e.documentId) IS UNIQUE
  `).catch(() => {
    // Community Edition은 composite unique 미지원 — 개별 인덱스로 대체
  });

  // 검색용 인덱스
  await runCypher('CREATE INDEX entity_name IF NOT EXISTS FOR (e:Entity) ON (e.name)').catch(() => {});
  await runCypher('CREATE INDEX entity_type IF NOT EXISTS FOR (e:Entity) ON (e.type)').catch(() => {});
  await runCypher('CREATE INDEX entity_doc IF NOT EXISTS FOR (e:Entity) ON (e.documentId)').catch(() => {});
}

/**
 * 문서의 지식 그래프 구축 (Neo4j에 저장)
 * PG 버전 buildKnowledgeGraph와 동일 인터페이스
 * @param {Function} dbQuery - PG DB 쿼리 함수 (문서/섹션 조회용)
 * @param {number} documentId - 문서 ID
 * @returns {{ entities: { total, byType }, triples: { total, byPredicate }, timing: number }}
 */
async function buildKnowledgeGraphNeo4j(dbQuery, documentId) {
  const startTime = Date.now();

  // 인덱스 확인
  await ensureIndexes();

  // 1) 문서 정보 (PG에서 조회)
  const docRow = await dbQuery('SELECT title, file_type FROM documents WHERE id = $1', [documentId]);
  if (docRow.rows.length === 0) throw new Error('문서를 찾을 수 없습니다.');
  const docTitle = docRow.rows[0].title;

  // 2) 섹션 조회 (PG에서)
  const sections = await dbQuery(
    'SELECT id, raw_text, metadata FROM document_sections WHERE document_id = $1 ORDER BY section_index',
    [documentId]
  );

  // 3) 기존 Neo4j 데이터 삭제 (재구축)
  await runCypher(
    'MATCH (e:Entity {documentId: $docId}) DETACH DELETE e',
    { docId: documentId }
  );

  // 통계
  const stats = {
    entities: { total: 0, byType: {} },
    triples: { total: 0, byPredicate: {} },
  };

  // 4) 섹션별 엔티티 + 트리플 추출 → Neo4j 저장
  for (const section of sections.rows) {
    if (!section.raw_text) continue;

    const entities = extractEntities(section.raw_text, docTitle);

    // 엔티티 노드 생성 (MERGE = UPSERT)
    for (const ent of entities) {
      await runCypher(
        `MERGE (e:Entity {name: $name, type: $type, documentId: $docId})
         ON CREATE SET e.sectionId = $secId, e.createdAt = datetime()
         ON MATCH SET e.sectionId = $secId`,
        { name: ent.name, type: ent.type, docId: documentId, secId: section.id }
      );
      stats.entities.total++;
      stats.entities.byType[ent.type] = (stats.entities.byType[ent.type] || 0) + 1;
    }

    // 트리플 → Neo4j 관계 생성
    const triples = extractTriples(section.raw_text, entities);
    for (const triple of triples) {
      await runCypher(
        `MATCH (s:Entity {name: $subj, type: $subjType, documentId: $docId})
         MATCH (o:Entity {name: $obj, type: $objType, documentId: $docId})
         MERGE (s)-[r:RELATION {predicate: $pred}]->(o)
         ON CREATE SET r.confidence = $conf, r.context = $ctx,
                       r.sourceDocId = $docId, r.sourceSectionId = $secId
         ON MATCH SET r.confidence = CASE WHEN r.confidence < $conf THEN $conf ELSE r.confidence END,
                      r.context = $ctx`,
        {
          subj: triple.subject, subjType: triple.subjectType,
          obj: triple.object, objType: triple.objectType,
          pred: triple.predicate, conf: triple.confidence,
          ctx: triple.context, docId: documentId, secId: section.id,
        }
      );
      stats.triples.total++;
      stats.triples.byPredicate[triple.predicate] = (stats.triples.byPredicate[triple.predicate] || 0) + 1;
    }
  }

  stats.timing = Date.now() - startTime;
  return stats;
}

/**
 * Neo4j에서 지식 그래프 조회
 * PG 버전 getEntityGraph와 동일 반환 형태
 * @param {Object} options - { documentId, entityId, search }
 * @returns {{ nodes: [...], links: [...], entities: [...], stats: {...}, timing: number }}
 */
async function getEntityGraphNeo4j(options = {}) {
  const startTime = Date.now();
  const { documentId, entityId, search } = options;

  let result;

  if (entityId) {
    // 특정 엔티티 중심
    result = await runCypher(
      `MATCH (s:Entity)-[r:RELATION]->(o:Entity)
       WHERE id(s) = $eid OR id(o) = $eid
       RETURN s, r, o ORDER BY r.confidence DESC`,
      { eid: parseInt(entityId, 10) }
    );
  } else if (search) {
    // 검색
    result = await runCypher(
      `MATCH (s:Entity)-[r:RELATION]->(o:Entity)
       WHERE s.name CONTAINS $q OR o.name CONTAINS $q
       RETURN s, r, o ORDER BY r.confidence DESC LIMIT 200`,
      { q: search }
    );
  } else if (documentId) {
    // 문서별
    result = await runCypher(
      `MATCH (s:Entity {documentId: $docId})-[r:RELATION]->(o:Entity {documentId: $docId})
       RETURN s, r, o ORDER BY r.confidence DESC`,
      { docId: parseInt(documentId, 10) }
    );
  } else {
    return { nodes: [], links: [], entities: [], stats: { entities: 0, triples: 0 }, timing: 0 };
  }

  // Neo4j 결과 → nodes/links 변환
  const nodeMap = new Map();
  const links = [];

  for (const record of result.records) {
    const s = record.get('s');
    const r = record.get('r');
    const o = record.get('o');

    const sId = s.identity.toNumber();
    const oId = o.identity.toNumber();

    if (!nodeMap.has(sId)) {
      nodeMap.set(sId, {
        id: sId,
        name: s.properties.name,
        type: s.properties.type,
        linkCount: 0,
      });
    }
    nodeMap.get(sId).linkCount++;

    if (!nodeMap.has(oId)) {
      nodeMap.set(oId, {
        id: oId,
        name: o.properties.name,
        type: o.properties.type,
        linkCount: 0,
      });
    }
    nodeMap.get(oId).linkCount++;

    links.push({
      id: r.identity.toNumber(),
      source: sId,
      target: oId,
      predicate: r.properties.predicate,
      confidence: r.properties.confidence,
      context: r.properties.context,
    });
  }

  const nodes = [...nodeMap.values()];

  // 엔티티 목록 (문서별)
  let entitiesList = [];
  if (documentId) {
    const entResult = await runCypher(
      'MATCH (e:Entity {documentId: $docId}) RETURN e ORDER BY e.type, e.name',
      { docId: parseInt(documentId, 10) }
    );
    entitiesList = entResult.records.map(r => {
      const e = r.get('e');
      return {
        id: e.identity.toNumber(),
        name: e.properties.name,
        entity_type: e.properties.type,
        metadata: {},
      };
    });
  }

  // 통계
  const stats = {
    entities: nodes.length,
    triples: links.length,
    byType: {},
    byPredicate: {},
  };
  for (const n of nodes) stats.byType[n.type] = (stats.byType[n.type] || 0) + 1;
  for (const l of links) stats.byPredicate[l.predicate] = (stats.byPredicate[l.predicate] || 0) + 1;

  return { nodes, links, entities: entitiesList, stats, timing: Date.now() - startTime };
}

/**
 * Neo4j 경로 탐색 — PG에서는 어려운 그래프 네이티브 기능
 * 엔티티 A → B 최단 경로
 */
async function findShortestPath(entityName1, entityName2, documentId) {
  const startTime = Date.now();
  const result = await runCypher(
    `MATCH path = shortestPath(
       (a:Entity {name: $n1, documentId: $docId})-[:RELATION*..10]->(b:Entity {name: $n2, documentId: $docId})
     )
     RETURN path`,
    { n1: entityName1, n2: entityName2, docId: parseInt(documentId, 10) }
  );

  if (result.records.length === 0) {
    return { found: false, timing: Date.now() - startTime };
  }

  const path = result.records[0].get('path');
  const pathNodes = path.segments.map(seg => ({
    from: seg.start.properties.name,
    relation: seg.relationship.properties.predicate,
    to: seg.end.properties.name,
  }));

  return {
    found: true,
    length: path.length,
    path: pathNodes,
    timing: Date.now() - startTime,
  };
}

/**
 * Neo4j 이웃 탐색 — N-hop 이웃 엔티티
 */
async function findNeighbors(entityName, documentId, hops = 2) {
  const startTime = Date.now();
  const result = await runCypher(
    `MATCH (start:Entity {name: $name, documentId: $docId})
     MATCH (start)-[:RELATION*1..${Math.min(hops, 5)}]-(neighbor:Entity)
     RETURN DISTINCT neighbor.name AS name, neighbor.type AS type`,
    { name: entityName, docId: parseInt(documentId, 10) }
  );

  return {
    neighbors: result.records.map(r => ({ name: r.get('name'), type: r.get('type') })),
    timing: Date.now() - startTime,
  };
}

module.exports = {
  buildKnowledgeGraphNeo4j,
  getEntityGraphNeo4j,
  findShortestPath,
  findNeighbors,
  ensureIndexes,
};
