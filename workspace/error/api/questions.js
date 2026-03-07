// Vercel 서버리스 함수 - 문제 관리 API
const { query } = require('./db');
const { verifyToken, extractToken } = require('./auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.body || req.query || {};

  // ── 공개 문제 조회 (비인증, DB 문제풀이 페이지용) ──
  if (req.method === 'GET' && action === 'public') {
    try {
      const { exam_id } = req.query || {};
      let where = 'WHERE 1=1';
      const params = [];
      let idx = 1;
      if (exam_id) { where += ` AND q.exam_id = $${idx++}`; params.push(exam_id); }

      const result = await query(`
        SELECT q.*, e.title as exam_title, s.name as subject_name
        FROM questions q
        LEFT JOIN exams e ON q.exam_id = e.id
        LEFT JOIN subjects s ON q.subject_id = s.id
        ${where}
        ORDER BY q.question_number
      `, params);

      const exams = await query('SELECT * FROM exams ORDER BY sort_order');
      return res.json({ questions: result.rows, exams: exams.rows });
    } catch (err) {
      console.error('[Questions Public] 에러:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  }

  const token = extractToken(req);
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: '인증이 필요합니다.' });

  try {
    // ── 문제 목록 조회 (모든 사용자) ──
    if (req.method === 'GET' || action === 'list') {
      const { exam_id, subject_id, page = 1, limit = 50 } = req.query || {};
      const offset = (parseInt(page) - 1) * parseInt(limit);

      let where = 'WHERE 1=1';
      const params = [];
      let idx = 1;

      if (exam_id) { where += ` AND q.exam_id = $${idx++}`; params.push(exam_id); }
      if (subject_id) { where += ` AND q.subject_id = $${idx++}`; params.push(subject_id); }

      const countResult = await query(`SELECT COUNT(*) as total FROM questions q ${where}`, params);
      const total = parseInt(countResult.rows[0].total);

      params.push(parseInt(limit), offset);
      const result = await query(`
        SELECT q.*, e.title as exam_title, s.name as subject_name
        FROM questions q
        LEFT JOIN exams e ON q.exam_id = e.id
        LEFT JOIN subjects s ON q.subject_id = s.id
        ${where}
        ORDER BY q.question_number
        LIMIT $${idx++} OFFSET $${idx++}
      `, params);

      return res.json({ questions: result.rows, total, page: parseInt(page), limit: parseInt(limit) });
    }

    // ── 이하 관리자 전용 ──
    if (!payload.admin) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });

    // ── 과목/시험 목록 ──
    if (action === 'meta') {
      const subjects = await query('SELECT * FROM subjects ORDER BY sort_order');
      const exams = await query('SELECT * FROM exams ORDER BY sort_order');
      return res.json({ subjects: subjects.rows, exams: exams.rows });
    }

    // ── 문제 상세 조회 ──
    if (action === 'get') {
      const { id } = req.body;
      const result = await query('SELECT * FROM questions WHERE id = $1', [id]);
      if (result.rows.length === 0) return res.status(404).json({ error: '문제를 찾을 수 없습니다.' });
      return res.json({ question: result.rows[0] });
    }

    // ── 문제 등록 ──
    if (action === 'create') {
      const { exam_id, subject_id, question_number, original_number, body, choices, answer, explanation, image_url } = req.body;
      if (!body || !choices || !answer) return res.status(400).json({ error: '문제 본문, 선택지, 정답은 필수입니다.' });

      const result = await query(
        `INSERT INTO questions (exam_id, subject_id, question_number, original_number, body, choices, answer, explanation, image_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [exam_id || null, subject_id || null, question_number || 0, original_number || '', body, JSON.stringify(choices), answer, explanation || null, image_url || null]
      );
      return res.json({ id: result.rows[0].id, message: '문제가 등록되었습니다.' });
    }

    // ── 문제 수정 ──
    if (action === 'update') {
      const { id, exam_id, subject_id, question_number, original_number, body, choices, answer, explanation, image_url } = req.body;
      if (!id) return res.status(400).json({ error: '문제 ID가 필요합니다.' });

      await query(
        `UPDATE questions SET exam_id=$1, subject_id=$2, question_number=$3, original_number=$4, body=$5, choices=$6, answer=$7, explanation=$8, image_url=$9, updated_at=NOW()
         WHERE id=$10`,
        [exam_id || null, subject_id || null, question_number || 0, original_number || '', body, JSON.stringify(choices), answer, explanation || null, image_url || null, id]
      );
      return res.json({ message: '문제가 수정되었습니다.' });
    }

    // ── 문제 삭제 ──
    if (action === 'delete') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: '문제 ID가 필요합니다.' });
      const result = await query('DELETE FROM questions WHERE id = $1 RETURNING id', [id]);
      if (result.rows.length === 0) return res.status(404).json({ error: '문제를 찾을 수 없습니다.' });
      return res.json({ message: '문제가 삭제되었습니다.' });
    }

    // ── 과목 일괄 지정 ──
    if (action === 'assignSubject') {
      const { ids, subject_id } = req.body;
      if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: '문제 ID 배열이 필요합니다.' });
      await query('UPDATE questions SET subject_id = $1, updated_at = NOW() WHERE id = ANY($2)', [subject_id || null, ids]);
      return res.json({ message: `${ids.length}개 문제의 과목이 변경되었습니다.` });
    }

    res.status(400).json({ error: '알 수 없는 액션입니다.' });
  } catch (err) {
    console.error('[Questions] 에러:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
};
