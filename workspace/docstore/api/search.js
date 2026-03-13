// 텍스트 검색 + 벡터 유사도 검색 + 하이브리드 검색 API
// GET /api/search?q=검색어&type=text|vector|hybrid&limit=10&chapter=제1장&docId=5
const { query } = require('../lib/db');
const { generateEmbedding } = require('../lib/embeddings');
const { hybridSearch, deduplicateParentChunks } = require('../lib/hybrid-search');
const { requireAuth, orgFilter } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { checkRateLimit } = require('../lib/rate-limit');
const { escapeIlike } = require('../lib/input-sanitizer');
const { sendError } = require('../lib/error-handler');
const { buildTsquery } = require('../lib/korean-tokenizer');

module.exports = async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  }

  // 인증 체크 (조직별 격리)
  const { user, orgId, error: authError } = requireAuth(req);
  if (authError) return res.status(401).json({ error: authError });

  if (await checkRateLimit(req, res, 'search')) return;

  // 자동완성 서제스트 모드 (조직별 격리)
  // 문서 제목 + 섹션 텍스트 양쪽에서 매칭하여 최대 10건 반환
  if (req.query.suggest !== undefined) {
    const prefix = (req.query.suggest || '').trim();
    if (prefix.length < 1) return res.json({ suggestions: [] });
    const escaped = escapeIlike(prefix);
    const { clause: sugOrgC, params: sugOrgP, nextIdx: sugNextIdx } = orgFilter(orgId, 'd', 2);
    const sugOrgWhere = sugOrgC ? ` AND ${sugOrgC}` : '';

    // 1) 문서 제목 매칭 (최대 5건)
    const docResult = await query(
      `SELECT DISTINCT title AS text, 'document' AS type, category
       FROM documents d
       WHERE deleted_at IS NULL AND title ILIKE $1${sugOrgWhere}
       ORDER BY title
       LIMIT 5`,
      [`%${escaped}%`, ...sugOrgP]
    );

    // 2) 섹션(조문/본문) 매칭 — 문서 제목과 중복되지 않는 것만 (최대 5건)
    const secResult = await query(
      `SELECT DISTINCT ON (s.raw_text)
         LEFT(s.raw_text, 80) AS text, 'section' AS type,
         d.title AS doc_title, s.metadata->>'label' AS label
       FROM document_sections s
       JOIN documents d ON d.id = s.document_id
       WHERE d.deleted_at IS NULL AND s.raw_text ILIKE $1${sugOrgWhere.replace(/\bd\./g, 'd.')}
       ORDER BY s.raw_text
       LIMIT 5`,
      [`%${escaped}%`, ...sugOrgP]
    );

    const suggestions = [
      ...docResult.rows,
      ...secResult.rows,
    ];
    return res.json({ suggestions });
  }

  const q = req.query.q;
  const type = req.query.type || 'text';
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  // 필터 옵션
  const chapter = req.query.chapter || '';  // 장 필터 (예: "제1장")
  const docId = req.query.docId || '';      // 특정 문서만 검색 (단일)
  const docIds = req.query.docIds ? req.query.docIds.split(',').map(id => parseInt(id.trim(), 10)).filter(Boolean) : []; // 복수 문서
  const tag = req.query.tag || '';          // 태그 필터

  if (!q || q.trim().length === 0) {
    return res.status(400).json({ error: '검색어(q)가 필요합니다.' });
  }

  try {
    // 형태소 분석 사용 여부 (morpheme=true)
    const useMorpheme = req.query.morpheme === 'true';
    // Parent Document Retriever 모드 (parentRetriever=true)
    const useParentRetriever = req.query.parentRetriever === 'true';

    if (type === 'hybrid') {
      // ── 하이브리드 검색 (벡터 + 전문검색 + RRF 합산) ──
      const resolvedIds = docIds.length > 0 ? docIds : docId ? [parseInt(docId)] : [];
      let results = await hybridSearch(query, q.trim(), {
        topK: useParentRetriever ? limit * 3 : limit, // 부모 모드: 후처리 중복제거를 위해 넉넉히
        docIds: resolvedIds,
        orgId,
        useMorpheme,
      });

      // Parent Document Retriever: 동일 부모 청크 중복 제거
      if (useParentRetriever) {
        results = deduplicateParentChunks(results, limit);
      }

      // chapter/tag 필터는 후처리 (hybrid-search 내부에서는 docIds만 처리)
      let filtered = results;
      if (chapter) {
        const chLower = chapter.toLowerCase();
        filtered = filtered.filter(row => {
          const meta = row.section_metadata || {};
          return (meta.chapter || '').toLowerCase().includes(chLower);
        });
      }
      if (tag) {
        // 태그 필터는 추가 쿼리 필요 → 간단히 후처리 생략 (docIds 필터로 대체 권장)
      }

      return res.json({
        type: 'hybrid',
        query: q,
        count: filtered.length,
        parentRetriever: useParentRetriever || undefined,
        results: filtered.map(row => {
          const meta = row.section_metadata || {};
          return {
            chunkId: row.chunk_id,
            chunkText: row.chunk_text,
            headline: row.headline || '',
            rrfScore: parseFloat(row.rrf_score).toFixed(6),
            similarity: row.similarity ? parseFloat(row.similarity).toFixed(4) : null,
            vectorRank: row.vector_rank,
            ftsRank: row.fts_rank,
            sectionType: row.section_type,
            documentId: row.document_id,
            documentTitle: row.document_title,
            category: row.category,
            label: meta.label || '',
            chapter: meta.chapter || '',
            section: meta.section || '',
            articleTitle: meta.articleTitle || '',
          };
        }),
      });
    } else if (type === 'vector') {
      // ── 벡터 유사도 검색 ──
      const embedding = await generateEmbedding(q.trim());
      const vecStr = `[${embedding.join(',')}]`;

      // 필터 조건 동적 생성
      let filterClauses = ['dc.embedding IS NOT NULL', 'd.deleted_at IS NULL'];
      let params = [vecStr];
      let paramIdx = 2;

      // 조직별 격리
      const { clause: vecOrgC, params: vecOrgP, nextIdx: vecNextIdx } = orgFilter(orgId, 'd', paramIdx);
      if (vecOrgC) {
        filterClauses.push(vecOrgC);
        params.push(...vecOrgP);
        paramIdx = vecNextIdx;
      }

      const resolvedIds1 = docIds.length > 0 ? docIds : docId ? [parseInt(docId)] : [];
      if (resolvedIds1.length > 0) {
        filterClauses.push(`ds.document_id = ANY($${paramIdx})`);
        params.push(resolvedIds1);
        paramIdx++;
      }
      if (chapter) {
        filterClauses.push(`ds.metadata->>'chapter' ILIKE $${paramIdx} ESCAPE '\\'`);
        params.push(`%${escapeIlike(chapter)}%`);
        paramIdx++;
      }
      if (tag) {
        filterClauses.push(`EXISTS (
          SELECT 1 FROM document_tags dt
          JOIN tags t ON t.id = dt.tag_id
          WHERE dt.document_id = ds.document_id AND t.name = $${paramIdx}
        )`);
        params.push(tag);
        paramIdx++;
      }
      params.push(limit);

      const result = await query(
        `SELECT
           dc.id AS chunk_id,
           dc.chunk_text,
           dc.enriched_text,
           dc.chunk_index,
           dc.section_id,
           ds.section_type,
           ds.section_index,
           ds.summary AS section_summary,
           ds.metadata AS section_metadata,
           ds.document_id,
           d.title AS document_title,
           d.category,
           d.summary AS document_summary,
           1 - (dc.embedding <=> $1::vector) AS similarity
         FROM document_chunks dc
         JOIN document_sections ds ON dc.section_id = ds.id
         JOIN documents d ON ds.document_id = d.id
         WHERE ${filterClauses.join(' AND ')}
         ORDER BY dc.embedding <=> $1::vector
         LIMIT $${paramIdx}`,
        params
      );

      res.json({
        type: 'vector',
        query: q,
        count: result.rows.length,
        results: result.rows.map(row => {
          const meta = row.section_metadata || {};
          return {
            chunkId: row.chunk_id,
            chunkText: row.chunk_text,
            chunkIndex: row.chunk_index,
            similarity: parseFloat(row.similarity).toFixed(4),
            sectionId: row.section_id,
            sectionType: row.section_type,
            sectionIndex: row.section_index,
            sectionSummary: row.section_summary || '',
            documentId: row.document_id,
            documentTitle: row.document_title,
            documentSummary: row.document_summary || '',
            category: row.category,
            // 계층 라벨 정보
            label: meta.label || '',
            chapter: meta.chapter || '',
            section: meta.section || '',
            articleTitle: meta.articleTitle || '',
          };
        }),
      });
    } else {
      // ── 텍스트 검색 (FTS tsvector 기반 + ILIKE fallback) ──
      const trimmed = q.trim();

      // 검색어를 tsquery로 변환 (공백 분리 → 접두사 매칭 OR 연결)
      const words = trimmed.split(/\s+/).filter(w => w.length > 0);
      const canUseFTS = words.length > 0 && words.some(w => w.length >= 2);

      // 공통 필터 조건
      const resolvedIds2 = docIds.length > 0 ? docIds : docId ? [parseInt(docId)] : [];

      if (canUseFTS) {
        // ── FTS 검색: 한국어 토크나이저 + ts_rank_cd + ts_headline ──
        const { tsquery: tsqueryStr, expandedTerms } = buildTsquery(trimmed, {
          mode: 'or',
          useNgrams: true,
          useSynonyms: true,
        });
        let filterClauses = ['ds.fts_vector IS NOT NULL', 'd.deleted_at IS NULL'];
        let params = [tsqueryStr];
        let paramIdx = 2;

        // 조직별 격리
        const { clause: ftsOrgC, params: ftsOrgP, nextIdx: ftsNextIdx } = orgFilter(orgId, 'd', paramIdx);
        if (ftsOrgC) {
          filterClauses.push(ftsOrgC);
          params.push(...ftsOrgP);
          paramIdx = ftsNextIdx;
        }

        if (resolvedIds2.length > 0) {
          filterClauses.push(`ds.document_id = ANY($${paramIdx})`);
          params.push(resolvedIds2);
          paramIdx++;
        }
        if (chapter) {
          filterClauses.push(`ds.metadata->>'chapter' ILIKE $${paramIdx} ESCAPE '\\'`);
          params.push(`%${escapeIlike(chapter)}%`);
          paramIdx++;
        }
        if (tag) {
          filterClauses.push(`EXISTS (
            SELECT 1 FROM document_tags dt
            JOIN tags t ON t.id = dt.tag_id
            WHERE dt.document_id = ds.document_id AND t.name = $${paramIdx}
          )`);
          params.push(tag);
          paramIdx++;
        }
        params.push(limit);

        const result = await query(
          `SELECT
             ds.id AS section_id,
             ds.section_type,
             ds.section_index,
             ds.raw_text,
             ds.summary AS section_summary,
             ds.metadata AS section_metadata,
             ds.document_id,
             d.title AS document_title,
             d.category,
             d.summary AS document_summary,
             ts_rank_cd(ds.fts_vector, to_tsquery('simple', $1), 32) AS fts_score,
             ts_headline('simple', ds.raw_text, to_tsquery('simple', $1),
               'StartSel=<mark>, StopSel=</mark>, MaxWords=60, MinWords=20, MaxFragments=2'
             ) AS headline
           FROM document_sections ds
           JOIN documents d ON ds.document_id = d.id
           WHERE ${filterClauses.join(' AND ')}
             AND ds.fts_vector @@ to_tsquery('simple', $1)
           ORDER BY fts_score DESC, ds.document_id, ds.section_index
           LIMIT $${paramIdx}`,
          params
        );

        res.json({
          type: 'fts',
          query: q,
          count: result.rows.length,
          expandedTerms: expandedTerms.length > 0 ? expandedTerms : undefined,
          results: result.rows.map(row => {
            const meta = row.section_metadata || {};
            return {
              sectionId: row.section_id,
              sectionType: row.section_type,
              sectionIndex: row.section_index,
              rawText: row.raw_text,
              headline: row.headline || '',
              ftsScore: parseFloat(row.fts_score).toFixed(6),
              sectionSummary: row.section_summary || '',
              documentId: row.document_id,
              documentTitle: row.document_title,
              documentSummary: row.document_summary || '',
              category: row.category,
              label: meta.label || '',
              chapter: meta.chapter || '',
              section: meta.section || '',
              articleTitle: meta.articleTitle || '',
            };
          }),
        });
      } else {
        // ── ILIKE fallback (1글자 검색어 등 FTS 불가 시) ──
        let filterClauses = [`ds.raw_text ILIKE $1 ESCAPE '\\'`, 'd.deleted_at IS NULL'];
        let params = [`%${escapeIlike(trimmed)}%`];
        let paramIdx = 2;

        // 조직별 격리
        const { clause: ilikeOrgC, params: ilikeOrgP, nextIdx: ilikeNextIdx } = orgFilter(orgId, 'd', paramIdx);
        if (ilikeOrgC) {
          filterClauses.push(ilikeOrgC);
          params.push(...ilikeOrgP);
          paramIdx = ilikeNextIdx;
        }

        if (resolvedIds2.length > 0) {
          filterClauses.push(`ds.document_id = ANY($${paramIdx})`);
          params.push(resolvedIds2);
          paramIdx++;
        }
        if (chapter) {
          filterClauses.push(`ds.metadata->>'chapter' ILIKE $${paramIdx} ESCAPE '\\'`);
          params.push(`%${escapeIlike(chapter)}%`);
          paramIdx++;
        }
        if (tag) {
          filterClauses.push(`EXISTS (
            SELECT 1 FROM document_tags dt
            JOIN tags t ON t.id = dt.tag_id
            WHERE dt.document_id = ds.document_id AND t.name = $${paramIdx}
          )`);
          params.push(tag);
          paramIdx++;
        }
        params.push(limit);

        const result = await query(
          `SELECT
             ds.id AS section_id,
             ds.section_type,
             ds.section_index,
             ds.raw_text,
             ds.summary AS section_summary,
             ds.metadata AS section_metadata,
             ds.document_id,
             d.title AS document_title,
             d.category,
             d.summary AS document_summary
           FROM document_sections ds
           JOIN documents d ON ds.document_id = d.id
           WHERE ${filterClauses.join(' AND ')}
           ORDER BY ds.document_id, ds.section_index
           LIMIT $${paramIdx}`,
          params
        );

        res.json({
          type: 'text',
          query: q,
          count: result.rows.length,
          results: result.rows.map(row => {
            const meta = row.section_metadata || {};
            return {
              sectionId: row.section_id,
              sectionType: row.section_type,
              sectionIndex: row.section_index,
              rawText: row.raw_text,
              sectionSummary: row.section_summary || '',
              documentId: row.document_id,
              documentTitle: row.document_title,
              documentSummary: row.document_summary || '',
              category: row.category,
              label: meta.label || '',
              chapter: meta.chapter || '',
              section: meta.section || '',
              articleTitle: meta.articleTitle || '',
            };
          }),
        });
      }
    }
  } catch (err) {
    sendError(res, err, '[Search]');
  }
};
