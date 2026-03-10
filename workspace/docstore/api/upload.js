// 멀티포맷 파일 업로드 + 텍스트 추출 + DB 저장 API
//
// 지원 형식: PDF, TXT, MD, DOCX, XLSX, CSV, JSON, 이미지(JPG/PNG)
//
// 처리 흐름:
// 1. 파일 수신 (multipart/form-data)
// 2. 파일 형식 감지 → 형식별 추출기 호출
// 3. 선택한 옵션에 따라 섹션 분할
// 4. documents + document_sections 테이블에 저장
// 5. 임베딩 생성
const path = require('path');
const multer = require('multer');
const { extractFromPdf } = require('../lib/pdf-extractor');
const { detectFileType, extractFromFile } = require('../lib/text-extractor');
const { createEmbeddingsForDocument } = require('../lib/embeddings');
const { query } = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { checkRateLimit } = require('../lib/rate-limit');
const { uploadFile, isStorageAvailable } = require('../lib/storage');
const { sanitizeFilename } = require('../lib/input-sanitizer');
const { sendError } = require('../lib/error-handler');

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
      // multer는 파일명을 Latin-1로 디코딩하므로 UTF-8로 재변환 (한글 깨짐 방지)
      const rawName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      filename = sanitizeFilename(rawName);
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
      filename = sanitizeFilename(req.body.filename || 'file.pdf');
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
      extracted = await extractFromPdf(fileBuffer, { sectionType, customDelimiter });
    } else {
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
    // 1) documents 테이블 (메타 정보만, 원본 파일은 Storage에 저장)
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
        const storagePath = await uploadFile(fileBuffer, documentId, filename, mimetype);
        await query('UPDATE documents SET storage_path = $1 WHERE id = $2', [storagePath, documentId]);
      } catch (storageErr) {
        // Storage 실패 시에도 텍스트 추출은 이미 완료 → 경고만 출력
        console.warn(`[Upload] Storage 업로드 실패 (문서 ${documentId}):`, storageErr.message);
      }
    }

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

    // 3) 임베딩 생성
    const embeddingResult = await createEmbeddingsForDocument({ query }, documentId, 'Upload');

    res.json({
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
      embedding: embeddingResult,
    });
  } catch (err) {
    sendError(res, err, '[Upload]');
  }
};
