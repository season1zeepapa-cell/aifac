// 문서 목록 조회 / 상세 조회 / 삭제 / 태그 관리 API
const { query } = require('../lib/db');
const { requireAuth, orgFilter } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { getSignedUrl, deleteDocumentFiles, isStorageAvailable } = require('../lib/storage');
const { sendError } = require('../lib/error-handler');
const { invalidateSummaryCache, invalidateSectionSummary } = require('../lib/summary-cache');

// 단일 문서 영구 삭제 — chunks → sections → tags → Storage → documents 순서
// orgId가 있으면 해당 조직 소유 문서만 삭제 가능
async function deleteDocumentPermanently(docId, orgId) {
  // 소유권 확인
  const orgClause = orgId !== null ? ' AND org_id = $2' : '';
  const orgParams = orgId !== null ? [docId, orgId] : [docId];
  const ownership = await query(`SELECT id FROM documents WHERE id = $1${orgClause}`, orgParams);
  if (ownership.rows.length === 0) throw new Error('NOT_FOUND');

  await query('BEGIN');
  try {
    const sectionRows = await query('SELECT id FROM document_sections WHERE document_id = $1', [docId]);
    const sectionIds = sectionRows.rows.map(r => r.id);
    if (sectionIds.length > 0) {
      await query('DELETE FROM document_chunks WHERE section_id = ANY($1)', [sectionIds]);
    }
    await query('DELETE FROM document_sections WHERE document_id = $1', [docId]);
    await query('DELETE FROM document_tags WHERE document_id = $1', [docId]);
    await query('DELETE FROM documents WHERE id = $1', [docId]);
    await query('COMMIT');
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }
  // Storage 삭제는 트랜잭션 밖에서 (외부 서비스이므로 실패해도 DB 롤백 불필요)
  if (isStorageAvailable()) {
    try { await deleteDocumentFiles(docId); } catch (e) {
      console.warn(`[Documents] Storage 파일 삭제 실패 (문서 ${docId}):`, e.message);
    }
  }
}

// 복수 문서 배치 영구 삭제 — 트랜잭션 1회로 전체 처리
async function deleteDocumentsBatch(docIds, orgId) {
  if (docIds.length === 0) return;
  await query('BEGIN');
  try {
    // 1) 해당 문서들의 섹션 ID 일괄 조회
    const sectionRows = await query('SELECT id FROM document_sections WHERE document_id = ANY($1)', [docIds]);
    const sectionIds = sectionRows.rows.map(r => r.id);
    // 2) chunks → sections → tags → documents 순서로 배치 삭제
    if (sectionIds.length > 0) {
      await query('DELETE FROM document_chunks WHERE section_id = ANY($1)', [sectionIds]);
    }
    await query('DELETE FROM document_sections WHERE document_id = ANY($1)', [docIds]);
    await query('DELETE FROM document_tags WHERE document_id = ANY($1)', [docIds]);
    await query('DELETE FROM documents WHERE id = ANY($1)', [docIds]);
    await query('COMMIT');
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }
  // Storage 파일 삭제 (트랜잭션 밖, 개별 실패 무시)
  if (isStorageAvailable()) {
    for (const docId of docIds) {
      try { await deleteDocumentFiles(docId); } catch (e) {
        console.warn(`[Documents] Storage 파일 삭제 실패 (문서 ${docId}):`, e.message);
      }
    }
  }
}

module.exports = async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, DELETE, OPTIONS' })) return;

  // 인증 체크 — 로그인 사용자 + 조직 스코핑
  const { user, orgId, error: authError } = requireAuth(req);
  if (authError) return res.status(401).json({ error: authError });

  try {
    // GET: 문서 목록 / 상세 조회 / 원본 다운로드
    if (req.method === 'GET') {
      const { id, category, download } = req.query;

      // 원본 파일 다운로드 — ?id=N&download=true
      // 원본 파일 미리보기 — ?id=N&download=preview
      if (id && (download === 'true' || download === 'preview')) {
        const orgClause = orgId !== null ? ' AND org_id = $2' : '';
        const orgParams = orgId !== null ? [id, orgId] : [id];
        const doc = await query(
          `SELECT storage_path, original_file, original_filename, original_mimetype
           FROM documents WHERE id = $1${orgClause}`, orgParams
        );
        if (doc.rows.length === 0) {
          return res.status(404).json({ error: '문서를 찾을 수 없습니다.' });
        }
        const row = doc.rows[0];

        // 방법 1: Supabase Storage (Signed URL)
        if (row.storage_path && isStorageAvailable()) {
          try {
            const signedUrl = await getSignedUrl(row.storage_path, 3600);
            // fetch 요청은 JSON으로, 브라우저 직접 접근은 리다이렉트
            if (req.headers.accept?.includes('application/json')) {
              return res.json({ url: signedUrl });
            }
            return res.redirect(signedUrl);
          } catch (storageErr) {
            console.warn(`[Documents] Storage URL 실패 (${row.storage_path}):`, storageErr.message);
            // Storage 실패 시 BYTEA 폴백 시도
          }
        }

        // 방법 2: 기존 BYTEA 폴백 (마이그레이션 전 데이터)
        if (row.original_file) {
          const mimetype = row.original_mimetype || 'application/octet-stream';
          res.setHeader('Content-Type', mimetype);
          if (download === 'true') {
            const filename = row.original_filename || 'download';
            res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
          } else {
            res.setHeader('Cache-Control', 'private, max-age=3600');
          }
          return res.send(row.original_file);
        }

        return res.status(404).json({ error: '원본 파일이 저장되어 있지 않습니다.' });
      }

      // 태그 목록 조회 — ?tags=all (조직별 격리)
      if (req.query.tags === 'all') {
        const { clause, params } = orgFilter(orgId, 't', 1);
        const tagWhere = clause ? `WHERE ${clause}` : '';
        const tagsResult = await query(
          `SELECT id, name, color, usage_count FROM tags t ${tagWhere} ORDER BY usage_count DESC, name`,
          params
        );
        return res.json({ tags: tagsResult.rows });
      }

      // 단건 조회 — 문서 메타 + 섹션 텍스트 + 태그 (조직별 격리)
      if (id) {
        const orgClause = orgId !== null ? ' AND org_id = $2' : '';
        const orgParams = orgId !== null ? [id, orgId] : [id];
        const doc = await query(
          `SELECT id, title, file_type, category, summary, keywords,
                  upload_date AS created_at, metadata, embedding_status,
                  original_filename, original_mimetype, file_size, storage_path, deleted_at
           FROM documents WHERE id = $1${orgClause}`, orgParams
        );
        if (doc.rows.length === 0) {
          return res.status(404).json({ error: '문서를 찾을 수 없습니다.' });
        }
        // 섹션 조회 (summary 컬럼 포함)
        const sections = await query(
          `SELECT id, section_type, section_index,
                  raw_text AS text, image_url, metadata, summary
           FROM document_sections
           WHERE document_id = $1
           ORDER BY section_index`, [id]
        );
        // 태그 조회
        const docTags = await query(
          `SELECT t.id, t.name, t.color
           FROM tags t
           JOIN document_tags dt ON t.id = dt.tag_id
           WHERE dt.document_id = $1
           ORDER BY t.name`, [id]
        );
        return res.json({
          document: doc.rows[0],
          sections: sections.rows,
          tags: docTags.rows,
        });
      }

      // 목록 조회 (카테고리/태그 필터 가능)
      // ?trash=true 이면 휴지통(삭제된 문서), 아니면 정상 문서만
      const isTrash = req.query.trash === 'true';
      const tag = req.query.tag || '';
      let sql = `
        SELECT d.id, d.title, d.file_type, d.category, d.summary,
               d.upload_date AS created_at, d.metadata,
               d.embedding_status, d.original_filename, d.file_size, d.storage_path,
               COALESCE(d.is_favorited, false) AS is_favorited,
               ${isTrash ? 'd.deleted_at,' : ''}
               COUNT(DISTINCT s.id) AS section_count,
               COALESCE(
                 (SELECT jsonb_agg(jsonb_build_object('id', tg.id, 'name', tg.name, 'color', tg.color) ORDER BY tg.name)
                  FROM document_tags dtg JOIN tags tg ON tg.id = dtg.tag_id
                  WHERE dtg.document_id = d.id),
                 '[]'::jsonb
               ) AS tags
        FROM documents d
        LEFT JOIN document_sections s ON s.document_id = d.id
      `;
      let params = [];
      let whereClauses = [isTrash ? 'd.deleted_at IS NOT NULL' : 'd.deleted_at IS NULL'];
      let paramIdx = 1;

      // 조직별 격리 — 슈퍼 어드민(orgId=null)은 전체 접근
      const { clause: orgClauseList, params: orgParamsList, nextIdx } = orgFilter(orgId, 'd', paramIdx);
      if (orgClauseList) {
        whereClauses.push(orgClauseList);
        params.push(...orgParamsList);
        paramIdx = nextIdx;
      }

      if (category && !isTrash) {
        whereClauses.push(`d.category = $${paramIdx}`);
        params.push(category);
        paramIdx++;
      }
      if (tag && !isTrash) {
        sql += ' JOIN document_tags dt ON dt.document_id = d.id JOIN tags t ON t.id = dt.tag_id';
        whereClauses.push(`t.name = $${paramIdx}`);
        params.push(tag);
        paramIdx++;
      }

      sql += ' WHERE ' + whereClauses.join(' AND ');
      sql += ` GROUP BY d.id ORDER BY ${isTrash ? 'd.deleted_at DESC' : 'COALESCE(d.is_favorited, false) DESC, d.upload_date DESC'}`;

      const docs = await query(sql, params);

      return res.json({ documents: docs.rows });
    }

    // POST: 문서 삭제
    if (req.method === 'POST') {
      const { action, id } = req.body;

      // 소프트 삭제 — deleted_at 타임스탬프 기록 (휴지통으로 이동)
      if (action === 'delete' && id) {
        const orgC = orgId !== null ? ' AND org_id = $2' : '';
        const orgP = orgId !== null ? [id, orgId] : [id];
        await query(`UPDATE documents SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL${orgC}`, orgP);
        return res.json({ success: true, message: '문서가 휴지통으로 이동되었습니다.' });
      }

      // 복구 — deleted_at을 NULL로 되돌림
      if (action === 'restore' && id) {
        const orgC = orgId !== null ? ' AND org_id = $2' : '';
        const orgP = orgId !== null ? [id, orgId] : [id];
        await query(`UPDATE documents SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL${orgC}`, orgP);
        return res.json({ success: true, message: '문서가 복구되었습니다.' });
      }

      // 영구 삭제 — 실제 데이터 제거 (휴지통에서만 가능)
      if (action === 'permanentDelete' && id) {
        const orgC = orgId !== null ? ' AND org_id = $2' : '';
        const orgP = orgId !== null ? [id, orgId] : [id];
        const check = await query(`SELECT id FROM documents WHERE id = $1 AND deleted_at IS NOT NULL${orgC}`, orgP);
        if (check.rows.length === 0) {
          return res.status(400).json({ error: '휴지통에 있는 문서만 영구 삭제할 수 있습니다.' });
        }
        await deleteDocumentPermanently(id, orgId);
        return res.json({ success: true, message: '문서가 영구 삭제되었습니다.' });
      }

      // 휴지통 비우기 — 트랜잭션 배치 삭제로 전체 처리
      if (action === 'emptyTrash') {
        const orgC = orgId !== null ? ' AND org_id = $1' : '';
        const orgP = orgId !== null ? [orgId] : [];
        const trashed = await query(`SELECT id FROM documents WHERE deleted_at IS NOT NULL${orgC}`, orgP);
        const docIds = trashed.rows.map(r => r.id);
        await deleteDocumentsBatch(docIds, orgId);
        return res.json({ success: true, message: `${docIds.length}개 문서가 영구 삭제되었습니다.`, count: docIds.length });
      }

      // 태그 추가 — { action: 'addTag', id: 문서ID, tagName: '태그명' }
      if (action === 'addTag' && id && req.body.tagName) {
        const tagName = req.body.tagName.trim();
        const color = req.body.color || '#6B7280';
        // 태그가 없으면 생성 (조직별 격리)
        const tagOrgC = orgId !== null ? ' AND org_id = $2' : ' AND org_id IS NULL';
        const tagOrgP = orgId !== null ? [tagName, orgId] : [tagName];
        let tagResult = await query(`SELECT id FROM tags WHERE name = $1${tagOrgC}`, tagOrgP);
        if (tagResult.rows.length === 0) {
          tagResult = await query(
            'INSERT INTO tags (name, color, org_id) VALUES ($1, $2, $3) RETURNING id',
            [tagName, color, orgId]
          );
        }
        const tagId = tagResult.rows[0].id;
        // 문서-태그 연결 (중복 무시)
        await query(
          'INSERT INTO document_tags (document_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [id, tagId]
        );
        // usage_count 갱신
        await query(
          'UPDATE tags SET usage_count = (SELECT COUNT(*) FROM document_tags WHERE tag_id = $1) WHERE id = $1',
          [tagId]
        );
        return res.json({ success: true, tagId, tagName });
      }

      // 태그 제거 — { action: 'removeTag', id: 문서ID, tagId: 태그ID }
      if (action === 'removeTag' && id && req.body.tagId) {
        const tagId = req.body.tagId;
        await query('DELETE FROM document_tags WHERE document_id = $1 AND tag_id = $2', [id, tagId]);
        // usage_count 갱신
        await query(
          'UPDATE tags SET usage_count = (SELECT COUNT(*) FROM document_tags WHERE tag_id = $1) WHERE id = $1',
          [tagId]
        );
        return res.json({ success: true });
      }

      // 메타 수정 — { action: 'updateMeta', id: 문서ID, title?, category? }
      if (action === 'updateMeta' && id) {
        const { title, category } = req.body;
        if (!title && !category) {
          return res.status(400).json({ error: '수정할 항목(title 또는 category)이 필요합니다.' });
        }
        const sets = [];
        const params = [];
        let idx = 1;
        if (title !== undefined) {
          sets.push(`title = $${idx}`);
          params.push(title.trim());
          idx++;
        }
        if (category !== undefined) {
          sets.push(`category = $${idx}`);
          params.push(category.trim());
          idx++;
        }
        params.push(id);
        let updateWhere = `WHERE id = $${idx} AND deleted_at IS NULL`;
        if (orgId !== null) {
          idx++;
          updateWhere += ` AND org_id = $${idx}`;
          params.push(orgId);
        }
        const result = await query(
          `UPDATE documents SET ${sets.join(', ')} ${updateWhere} RETURNING id, title, category`,
          params
        );
        if (result.rows.length === 0) return res.status(404).json({ error: '문서를 찾을 수 없습니다.' });
        return res.json({ success: true, document: result.rows[0] });
      }

      // 임베딩 재생성 — { action: 'rebuildEmbeddings', id: 문서ID }
      if (action === 'rebuildEmbeddings' && id) {
        // 소유권 확인
        const orgC = orgId !== null ? ' AND org_id = $2' : '';
        const orgP = orgId !== null ? [id, orgId] : [id];
        const ownerCheck = await query(`SELECT id FROM documents WHERE id = $1${orgC}`, orgP);
        if (ownerCheck.rows.length === 0) return res.status(404).json({ error: '문서를 찾을 수 없습니다.' });

        const { createEmbeddingsForDocument } = require('../lib/embeddings');
        // 상태를 pending으로 변경
        await query('UPDATE documents SET embedding_status = $1 WHERE id = $2', ['pending', id]);
        try {
          const totalChunks = await createEmbeddingsForDocument({ query }, id);
          await query('UPDATE documents SET embedding_status = $1 WHERE id = $2', ['done', id]);
          console.log(`[Embeddings] 문서 ${id} 임베딩 재생성 완료: ${totalChunks}개 청크`);
          return res.json({ success: true, documentId: id, totalChunks, embedding_status: 'done' });
        } catch (embErr) {
          await query('UPDATE documents SET embedding_status = $1 WHERE id = $2', ['failed', id]);
          console.error(`[Embeddings] 문서 ${id} 재생성 실패:`, embErr.message);
          return res.status(500).json({ error: `임베딩 재생성 실패: ${embErr.message}` });
        }
      }

      // 즐겨찾기 토글 — { action: 'toggleFavorite', id: 문서ID }
      if (action === 'toggleFavorite' && id) {
        const orgC = orgId !== null ? ' AND org_id = $2' : '';
        const orgP = orgId !== null ? [id, orgId] : [id];
        const result = await query(
          `UPDATE documents SET is_favorited = NOT COALESCE(is_favorited, false) WHERE id = $1${orgC} RETURNING is_favorited`,
          orgP
        );
        if (result.rows.length === 0) return res.status(404).json({ error: '문서를 찾을 수 없습니다.' });
        return res.json({ success: true, is_favorited: result.rows[0].is_favorited });
      }

      // AI 분석 실행 — { action: 'analyze', id: 문서ID }
      if (action === 'analyze' && id) {
        const { analyzeDocument, analyzeSections } = require('../lib/doc-analyzer');
        const { generateEnrichedEmbeddings } = require('../lib/embeddings');

        // 기존 요약 캐시 무효화 (재분석이므로 이전 요약 제거)
        await invalidateSummaryCache(query, id);

        // 문서 + 섹션 조회 (조직별 격리)
        const orgC = orgId !== null ? ' AND org_id = $2' : '';
        const orgP = orgId !== null ? [id, orgId] : [id];
        const doc = await query(
          `SELECT id, title, category, summary FROM documents WHERE id = $1${orgC}`, orgP
        );
        if (doc.rows.length === 0) return res.status(404).json({ error: '문서를 찾을 수 없습니다.' });
        const docRow = doc.rows[0];

        const sections = await query(
          'SELECT id, raw_text, metadata FROM document_sections WHERE document_id = $1 ORDER BY section_index',
          [id]
        );

        // 전체 텍스트 합치기
        const fullText = sections.rows.map(s => s.raw_text || '').join('\n\n');

        // 1) 문서 분석 (요약/키워드/태그)
        console.log(`[Analyze] 문서 ${id} AI 분석 시작...`);
        const analysis = await analyzeDocument(fullText, docRow.title, docRow.category);

        // 2) 문서 요약/키워드 저장
        await query(
          'UPDATE documents SET summary = $1, keywords = $2 WHERE id = $3',
          [analysis.summary, analysis.keywords, id]
        );

        // 3) 태그 자동 추가 (조직별 격리)
        for (const tagName of analysis.tags) {
          const tOrgC = orgId !== null ? ' AND org_id = $2' : ' AND org_id IS NULL';
          const tOrgP = orgId !== null ? [tagName, orgId] : [tagName];
          let tagResult = await query(`SELECT id FROM tags WHERE name = $1${tOrgC}`, tOrgP);
          if (tagResult.rows.length === 0) {
            tagResult = await query(
              'INSERT INTO tags (name, org_id) VALUES ($1, $2) RETURNING id', [tagName, orgId]
            );
          }
          await query(
            'INSERT INTO document_tags (document_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, tagResult.rows[0].id]
          );
          await query(
            'UPDATE tags SET usage_count = (SELECT COUNT(*) FROM document_tags WHERE tag_id = $1) WHERE id = $1',
            [tagResult.rows[0].id]
          );
        }

        // 4) 섹션별 요약 생성
        const sectionSummaries = await analyzeSections(sections.rows);
        for (const [sectionId, summary] of sectionSummaries) {
          await query(
            'UPDATE document_sections SET summary = $1 WHERE id = $2',
            [summary, sectionId]
          );
        }

        // 5) 기존 청크 삭제 후 enriched 임베딩 재생성
        const sectionIds = sections.rows.map(s => s.id);
        if (sectionIds.length > 0) {
          await query('DELETE FROM document_chunks WHERE section_id = ANY($1)', [sectionIds]);
        }

        // 태그명 배열 조회
        const tagNames = await query(
          `SELECT t.name FROM tags t JOIN document_tags dt ON t.id = dt.tag_id WHERE dt.document_id = $1`,
          [id]
        );
        const tagList = tagNames.rows.map(r => r.name);

        const totalChunks = await generateEnrichedEmbeddings(
          { query },
          id,
          {
            title: docRow.title,
            summary: analysis.summary,
            category: docRow.category,
            tags: tagList,
            keywords: analysis.keywords,
          }
        );

        console.log(`[Analyze] 문서 ${id} 분석 완료: ${totalChunks}개 enriched 청크`);

        return res.json({
          success: true,
          documentId: id,
          summary: analysis.summary,
          keywords: analysis.keywords,
          tags: analysis.tags,
          sectionSummaries: sectionSummaries.size,
          totalChunks,
        });
      }

      return res.status(400).json({ error: '잘못된 요청입니다.' });
    }

    res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  } catch (err) {
    sendError(res, err, '[Documents]');
  }
};
