// 멀티포맷 파일 업로드 + 텍스트 추출 + DB 저장 API
//
// 지원 형식: PDF, TXT, MD, DOCX, XLSX, CSV, JSON, 이미지(JPG/PNG)
//
// 처리 흐름:
// 1. 파일 수신 (multipart/form-data)
// 2. 파일 형식 감지 → 형식별 추출기 호출
// 3. 선택한 옵션에 따라 섹션 분할
// 4. documents + document_sections 테이블에 저장
// 5. 비동기 임베딩 생성
const multer = require('multer');
const { extractFromPdf } = require('../lib/pdf-extractor');
const { detectFileType, extractFromFile } = require('../lib/text-extractor');
const { generateEnrichedEmbeddings } = require('../lib/embeddings');
const { analyzeDocument, analyzeSections } = require('../lib/doc-analyzer');
const { query } = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { checkRateLimit } = require('../lib/rate-limit');

// multer: 메모리 스토리지 (Vercel 서버리스 호환)
// 모든 파일 형식 허용
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 최대 50MB
});

module.exports = async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  }

  // 인증 체크
  const { error: authError } = requireAdmin(req);
  if (authError) return res.status(401).json({ error: authError });

  // Rate Limit 체크
  if (checkRateLimit(req, res, 'upload')) return;

  try {
    // multipart/form-data 처리 (multer)
    await new Promise((resolve, reject) => {
      upload.single('file')(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // 파일 버퍼 + 메타 추출
    let fileBuffer;
    let filename;
    let mimetype;
    let title;
    let category;
    let sectionType;
    let customDelimiter;
    let extraOptions = {};

    if (req.file) {
      fileBuffer = req.file.buffer;
      filename = req.file.originalname;
      mimetype = req.file.mimetype;
      title = req.body.title || filename.replace(/\.[^.]+$/, '');
      category = req.body.category || '기타';
      sectionType = req.body.sectionType || 'page';
      customDelimiter = req.body.customDelimiter;

      // 형식별 추가 옵션 (프론트에서 전달)
      if (req.body.contentColumn) extraOptions.contentColumn = req.body.contentColumn;
      if (req.body.contentField) extraOptions.contentField = req.body.contentField;
      if (req.body.contentType) extraOptions.contentType = req.body.contentType;
      if (req.body.sheetIndex) extraOptions.sheetIndex = parseInt(req.body.sheetIndex) || 0;
    } else if (req.body && req.body.fileBase64) {
      // JSON base64로 업로드된 경우 (CLI 스크립트용)
      fileBuffer = Buffer.from(req.body.fileBase64, 'base64');
      filename = req.body.filename || 'file.pdf';
      mimetype = req.body.mimetype || 'application/pdf';
      title = req.body.title || '제목 없음';
      category = req.body.category || '기타';
      sectionType = req.body.sectionType || 'page';
      customDelimiter = req.body.customDelimiter;
    } else {
      return res.status(400).json({ error: '파일이 필요합니다.' });
    }

    // 파일 형식 감지
    const fileType = detectFileType(filename, mimetype);
    console.log(`[Upload] 파일: ${filename} → 형식: ${fileType} (${sectionType} 단위)`);

    if (fileType === 'unknown') {
      return res.status(400).json({ error: `지원하지 않는 파일 형식입니다: ${filename}` });
    }

    // ── 형식별 텍스트 추출 ──
    let extracted;

    if (fileType === 'pdf') {
      // PDF: 기존 pdf-extractor 사용
      extracted = await extractFromPdf(fileBuffer, { sectionType, customDelimiter });
    } else {
      // 그 외: text-extractor 사용
      const options = {
        sectionType,
        customDelimiter,
        mimetype,
        ...extraOptions,
      };
      extracted = await extractFromFile(fileBuffer, fileType, options);
    }

    const sections = extracted.sections || [];
    if (sections.length === 0) {
      return res.status(400).json({ error: '추출된 내용이 없습니다.' });
    }

    // ── DB 저장 ──
    // 1) documents 테이블 (원본 파일 포함)
    const docResult = await query(
      `INSERT INTO documents (title, file_type, category, metadata, original_file, original_filename, original_mimetype, file_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        title,
        fileType,
        category,
        JSON.stringify({
          originalFilename: filename,
          totalPages: extracted.totalPages || null,
          sectionType: extracted.sectionType || sectionType,
          sectionCount: sections.length,
          columns: extracted.columns || null,
          fields: extracted.fields || null,
        }),
        fileBuffer,       // 원본 파일 바이너리 (BYTEA)
        filename,         // 원본 파일명
        mimetype,         // MIME 타입
        fileBuffer.length, // 파일 크기 (bytes)
      ]
    );
    const documentId = docResult.rows[0].id;

    // 2) document_sections 테이블
    for (const section of sections) {
      await query(
        `INSERT INTO document_sections (document_id, section_type, section_index, raw_text, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          documentId,
          section.sectionType,
          section.sectionIndex,
          section.text,
          JSON.stringify(section.metadata || {}),
        ]
      );
    }

    console.log(`[Upload] 저장 완료: 문서 ID ${documentId}, ${sections.length}개 섹션`);

    // 3) AI 분석 + enriched 임베딩 생성
    const embeddingPromise = (async () => {
      try {
        // 전체 텍스트 합치기
        const fullText = sections.map(s => s.text || '').join('\n\n');

        // AI 문서 분석 (요약/키워드/태그 생성)
        let analysis = { summary: '', keywords: [], tags: [] };
        try {
          analysis = await analyzeDocument(fullText, title, category);
          // 문서 요약/키워드 저장
          if (analysis.summary || analysis.keywords.length > 0) {
            await query(
              'UPDATE documents SET summary = $1, keywords = $2 WHERE id = $3',
              [analysis.summary, analysis.keywords, documentId]
            );
          }
          // 태그 자동 추가
          for (const tagName of analysis.tags) {
            let tagResult = await query('SELECT id FROM tags WHERE name = $1', [tagName]);
            if (tagResult.rows.length === 0) {
              tagResult = await query('INSERT INTO tags (name) VALUES ($1) RETURNING id', [tagName]);
            }
            await query(
              'INSERT INTO document_tags (document_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [documentId, tagResult.rows[0].id]
            );
            await query(
              'UPDATE tags SET usage_count = (SELECT COUNT(*) FROM document_tags WHERE tag_id = $1) WHERE id = $1',
              [tagResult.rows[0].id]
            );
          }
          console.log(`[Upload] AI 분석 완료: 요약 ${analysis.summary.length}자, 태그 ${analysis.tags.length}개`);
        } catch (analyzeErr) {
          console.error(`[Upload] AI 분석 실패 (문서 ${documentId}):`, analyzeErr.message);
        }

        // 섹션별 요약 생성
        try {
          const savedSections = await query(
            'SELECT id, raw_text, metadata FROM document_sections WHERE document_id = $1 ORDER BY id',
            [documentId]
          );
          const sectionSummaries = await analyzeSections(savedSections.rows);
          for (const [sectionId, summary] of sectionSummaries) {
            await query('UPDATE document_sections SET summary = $1 WHERE id = $2', [summary, sectionId]);
          }
        } catch (secErr) {
          console.error(`[Upload] 섹션 요약 실패 (문서 ${documentId}):`, secErr.message);
        }

        // enriched 임베딩 생성
        const totalChunks = await generateEnrichedEmbeddings(
          { query },
          documentId,
          {
            title,
            summary: analysis.summary,
            category,
            tags: analysis.tags,
            keywords: analysis.keywords,
          }
        );
        console.log(`[Upload] enriched 임베딩 완료: 문서 ${documentId}, ${totalChunks}개 청크`);
      } catch (embErr) {
        await query(`UPDATE documents SET embedding_status = 'failed' WHERE id = $1`, [documentId]).catch(() => {});
        console.error(`[Upload] 임베딩 실패 (문서 ID ${documentId}):`, embErr.message);
      }
    })();

    // Vercel에서는 응답 전 임베딩 완료 대기
    if (process.env.VERCEL) {
      await embeddingPromise;
    }

    res.json({
      success: true,
      documentId,
      title,
      category,
      fileType,
      totalPages: extracted.totalPages || null,
      sectionCount: sections.length,
      sectionType: extracted.sectionType || sectionType,
      // 프론트에서 열/필드 선택 UI 용
      columns: extracted.columns || null,
      fields: extracted.fields || null,
    });
  } catch (err) {
    console.error('[Upload] API 에러:', err);
    res.status(500).json({ error: err.message });
  }
};
