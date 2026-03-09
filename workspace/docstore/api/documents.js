// 문서 목록 조회 / 상세 조회 / 삭제 API
const { query } = require('./db');

module.exports = async function handler(req, res) {
  try {
    // GET: 문서 목록 또는 상세 조회
    if (req.method === 'GET') {
      const { id, category } = req.query;

      // 단건 조회 — 문서 메타 + 섹션 텍스트
      if (id) {
        const doc = await query(
          `SELECT id, title, file_type, category,
                  upload_date AS created_at, metadata, embedding_status
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
      // 섹션 수도 함께 조회
      let sql = `
        SELECT d.id, d.title, d.file_type, d.category,
               d.upload_date AS created_at, d.metadata,
               d.embedding_status,
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
