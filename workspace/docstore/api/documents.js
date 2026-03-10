// 문서 목록 조회 / 상세 조회 / 삭제 API
const { query } = require('./db');
const { requireAdmin } = require('./auth');
const { setCors } = require('./cors');

module.exports = async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, DELETE, OPTIONS' })) return;

  // 인증 체크 — 관리자만 허용
  const { user, error: authError } = requireAdmin(req);
  if (authError) return res.status(401).json({ error: authError });

  try {
    // GET: 문서 목록 / 상세 조회 / 원본 다운로드
    if (req.method === 'GET') {
      const { id, category, download } = req.query;

      // 원본 파일 다운로드 — ?id=N&download=true
      if (id && download === 'true') {
        const doc = await query(
          `SELECT original_file, original_filename, original_mimetype
           FROM documents WHERE id = $1`, [id]
        );
        if (doc.rows.length === 0) {
          return res.status(404).json({ error: '문서를 찾을 수 없습니다.' });
        }
        const row = doc.rows[0];
        if (!row.original_file) {
          return res.status(404).json({ error: '원본 파일이 저장되어 있지 않습니다.' });
        }
        // 바이너리 파일 응답
        const filename = row.original_filename || 'download';
        const mimetype = row.original_mimetype || 'application/octet-stream';
        res.setHeader('Content-Type', mimetype);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        return res.send(row.original_file);
      }

      // 원본 파일 미리보기 (이미지) — ?id=N&download=preview
      if (id && download === 'preview') {
        const doc = await query(
          `SELECT original_file, original_mimetype
           FROM documents WHERE id = $1`, [id]
        );
        if (doc.rows.length === 0) {
          return res.status(404).json({ error: '문서를 찾을 수 없습니다.' });
        }
        const row = doc.rows[0];
        if (!row.original_file) {
          return res.status(404).json({ error: '원본 파일이 저장되어 있지 않습니다.' });
        }
        const mimetype = row.original_mimetype || 'application/octet-stream';
        res.setHeader('Content-Type', mimetype);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return res.send(row.original_file);
      }

      // 단건 조회 — 문서 메타 + 섹션 텍스트
      if (id) {
        const doc = await query(
          `SELECT id, title, file_type, category,
                  upload_date AS created_at, metadata, embedding_status,
                  original_filename, original_mimetype, file_size
           FROM documents WHERE id = $1`, [id]
        );
        if (doc.rows.length === 0) {
          return res.status(404).json({ error: '문서를 찾을 수 없습니다.' });
        }
        // 섹션 조회 (프론트에서 쓰는 필드명에 맞춤)
        const sections = await query(
          `SELECT id, section_type, section_index,
                  raw_text AS text, image_url, metadata
           FROM document_sections
           WHERE document_id = $1
           ORDER BY section_index`, [id]
        );
        return res.json({ document: doc.rows[0], sections: sections.rows });
      }

      // 목록 조회 (카테고리 필터 가능)
      let sql = `
        SELECT d.id, d.title, d.file_type, d.category,
               d.upload_date AS created_at, d.metadata,
               d.embedding_status, d.original_filename, d.file_size,
               COUNT(s.id) AS section_count
        FROM documents d
        LEFT JOIN document_sections s ON s.document_id = d.id
      `;
      let params = [];

      if (category) {
        sql += ' WHERE d.category = $1';
        params = [category];
      }

      sql += ' GROUP BY d.id ORDER BY d.upload_date DESC';

      const docs = await query(sql, params);
      return res.json({ documents: docs.rows });
    }

    // POST: 문서 삭제
    if (req.method === 'POST') {
      const { action, id } = req.body;

      if (action === 'delete' && id) {
        // 손자(chunks) → 자식(sections) → 부모(documents) 순서로 삭제
        // 1) 해당 문서의 섹션 ID 목록 조회
        const sectionRows = await query(
          'SELECT id FROM document_sections WHERE document_id = $1', [id]
        );
        const sectionIds = sectionRows.rows.map(r => r.id);

        // 2) 섹션에 연결된 청크(임베딩) 삭제
        if (sectionIds.length > 0) {
          await query(
            `DELETE FROM document_chunks WHERE section_id = ANY($1)`,
            [sectionIds]
          );
        }

        // 3) 섹션 삭제
        await query('DELETE FROM document_sections WHERE document_id = $1', [id]);

        // 4) 문서 삭제
        await query('DELETE FROM documents WHERE id = $1', [id]);

        return res.json({ success: true, message: '문서가 삭제되었습니다.' });
      }

      return res.status(400).json({ error: '잘못된 요청입니다.' });
    }

    res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  } catch (err) {
    console.error('Documents API 에러:', err);
    res.status(500).json({ error: err.message });
  }
};
