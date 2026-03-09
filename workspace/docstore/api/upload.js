// PDF 업로드 + 텍스트 추출 + DB 저장 API
//
// 처리 흐름:
// 1. PDF 파일 수신 (multipart/form-data 또는 base64 JSON)
// 2. pdf-extractor로 텍스트 추출 (텍스트 PDF + 이미지 OCR)
// 3. 선택한 추출 단위로 섹션 분할
// 4. documents + document_sections 테이블에 저장
const multer = require('multer');
const { extractFromPdf } = require('../lib/pdf-extractor');
const { chunkText, generateEmbeddings } = require('../lib/embeddings');
const { query } = require('./db');

// multer: 메모리 스토리지 (Vercel 서버리스 호환)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 최대 50MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('PDF 파일만 업로드 가능합니다.'));
    }
  },
});

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  }

  try {
    // multipart/form-data 처리 (multer)
    await new Promise((resolve, reject) => {
      upload.single('file')(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // 요청에서 파라미터 추출
    let pdfBuffer;
    let title;
    let category;
    let sectionType;
    let customDelimiter;

    if (req.file) {
      // multipart/form-data로 업로드된 경우
      pdfBuffer = req.file.buffer;
      title = req.body.title || req.file.originalname;
      category = req.body.category || '기타';
      sectionType = req.body.sectionType || 'page';
      customDelimiter = req.body.customDelimiter;
    } else if (req.body && req.body.fileBase64) {
      // JSON base64로 업로드된 경우 (CLI 스크립트용)
      pdfBuffer = Buffer.from(req.body.fileBase64, 'base64');
      title = req.body.title || '제목 없음';
      category = req.body.category || '기타';
      sectionType = req.body.sectionType || 'page';
      customDelimiter = req.body.customDelimiter;
    } else {
      return res.status(400).json({ error: 'PDF 파일이 필요합니다.' });
    }

    // PDF 텍스트 추출
    console.log(`PDF 추출 시작: ${title} (${sectionType} 단위)`);
    const extracted = await extractFromPdf(pdfBuffer, {
      sectionType,
      customDelimiter,
    });

    // DB에 저장
    // 1) documents 테이블에 문서 메타데이터 저장
    const docResult = await query(
      `INSERT INTO documents (title, file_type, category, metadata)
       VALUES ($1, 'pdf', $2, $3)
       RETURNING id`,
      [
        title,
        category,
        JSON.stringify({
          totalPages: extracted.totalPages,
          sectionType: extracted.sectionType,
          sectionCount: extracted.sections.length,
        }),
      ]
    );
    const documentId = docResult.rows[0].id;

    // 2) document_sections 테이블에 섹션별 텍스트 저장 (metadata 포함)
    for (const section of extracted.sections) {
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

    console.log(`PDF 저장 완료: 문서 ID ${documentId}, ${extracted.sections.length}개 섹션`);

    // 3) 비동기로 임베딩 생성 (실패해도 업로드 자체는 성공)
    const embeddingPromise = (async () => {
      try {
        let totalChunks = 0;
        // 저장된 섹션 조회 (id 필요)
        const savedSections = await query(
          'SELECT id, raw_text FROM document_sections WHERE document_id = $1 ORDER BY id',
          [documentId]
        );

        for (const section of savedSections.rows) {
          if (!section.raw_text || section.raw_text.trim().length === 0) continue;

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
        }
        console.log(`임베딩 생성 완료: 문서 ID ${documentId}, ${totalChunks}개 청크`);
      } catch (embErr) {
        console.error(`임베딩 생성 실패 (문서 ID ${documentId}):`, embErr.message);
      }
    })();

    // 임베딩 생성을 기다리지 않고 응답 반환 (비동기)
    // Vercel 서버리스에서는 응답 후 비동기 작업이 중단될 수 있으므로,
    // 로컬 개발 시에만 비동기로 동작하고 서버리스에서는 await
    if (process.env.VERCEL) {
      await embeddingPromise;
    }

    res.json({
      success: true,
      documentId,
      title,
      category,
      totalPages: extracted.totalPages,
      sectionCount: extracted.sections.length,
      sectionType: extracted.sectionType,
    });
  } catch (err) {
    console.error('Upload API 에러:', err);
    res.status(500).json({ error: err.message });
  }
};
