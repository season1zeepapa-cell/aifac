// 채팅 세션 저장/조회/삭제 API
// GET    /api/chat-sessions           — 세션 목록 (최신순)
// GET    /api/chat-sessions?id=N      — 세션 상세 (메시지 포함)
// POST   /api/chat-sessions           — 세션 저장/업데이트
// DELETE /api/chat-sessions?id=N      — 세션 삭제
const { query } = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { sendError } = require('../lib/error-handler');

module.exports = async (req, res) => {
  if (setCors(req, res, { methods: 'GET, POST, DELETE, OPTIONS' })) return;

  const { error: authError } = requireAdmin(req);
  if (authError) return res.status(401).json({ error: authError });

  try {
    // GET: 세션 목록 또는 상세
    if (req.method === 'GET') {
      const { id } = req.query;

      if (id) {
        // 세션 상세
        const result = await query('SELECT * FROM chat_sessions WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
        return res.json(result.rows[0]);
      }

      // 세션 목록 (최근 50개, 메시지 제외)
      const result = await query(
        `SELECT id, title, provider, doc_ids,
                COALESCE(jsonb_array_length(messages), 0) AS message_count,
                created_at, updated_at
         FROM chat_sessions
         ORDER BY updated_at DESC
         LIMIT 50`
      );
      return res.json({ sessions: result.rows });
    }

    // POST: 세션 저장 (upsert)
    if (req.method === 'POST') {
      const { id, title, messages, provider, docIds } = req.body;

      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'messages 배열이 필요합니다.' });
      }

      // 제목 자동 생성: 첫 번째 사용자 메시지에서 추출
      const autoTitle = title ||
        (messages.find(m => m.role === 'user')?.content || '새 대화').substring(0, 50);

      if (id) {
        // 기존 세션 업데이트
        await query(
          `UPDATE chat_sessions
           SET title = $1, messages = $2, provider = $3, doc_ids = $4, updated_at = NOW()
           WHERE id = $5`,
          [autoTitle, JSON.stringify(messages), provider || 'gemini', docIds || [], id]
        );
        return res.json({ success: true, id: parseInt(id, 10), title: autoTitle });
      }

      // 새 세션 생성
      const result = await query(
        `INSERT INTO chat_sessions (title, messages, provider, doc_ids)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [autoTitle, JSON.stringify(messages), provider || 'gemini', docIds || []]
      );
      return res.json({ success: true, id: result.rows[0].id, title: autoTitle });
    }

    // DELETE: 세션 삭제
    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id가 필요합니다.' });
      await query('DELETE FROM chat_sessions WHERE id = $1', [id]);
      return res.json({ success: true });
    }

    return res.status(405).json({ error: 'GET, POST, DELETE만 허용' });
  } catch (err) {
    sendError(res, err, '[ChatSessions]');
  }
};
