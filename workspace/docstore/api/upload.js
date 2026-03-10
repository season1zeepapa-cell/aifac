// 멀티포맷 파일 업로드 + 텍스트 추출 + DB 저장 API
// SSE(Server-Sent Events)로 실시간 진행 상황 전송
//
// 지원 형식: PDF, TXT, MD, DOCX, XLSX, CSV, JSON, 이미지(JPG/PNG)
//
// 처리 흐름 (각 단계가 SSE로 전송됨):
// 1. 파일 수신 → 2. 텍스트 추출 → 3. DB 저장 → 4. 임베딩 생성 → 5. 완료
const path = require('path');
const multer = require('multer');
const { extractFromPdf } = require('../lib/pdf-extractor');
const { detectFileType, extractFromFile } = require('../lib/text-extractor');
const { chunkText, generateEmbeddings } = require('../lib/embeddings');
const { query } = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { checkRateLimit } = require('../lib/rate-limit');
const { uploadFile, isStorageAvailable } = require('../lib/storage');
const { sanitizeFilename } = require('../lib/input-sanitizer');
const { initSSE } = require('../lib/sse');

// 허용 MIME 타입 화이트리스트
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'text/plain', 'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv', 'application/json',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
]);

// multer: 메모리 스토리지 + MIME 화이트리스트
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 최대 50MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`허용되지 않는 파일 형식입니다: ${file.mimetype}`));
    }
  },
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

  // SSE 초기화 (Accept: text/event-stream이면 SSE, 아니면 기존 JSON)
  const wantsSSE = (req.headers.accept || '').includes('text/event-stream');
  let sse;
  if (wantsSSE) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    sse = {
      isSSE: true,
      send(step, data = {}) {
        res.write(`event: progress\ndata: ${JSON.stringify({ step, ...data })}\n\n`);
      },
      done(result) {
        res.write(`event: done\ndata: ${JSON.stringify({ step: 'done', ...result })}\n\n`);
        res.end();
      },
      error(message) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
        res.end();
      },
    };
  } else {
    sse = {
      isSSE: false,
      send() {},
      done(result) { res.json(result); },
      error(message, code = 500) { res.status(code).json({ error: message }); },
    };
  }

  try {
    sse.send('receiving', { message: '파일 수신 중...', progress: 5 });

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
      filename = sanitizeFilename(req.file.originalname);
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
      fileBuffer = Buffer.from(req.body.fileBase64, 'base64');
      filename = sanitizeFilename(req.body.filename || 'file.pdf');
      mimetype = req.body.mimetype || 'application/pdf';
      title = req.body.title || '제목 없음';
      category = req.body.category || '기타';
      sectionType = req.body.sectionType || 'page';
      customDelimiter = req.body.customDelimiter;
    } else {
      return sse.error('파일이 필요합니다.', 400);
    }

    // 파일 형식 감지
    const fileType = detectFileType(filename, mimetype);
    console.log(`[Upload] 파일: ${filename} → 형식: ${fileType} (${sectionType} 단위)`);

    if (fileType === 'unknown') {
      return sse.error(`지원하지 않는 파일 형식입니다: ${filename}`, 400);
    }

    // ── 형식별 텍스트 추출 ──
    sse.send('extracting', { message: '텍스트 추출 중...', progress: 15 });

    let extracted;
    if (fileType === 'pdf') {
      extracted = await extractFromPdf(fileBuffer, { sectionType, customDelimiter });
    } else {
      const options = { sectionType, customDelimiter, mimetype, ...extraOptions };
      extracted = await extractFromFile(fileBuffer, fileType, options);
    }

    const sections = extracted.sections || [];
    if (sections.length === 0) {
      return sse.error('추출된 내용이 없습니다.', 400);
    }

    sse.send('extracted', {
      message: `${sections.length}개 섹션 추출 완료`,
      progress: 30,
      sectionCount: sections.length,
    });

    // ── DB 저장 ──
    sse.send('saving', { message: 'DB 저장 중...', progress: 35 });

    const metadata = JSON.stringify({
      originalFilename: filename,
      totalPages: extracted.totalPages || null,
      sectionType: extracted.sectionType || sectionType,
      sectionCount: sections.length,
      columns: extracted.columns || null,
      fields: extracted.fields || null,
    });

    const docResult = await query(
      `INSERT INTO documents (title, file_type, category, metadata, original_filename, original_mimetype, file_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [title, fileType, category, metadata, filename, mimetype, fileBuffer.length]
    );
    const documentId = docResult.rows[0].id;

    // 원본 파일을 Supabase Storage에 업로드
    if (isStorageAvailable()) {
      try {
        sse.send('storage', { message: '파일 저장소 업로드 중...', progress: 40 });
        const storagePath = await uploadFile(fileBuffer, documentId, filename, mimetype);
        await query('UPDATE documents SET storage_path = $1 WHERE id = $2', [storagePath, documentId]);
      } catch (storageErr) {
        console.warn(`[Upload] Storage 업로드 실패 (문서 ${documentId}):`, storageErr.message);
      }
    }

    // document_sections 저장
    for (const section of sections) {
      await query(
        `INSERT INTO document_sections (document_id, section_type, section_index, raw_text, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [documentId, section.sectionType, section.sectionIndex, section.text, JSON.stringify(section.metadata || {})]
      );
    }

    sse.send('saved', { message: 'DB 저장 완료', progress: 50, documentId });
    console.log(`[Upload] 저장 완료: 문서 ID ${documentId}, ${sections.length}개 섹션`);

    // ── 임베딩 생성 ──
    sse.send('embedding', { message: '임베딩 생성 시작...', progress: 55 });

    try {
      let totalChunks = 0;
      const savedSections = await query(
        'SELECT id, raw_text FROM document_sections WHERE document_id = $1 ORDER BY id',
        [documentId]
      );

      const validSections = savedSections.rows.filter(s => s.raw_text && s.raw_text.trim().length > 0);

      for (let si = 0; si < validSections.length; si++) {
        const section = validSections[si];
        const chunks = chunkText(section.raw_text);
        if (chunks.length === 0) continue;

        const embeddings = await generateEmbeddings(chunks);
        for (let i = 0; i < chunks.length; i++) {
          const vecStr = `[${embeddings[i].join(',')}]`;
          await query(
            `INSERT INTO document_chunks (section_id, chunk_text, embedding, chunk_index)
             VALUES ($1, $2, $3::vector, $4)`,
            [section.id, chunks[i], vecStr, i]
          );
        }
        totalChunks += chunks.length;

        // 임베딩 진행률: 55% ~ 95% 범위
        const embProgress = 55 + Math.round(((si + 1) / validSections.length) * 40);
        sse.send('embedding', {
          message: `임베딩 생성 중... (${si + 1}/${validSections.length} 섹션, ${totalChunks}개 청크)`,
          progress: embProgress,
          current: si + 1,
          total: validSections.length,
          totalChunks,
        });
      }
      await query(`UPDATE documents SET embedding_status = 'done' WHERE id = $1`, [documentId]);
      console.log(`[Upload] 임베딩 완료: 문서 ID ${documentId}, ${totalChunks}개 청크`);
    } catch (embErr) {
      await query(`UPDATE documents SET embedding_status = 'failed' WHERE id = $1`, [documentId]).catch(() => {});
      console.error(`[Upload] 임베딩 실패 (문서 ID ${documentId}):`, embErr.message);
      // 임베딩 실패해도 업로드 자체는 성공으로 처리
      sse.send('embedding_failed', { message: `임베딩 생성 실패: ${embErr.message}`, progress: 95 });
    }

    // ── 완료 ──
    sse.done({
      success: true,
      documentId,
      title,
      category,
      fileType,
      totalPages: extracted.totalPages || null,
      sectionCount: sections.length,
      sectionType: extracted.sectionType || sectionType,
      columns: extracted.columns || null,
      fields: extracted.fields || null,
    });
  } catch (err) {
    if (sse.isSSE) {
      sse.error(err.message || '업로드 처리 중 오류 발생');
    } else {
      const { sendError } = require('../lib/error-handler');
      sendError(res, err, '[Upload]');
    }
  }
};
