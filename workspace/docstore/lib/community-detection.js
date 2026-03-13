// 커뮤니티 탐지 엔진
// Louvain / Leiden 알고리즘 구현 + 문서 유형별 자동 선택
//
// 사용법:
//   const { detectCommunities } = require('./community-detection');
//   const result = await detectCommunities(dbQuery, { documentId, algorithm: 'auto' });

/**
 * 인접 리스트 기반 무방향 가중치 그래프
 * - 지식 그래프의 방향 있는 트리플을 양방향 엣지로 변환
 * - 가중치 = 트리플의 confidence 합산
 */
class Graph {
  constructor() {
    // 노드: Map<nodeId, { name, type, ... }>
    this.nodes = new Map();
    // 인접 리스트: Map<nodeId, Map<neighborId, weight>>
    this.adj = new Map();
    // 전체 엣지 가중치 합 (modularity 계산용)
    this.totalWeight = 0;
  }

  // 노드 추가
  addNode(id, data = {}) {
    if (!this.nodes.has(id)) {
      this.nodes.set(id, data);
      this.adj.set(id, new Map());
    }
  }

  // 양방향 엣지 추가 (가중치 누적)
  addEdge(u, v, weight = 1.0) {
    if (u === v) return; // 자기 루프 제외
    this.addNode(u);
    this.addNode(v);

    const prevU = this.adj.get(u).get(v) || 0;
    this.adj.get(u).set(v, prevU + weight);

    const prevV = this.adj.get(v).get(u) || 0;
    this.adj.get(v).set(u, prevV + weight);

    this.totalWeight += weight;
  }

  // 노드의 가중치 차수 (연결된 모든 엣지 가중치 합)
  degree(nodeId) {
    let sum = 0;
    const neighbors = this.adj.get(nodeId);
    if (!neighbors) return 0;
    for (const w of neighbors.values()) sum += w;
    return sum;
  }

  // 노드 개수
  get size() {
    return this.nodes.size;
  }
}

// ── Louvain 알고리즘 ──────────────────────────────────
// 빠르고 심플한 커뮤니티 탐지. 일반 문서에 적합.
// 시간복잡도: O(n log n) — 대부분의 경우 매우 빠름

function louvain(graph, options = {}) {
  const { maxIterations = 10, minModularityGain = 1e-6 } = options;
  const m = graph.totalWeight; // 전체 엣지 가중치 합
  if (m === 0) return { communities: new Map(), modularity: 0 };

  // 초기화: 각 노드가 자기만의 커뮤니티
  const community = new Map(); // nodeId → communityId
  let communityId = 0;
  for (const nodeId of graph.nodes.keys()) {
    community.set(nodeId, communityId++);
  }

  // 커뮤니티별 내부 가중치 합 (sigma_in)
  const sigmaIn = new Map();   // communityId → 내부 엣지 가중치 합
  // 커뮤니티별 전체 가중치 합 (sigma_tot)
  const sigmaTot = new Map();  // communityId → 커뮤니티 내 노드들의 차수 합

  // 초기값 설정
  for (const [nodeId, commId] of community) {
    sigmaIn.set(commId, 0);
    sigmaTot.set(commId, graph.degree(nodeId));
  }

  // Phase 1: 노드 이동 반복
  for (let iter = 0; iter < maxIterations; iter++) {
    let improved = false;
    const nodeList = [...graph.nodes.keys()];

    // 랜덤 순서로 탐색 (Fisher-Yates 셔플)
    for (let i = nodeList.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [nodeList[i], nodeList[j]] = [nodeList[j], nodeList[i]];
    }

    for (const nodeId of nodeList) {
      const currentComm = community.get(nodeId);
      const ki = graph.degree(nodeId); // 이 노드의 차수
      const neighbors = graph.adj.get(nodeId);
      if (!neighbors || neighbors.size === 0) continue;

      // 이웃 커뮤니티별 연결 가중치 계산
      const neighborComms = new Map(); // commId → 연결 가중치 합
      for (const [neighbor, weight] of neighbors) {
        const nComm = community.get(neighbor);
        neighborComms.set(nComm, (neighborComms.get(nComm) || 0) + weight);
      }

      // 현재 커뮤니티에서 제거했을 때의 modularity 변화
      const kiIn = neighborComms.get(currentComm) || 0;
      const removeCost = kiIn - (sigmaTot.get(currentComm) * ki) / (2 * m);

      // 최선의 이동 커뮤니티 찾기
      let bestComm = currentComm;
      let bestGain = 0;

      for (const [targetComm, kiTarget] of neighborComms) {
        if (targetComm === currentComm) continue;
        const gain = kiTarget - (sigmaTot.get(targetComm) * ki) / (2 * m) - removeCost;
        if (gain > bestGain) {
          bestGain = gain;
          bestComm = targetComm;
        }
      }

      // 이동이 이득이면 실행
      if (bestComm !== currentComm && bestGain > minModularityGain) {
        // 현재 커뮤니티에서 제거
        sigmaTot.set(currentComm, sigmaTot.get(currentComm) - ki);
        sigmaIn.set(currentComm, sigmaIn.get(currentComm) - 2 * kiIn);

        // 새 커뮤니티에 추가
        const kiNew = neighborComms.get(bestComm) || 0;
        sigmaTot.set(bestComm, sigmaTot.get(bestComm) + ki);
        sigmaIn.set(bestComm, sigmaIn.get(bestComm) + 2 * kiNew);

        community.set(nodeId, bestComm);
        improved = true;
      }
    }

    if (!improved) break; // 수렴하면 중단
  }

  // Modularity 계산
  const modularity = _calcModularity(graph, community);

  return { communities: community, modularity };
}

// ── Leiden 알고리즘 ──────────────────────────────────
// Louvain의 개선판. 더 정밀한 커뮤니티 분할.
// 법령/학술 문서처럼 구조가 복잡한 경우에 적합.
// "잘 연결된(well-connected)" 커뮤니티를 보장.

function leiden(graph, options = {}) {
  const { maxIterations = 10, gamma = 1.0 } = options;
  const m = graph.totalWeight;
  if (m === 0) return { communities: new Map(), modularity: 0 };

  // 1단계: Louvain과 동일하게 초기 할당
  const community = new Map();
  let commId = 0;
  for (const nodeId of graph.nodes.keys()) {
    community.set(nodeId, commId++);
  }

  for (let iter = 0; iter < maxIterations; iter++) {
    let moved = false;

    // Phase 1: 로컬 이동 (Louvain과 동일)
    const nodeList = [...graph.nodes.keys()];
    _shuffle(nodeList);

    for (const nodeId of nodeList) {
      const currentComm = community.get(nodeId);
      const ki = graph.degree(nodeId);
      const neighbors = graph.adj.get(nodeId);
      if (!neighbors || neighbors.size === 0) continue;

      // 이웃 커뮤니티별 연결 가중치
      const neighborComms = new Map();
      for (const [neighbor, weight] of neighbors) {
        const nComm = community.get(neighbor);
        neighborComms.set(nComm, (neighborComms.get(nComm) || 0) + weight);
      }

      // 커뮤니티별 총 차수 계산
      const commTotals = new Map();
      for (const [nId, cId] of community) {
        commTotals.set(cId, (commTotals.get(cId) || 0) + graph.degree(nId));
      }

      let bestComm = currentComm;
      let bestDelta = 0;

      for (const [targetComm, kiTarget] of neighborComms) {
        if (targetComm === currentComm) continue;
        const sigmaTot = commTotals.get(targetComm) || 0;
        const sigmaCur = commTotals.get(currentComm) || 0;
        const kiCur = neighborComms.get(currentComm) || 0;

        // Leiden 품질 함수 (resolution parameter gamma 적용)
        const delta = (kiTarget - kiCur) / m - gamma * ki * (sigmaTot - sigmaCur + ki) / (2 * m * m);

        if (delta > bestDelta) {
          bestDelta = delta;
          bestComm = targetComm;
        }
      }

      if (bestComm !== currentComm && bestDelta > 0) {
        community.set(nodeId, bestComm);
        moved = true;
      }
    }

    if (!moved) break;

    // Phase 2: Leiden 고유 — 커뮤니티 정제(refinement)
    // 각 커뮤니티 내에서 서브커뮤니티가 있는지 확인하고 분할
    _refinePartition(graph, community, gamma);
  }

  // 커뮤니티 ID 재정렬 (0부터 연속)
  _renumberCommunities(community);

  const modularity = _calcModularity(graph, community);
  return { communities: community, modularity };
}

// Leiden 정제: 커뮤니티 내부에서 더 나은 분할이 있는지 확인
function _refinePartition(graph, community, gamma) {
  // 커뮤니티별 노드 그룹핑
  const commNodes = new Map();
  for (const [nodeId, commId] of community) {
    if (!commNodes.has(commId)) commNodes.set(commId, []);
    commNodes.get(commId).push(nodeId);
  }

  const m = graph.totalWeight;
  let nextComm = Math.max(...community.values()) + 1;

  for (const [, nodes] of commNodes) {
    if (nodes.length <= 2) continue; // 2개 이하는 분할 불가

    // 서브그래프에서 연결이 약한 노드를 분리
    for (const nodeId of nodes) {
      const ki = graph.degree(nodeId);
      const neighbors = graph.adj.get(nodeId);
      if (!neighbors) continue;

      // 같은 커뮤니티 내 이웃과의 연결 강도
      let internalWeight = 0;
      let totalWeight = 0;
      for (const [neighbor, weight] of neighbors) {
        totalWeight += weight;
        if (community.get(neighbor) === community.get(nodeId)) {
          internalWeight += weight;
        }
      }

      // 내부 연결이 약하면 → 새 커뮤니티로 분리
      const ratio = totalWeight > 0 ? internalWeight / totalWeight : 0;
      if (ratio < gamma * 0.3 && nodes.length > 2) {
        community.set(nodeId, nextComm++);
      }
    }
  }
}

// ── 유틸리티 함수 ──────────────────────────────────

// Modularity 계산: Q = (1/2m) * Σ[Aij - ki*kj/2m] * δ(ci, cj)
function _calcModularity(graph, community) {
  const m = graph.totalWeight;
  if (m === 0) return 0;

  let q = 0;
  for (const [nodeId, neighbors] of graph.adj) {
    const ki = graph.degree(nodeId);
    const ci = community.get(nodeId);

    for (const [neighbor, weight] of neighbors) {
      if (community.get(neighbor) !== ci) continue;
      const kj = graph.degree(neighbor);
      q += weight - (ki * kj) / (2 * m);
    }
  }

  return q / (2 * m);
}

// Fisher-Yates 셔플
function _shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// 커뮤니티 ID를 0부터 연속 번호로 재정렬
function _renumberCommunities(community) {
  const idMap = new Map();
  let next = 0;
  for (const [nodeId, commId] of community) {
    if (!idMap.has(commId)) idMap.set(commId, next++);
    community.set(nodeId, idMap.get(commId));
  }
}

// ── 문서 유형 판별 ──────────────────────────────────

/**
 * 문서의 파일 타입과 내용 특성으로 유형을 판별
 * @param {object} docInfo - { file_type, title, sectionCount, articleCount }
 * @returns {'legislation'|'academic'|'general'}
 */
function detectDocumentType(docInfo) {
  const { file_type, title = '', articleCount = 0, sectionCount = 0 } = docInfo;

  // 법령: 제N조 패턴이 전체 섹션의 30% 이상이면 법령
  if (articleCount > 0 && sectionCount > 0) {
    const ratio = articleCount / sectionCount;
    if (ratio >= 0.3) return 'legislation';
  }

  // 타이틀 기반 판별
  if (/법$|법률$|시행령$|시행규칙$|규정$|조례$|훈령$/g.test(title)) return 'legislation';
  if (/논문|학술|연구|보고서|journal|paper/i.test(title)) return 'academic';

  return 'general';
}

// 유형별 알고리즘 매핑
const ALGORITHM_MAP = {
  legislation: 'leiden',   // 법령 → Leiden (정밀한 계층적 구조 탐지)
  academic: 'leiden',      // 학술 → Leiden (인용 네트워크에 강함)
  general: 'louvain',      // 일반 → Louvain (빠름, 충분한 품질)
};

// ── 메인 진입점 ──────────────────────────────────

/**
 * 지식 그래프에서 커뮤니티를 탐지
 *
 * @param {Function} dbQuery - DB 쿼리 함수
 * @param {object} options
 * @param {number} options.documentId - 문서 ID (필수)
 * @param {string} [options.algorithm='auto'] - 'auto', 'louvain', 'leiden'
 * @param {number} [options.minConfidence=0.5] - 최소 트리플 신뢰도
 * @returns {Promise<{
 *   communities: { id, nodes: { id, name, type }[], size }[],
 *   algorithm: string,
 *   documentType: string,
 *   modularity: number,
 *   elapsed: number,
 *   stats: { nodes, edges, communities }
 * }>}
 */
async function detectCommunities(dbQuery, options = {}) {
  const { documentId, algorithm = 'auto', minConfidence = 0.5 } = options;
  if (!documentId) throw new Error('documentId가 필요합니다.');

  const startTime = Date.now();

  // 1) 문서 정보 조회
  const docResult = await dbQuery(
    'SELECT title, file_type FROM documents WHERE id = $1',
    [documentId]
  );
  if (docResult.rows.length === 0) throw new Error('문서를 찾을 수 없습니다.');
  const docInfo = docResult.rows[0];

  // 2) 조문 수 조회 (문서 유형 판별용)
  const sectionResult = await dbQuery(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE metadata->>'articleNumber' IS NOT NULL) AS articles
     FROM document_sections WHERE document_id = $1`,
    [documentId]
  );
  const { total: sectionCount, articles: articleCount } = sectionResult.rows[0];
  docInfo.sectionCount = parseInt(sectionCount);
  docInfo.articleCount = parseInt(articleCount);

  // 3) 문서 유형 판별 + 알고리즘 선택
  const docType = detectDocumentType(docInfo);
  const selectedAlgo = algorithm === 'auto'
    ? (ALGORITHM_MAP[docType] || 'louvain')
    : algorithm;

  // 4) 지식 그래프를 Graph 객체로 변환
  const triplesResult = await dbQuery(
    `SELECT kt.subject_id, kt.object_id, kt.confidence, kt.predicate,
            s.name AS subject_name, s.entity_type AS subject_type,
            o.name AS object_name, o.entity_type AS object_type
     FROM knowledge_triples kt
     JOIN entities s ON kt.subject_id = s.id
     JOIN entities o ON kt.object_id = o.id
     WHERE kt.source_document_id = $1 AND kt.confidence >= $2
     ORDER BY kt.confidence DESC`,
    [documentId, minConfidence]
  );

  const graph = new Graph();
  for (const row of triplesResult.rows) {
    graph.addNode(row.subject_id, { name: row.subject_name, type: row.subject_type });
    graph.addNode(row.object_id, { name: row.object_name, type: row.object_type });
    graph.addEdge(row.subject_id, row.object_id, row.confidence);
  }

  if (graph.size === 0) {
    return {
      communities: [],
      algorithm: selectedAlgo,
      documentType: docType,
      modularity: 0,
      elapsed: Date.now() - startTime,
      stats: { nodes: 0, edges: 0, communities: 0 },
    };
  }

  // 5) 알고리즘 실행
  const algoFn = selectedAlgo === 'leiden' ? leiden : louvain;
  const { communities: communityMap, modularity } = algoFn(graph);

  // 6) 결과 정리: 커뮤니티 ID별 노드 그룹핑
  const commGroups = new Map();
  for (const [nodeId, commId] of communityMap) {
    if (!commGroups.has(commId)) commGroups.set(commId, []);
    const nodeData = graph.nodes.get(nodeId);
    commGroups.get(commId).push({
      id: nodeId,
      name: nodeData?.name || String(nodeId),
      type: nodeData?.type || 'unknown',
    });
  }

  // 크기 내림차순 정렬 + ID 재정렬
  const sortedComms = [...commGroups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([, nodes], idx) => ({
      id: idx,
      nodes,
      size: nodes.length,
    }));

  return {
    communities: sortedComms,
    algorithm: selectedAlgo,
    documentType: docType,
    modularity: Math.round(modularity * 1000) / 1000,
    elapsed: Date.now() - startTime,
    stats: {
      nodes: graph.size,
      edges: triplesResult.rows.length,
      communities: sortedComms.length,
    },
  };
}

/**
 * 커뮤니티 탐지 결과를 DB에 저장
 */
async function saveCommunities(dbQuery, documentId, result) {
  // 기존 커뮤니티 삭제
  await dbQuery('DELETE FROM communities WHERE document_id = $1', [documentId]);

  // 커뮤니티별 저장
  for (const comm of result.communities) {
    const entityIds = comm.nodes.map(n => n.id);
    await dbQuery(
      `INSERT INTO communities (document_id, community_index, entity_ids, size, algorithm, modularity, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        documentId,
        comm.id,
        JSON.stringify(entityIds),
        comm.size,
        result.algorithm,
        result.modularity,
        JSON.stringify({
          documentType: result.documentType,
          elapsed: result.elapsed,
          nodes: comm.nodes,
        }),
      ]
    );
  }

  return { saved: result.communities.length };
}

/**
 * 저장된 커뮤니티 조회
 */
async function getCommunities(dbQuery, documentId) {
  const result = await dbQuery(
    `SELECT id, community_index, entity_ids, size, algorithm, modularity, summary, metadata, created_at
     FROM communities
     WHERE document_id = $1
     ORDER BY community_index`,
    [documentId]
  );
  return result.rows;
}

module.exports = {
  Graph,
  louvain,
  leiden,
  detectDocumentType,
  detectCommunities,
  saveCommunities,
  getCommunities,
  ALGORITHM_MAP,
};
