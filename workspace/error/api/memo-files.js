// Vercel 서버리스 함수 - 메모 첨부파일 API
const { query } = require('./db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query?.action || req.body?.action;

  try {
    // ── 파일 목록 조회 (memo_id 기준) ──
    if (req.method === 'GET' && action === 'list') {
      const { memo_id } = req.query;
      if (!memo_id) return res.status(400).json({ error: 'memo_id가 필요합니다.' });

      const result = await query(
        `SELECT id, memo_id, filename, mime_type, size, created_at
         FROM memo_files WHERE memo_id = $1 ORDER BY created_at`,
        [memo_id]
      );
      return res.json({ files: result.rows });
    }

    // ── 여러 메모의 파일 목록 일괄 조회 ──
    if (req.method === 'GET' && action === 'batch') {
      const { memo_ids } = req.query;
      if (!memo_ids) return res.json({ files: [] });

      const ids = memo_ids.split(',').map(Number).filter(n => !isNaN(n));
      if (ids.length === 0) return res.json({ files: [] });

      const result = await query(
        `SELECT id, memo_id, filename, mime_type, size, created_at
         FROM memo_files WHERE memo_id = ANY($1) ORDER BY created_at`,
        [ids]
      );
      return res.json({ files: result.rows });
    }

    // ── 파일 다운로드 (base64 데이터 반환) ──
    if (req.method === 'GET' && action === 'download') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: '파일 ID가 필요합니다.' });

      const result = await query(
        'SELECT filename, mime_type, data FROM memo_files WHERE id = $1',
        [id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });

      const file = result.rows[0];
      return res.json({ filename: file.filename, mime_type: file.mime_type, data: file.data });
    }

    // ── 파일 업로드 (base64) ──
    if (req.method === 'POST' && action === 'upload') {
      const { memo_id, files } = req.body;
      if (!memo_id || !files || !Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: 'memo_id와 files 배열이 필요합니다.' });
      }

      // 파일당 5MB 제한
      const MAX_SIZE = 5 * 1024 * 1024;
      const uploaded = [];

      for (const f of files) {
        if (!f.filename || !f.mime_type || !f.data) continue;

        // base64 데이터 크기 계산 (원본 바이트 수 추정)
        const sizeBytes = Math.ceil(f.data.length * 3 / 4);
        if (sizeBytes > MAX_SIZE) {
          return res.status(400).json({ error: `${f.filename}: 파일 크기가 5MB를 초과합니다.` });
        }

        const result = await query(
          `INSERT INTO memo_files (memo_id, filename, mime_type, data, size)
           VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
          [memo_id, f.filename, f.mime_type, f.data, sizeBytes]
        );
        uploaded.push({
          id: result.rows[0].id,
          memo_id,
          filename: f.filename,
          mime_type: f.mime_type,
          size: sizeBytes,
          created_at: result.rows[0].created_at
        });
      }

      return res.json({ files: uploaded, message: `${uploaded.length}개 파일이 업로드되었습니다.` });
    }

    // ── 파일 삭제 ──
    if (req.method === 'POST' && action === 'delete') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: '파일 ID가 필요합니다.' });

      const result = await query('DELETE FROM memo_files WHERE id = $1 RETURNING id', [id]);
      if (result.rows.length === 0) return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
      return res.json({ message: '파일이 삭제되었습니다.' });
    }

    res.status(400).json({ error: '알 수 없는 액션입니다.' });
  } catch (err) {
    console.error('[MemoFiles] 에러:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
};
