// 커뮤니티 탐지 API
// GET    /api/communities?docId=N               — 저장된 커뮤니티 조회
// POST   /api/communities { docId, algorithm }  — 커뮤니티 탐지 실행 + 저장
// POST   /api/communities { docId, summarize }  — 커뮤니티 요약 생성
// POST   /api/communities { globalSearch, question } — 글로벌 검색
// DELETE /api/communities { docId }             — 커뮤니티 삭제
const { query } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { sendError } = require('../lib/error-handler');
const { detectCommunities, saveCommunities, getCommunities } = require('../lib/community-detection');
const { generateAllSummaries, globalSearch } = require('../lib/community-summary');

module.exports = async (req, res) => {
  if (setCors(req, res, { methods: 'GET, POST, DELETE, OPTIONS' })) return;

  const { error: authError } = requireAuth(req);
  if (authError) return res.status(401).json({ error: authError });

  try {
    // GET: 저장된 커뮤니티 조회
    if (req.method === 'GET') {
      const { docId } = req.query;
      if (!docId) return res.status(400).json({ error: 'docId가 필요합니다.' });

      const communities = await getCommunities(query, parseInt(docId, 10));
      return res.json({ communities });
    }

    // POST: 커뮤니티 탐지/요약/글로벌검색
    if (req.method === 'POST') {
      const { docId, algorithm, summarize, globalSearch: isGlobalSearch, question, docIds } = req.body;

      // 글로벌 검색 모드
      if (isGlobalSearch) {
        if (!question) return res.status(400).json({ error: 'question이 필요합니다.' });
        const result = await globalSearch(query, question, {
          docIds: docIds?.map(id => parseInt(id, 10)),
        });
        return res.json(result);
      }

      if (!docId) return res.status(400).json({ error: 'docId가 필요합니다.' });
      const id = parseInt(docId, 10);

      // 요약 생성 모드
      if (summarize) {
        const communities = await getCommunities(query, id);
        if (communities.length === 0) {
          return res.status(400).json({ error: '먼저 커뮤니티 탐지를 실행하세요.' });
        }

        // 저장된 커뮤니티 형식을 변환
        const commData = communities.map(c => {
          const meta = typeof c.metadata === 'string' ? JSON.parse(c.metadata) : (c.metadata || {});
          return {
            id: c.community_index,
            nodes: meta.nodes || [],
            size: c.size,
          };
        });

        console.log(`[Communities] 요약 생성 시작: 문서 ${id}, ${commData.length}개 커뮤니티`);
        const result = await generateAllSummaries(query, id, commData);
        console.log(`[Communities] 요약 완료: ${result.generated}개 생성, ${result.errors}개 오류`);

        return res.json({ success: true, ...result });
      }

      // 커뮤니티 탐지 모드
      console.log(`[Communities] 탐지 시작: 문서 ${id}, 알고리즘: ${algorithm || 'auto'}`);
      const result = await detectCommunities(query, {
        documentId: id,
        algorithm: algorithm || 'auto',
      });

      // DB에 저장
      await saveCommunities(query, id, result);
      console.log(`[Communities] 완료: ${result.stats.communities}개 커뮤니티 (${result.algorithm}, ${result.elapsed}ms)`);

      return res.json({
        success: true,
        ...result,
      });
    }

    // DELETE: 커뮤니티 삭제
    if (req.method === 'DELETE') {
      const { docId } = req.body;
      if (!docId) return res.status(400).json({ error: 'docId가 필요합니다.' });

      await query('DELETE FROM communities WHERE document_id = $1', [parseInt(docId, 10)]);
      return res.json({ success: true });
    }

    return res.status(405).json({ error: 'GET, POST 또는 DELETE만 허용' });
  } catch (err) {
    sendError(res, err, '[Communities]');
  }
};
