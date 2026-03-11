// 법령 조문 참조 관계 그래프 데이터 API
// GET /api/law-graph?docId=123
// → { nodes: [...], links: [...], stats: {...} }
const { query } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { sendError } = require('../lib/error-handler');

module.exports = async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET만 허용' });

  const { error: authError } = requireAuth(req);
  if (authError) return res.status(401).json({ error: authError });

  const docId = req.query.docId || req.query.id;
  if (!docId) return res.status(400).json({ error: 'docId가 필요합니다.' });

  try {
    // 해당 문서의 모든 조문 섹션 가져오기
    const result = await query(
      `SELECT id, section_index, raw_text, metadata
       FROM document_sections
       WHERE document_id = $1 AND section_type = 'article'
       ORDER BY section_index`,
      [docId]
    );

    if (result.rows.length === 0) {
      return res.json({ nodes: [], links: [], stats: {} });
    }

    const nodes = [];
    const links = [];
    const nodeMap = {}; // 조문ID → node index

    // 1) 노드 생성
    for (const row of result.rows) {
      const meta = row.metadata || {};
      let artId = meta.articleNumber ? `제${meta.articleNumber}조` : null;
      if (!artId) continue;
      if (meta.branchNumber) artId += `의${meta.branchNumber}`;

      const references = meta.references || [];
      const referencedBy = meta.referencedBy || [];

      nodeMap[artId] = nodes.length;
      nodes.push({
        id: artId,
        label: `${artId}${meta.articleTitle ? '(' + meta.articleTitle + ')' : ''}`,
        chapter: meta.chapter || '',
        articleTitle: meta.articleTitle || '',
        refCount: referencedBy.length,     // 역참조 수 (중요도)
        outCount: references.length,       // 참조하는 수
        sectionId: row.id,
      });
    }

    // 2) 링크 생성 (실제 존재하는 노드끼리만)
    for (const row of result.rows) {
      const meta = row.metadata || {};
      let sourceId = meta.articleNumber ? `제${meta.articleNumber}조` : null;
      if (!sourceId) continue;
      if (meta.branchNumber) sourceId += `의${meta.branchNumber}`;

      const references = meta.references || [];
      for (const ref of references) {
        // 참조 대상을 조문 번호로 정규화 (항/호 제거)
        const baseRef = ref.match(/^제\d+조(?:의\d+)?/)?.[0];
        if (baseRef && nodeMap[baseRef] !== undefined && baseRef !== sourceId) {
          links.push({ source: sourceId, target: baseRef });
        }
      }
    }

    // 3) 통계 계산
    const mostReferenced = [...nodes].sort((a, b) => b.refCount - a.refCount).slice(0, 5);
    const mostReferencing = [...nodes].sort((a, b) => b.outCount - a.outCount).slice(0, 5);
    const isolated = nodes.filter(n => n.refCount === 0 && n.outCount === 0);

    // 장별 참조 밀도
    const chapterDensity = {};
    for (const node of nodes) {
      const ch = node.chapter || '기타';
      if (!chapterDensity[ch]) chapterDensity[ch] = { count: 0, refs: 0 };
      chapterDensity[ch].count++;
      chapterDensity[ch].refs += node.refCount + node.outCount;
    }

    res.json({
      nodes,
      links,
      stats: {
        totalNodes: nodes.length,
        totalLinks: links.length,
        mostReferenced: mostReferenced.map(n => ({ id: n.id, label: n.label, count: n.refCount })),
        mostReferencing: mostReferencing.map(n => ({ id: n.id, label: n.label, count: n.outCount })),
        isolatedCount: isolated.length,
        chapterDensity,
      },
    });
  } catch (err) {
    sendError(res, err, '[LawGraph]');
  }
};
