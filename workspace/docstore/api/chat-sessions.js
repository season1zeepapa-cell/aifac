// 채팅 세션 저장/조회/삭제 API
// GET    /api/chat-sessions           — 세션 목록 (최신순)
// GET    /api/chat-sessions?id=N      — 세션 상세 (메시지 포함)
// POST   /api/chat-sessions           — 세션 저장/업데이트
// DELETE /api/chat-sessions?id=N      — 세션 삭제
const { query } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { sendError } = require('../lib/error-handler');

module.exports = async (req, res) => {
  if (setCors(req, res, { methods: 'GET, POST, DELETE, OPTIONS' })) return;

  const { user, orgId, error: authError } = requireAuth(req);
  if (authError) return res.status(401).json({ error: authError });

  try {
    // GET: 세션 목록 또는 상세 (조직별 격리)
    if (req.method === 'GET') {
      const { id } = req.query;

      if (id) {
        // 세션 상세
        const orgC = orgId !== null ? ' AND org_id = $2' : '';
        const orgP = orgId !== null ? [id, orgId] : [id];
        const result = await query(`SELECT * FROM chat_sessions WHERE id = $1${orgC}`, orgP);
        if (result.rows.length === 0) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
        return res.json(result.rows[0]);
      }

      // 세션 목록 (최근 50개, 메시지 제외, 조직별 격리)
      const orgC = orgId !== null ? 'WHERE org_id = $1' : '';
      const orgP = orgId !== null ? [orgId] : [];
      const result = await query(
        `SELECT id, title, provider, doc_ids,
                COALESCE(jsonb_array_length(messages), 0) AS message_count,
                created_at, updated_at
         FROM chat_sessions
         ${orgC}
         ORDER BY updated_at DESC
         LIMIT 50`,
        orgP
      );
      return res.json({ sessions: result.rows });
    }

    // POST: 세션 저장 (upsert, 조직별 격리)
    if (req.method === 'POST') {
      const { id, title, messages, provider, docIds } = req.body;

      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'messages 배열이 필요합니다.' });
      }

      // 제목 자동 생성: 첫 번째 사용자 메시지에서 추출
      const autoTitle = title ||
        (messages.find(m => m.role === 'user')?.content || '새 대화').substring(0, 50);

      if (id) {
        // 기존 세션 업데이트 (소유권 확인)
        const orgC = orgId !== null ? ' AND org_id = $6' : '';
        const orgP = orgId !== null ? [autoTitle, JSON.stringify(messages), provider || 'gemini', docIds || [], id, orgId] : [autoTitle, JSON.stringify(messages), provider || 'gemini', docIds || [], id];
        await query(
          `UPDATE chat_sessions
           SET title = $1, messages = $2, provider = $3, doc_ids = $4, updated_at = NOW()
           WHERE id = $5${orgC}`,
          orgP
        );
        return res.json({ success: true, id: parseInt(id, 10), title: autoTitle });
      }

      // 새 세션 생성 (org_id 포함)
      const result = await query(
        `INSERT INTO chat_sessions (title, messages, provider, doc_ids, org_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [autoTitle, JSON.stringify(messages), provider || 'gemini', docIds || [], orgId]
      );
      return res.json({ success: true, id: result.rows[0].id, title: autoTitle });
    }

    // DELETE: 세션 삭제 (조직별 격리)
    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id가 필요합니다.' });
      const orgC = orgId !== null ? ' AND org_id = $2' : '';
      const orgP = orgId !== null ? [id, orgId] : [id];
      await query(`DELETE FROM chat_sessions WHERE id = $1${orgC}`, orgP);
      return res.json({ success: true });
    }

    return res.status(405).json({ error: 'GET, POST, DELETE만 허용' });
  } catch (err) {
    sendError(res, err, '[ChatSessions]');
  }
};
