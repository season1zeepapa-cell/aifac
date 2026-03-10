// Upstage Document OCR API 프록시
// POST /api/ocr
// - multipart/form-data: file 필드로 이미지/PDF 전송
// - JSON: { fileBase64: "...", filename: "file.png", mimetype: "image/png" }
//
// 지원 형식: JPEG, PNG, BMP, PDF, TIFF, HEIC, DOCX, PPTX, XLSX, HWP, HWPX
// Upstage API: https://api.upstage.ai/v1/document-digitization

const multer = require('multer');
const https = require('https');
const { requireAdmin } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { checkRateLimit } = require('../lib/rate-limit');
const { sanitizeFilename } = require('../lib/input-sanitizer');
const { sendError } = require('../lib/error-handler');

// OCR 허용 MIME 타입
const OCR_ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/bmp', 'image/tiff', 'image/heic',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/x-hwp', 'application/haansofthwp', // hwp
  'application/vnd.hancom.hwpx', // hwpx
]);

// multer: 메모리 스토리지 + OCR용 MIME 화이트리스트
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 최대 50MB (Upstage 제한과 동일)
  fileFilter: (req, file, cb) => {
    if (OCR_ALLOWED_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`OCR에서 지원하지 않는 파일 형식입니다: ${file.mimetype}`));
    }
  },
});

/**
 * Upstage OCR API 호출
 * @param {Buffer} fileBuffer - 파일 바이너리 데이터
 * @param {string} filename - 파일명
 * @param {string} mimetype - MIME 타입
 * @returns {Promise<object>} OCR 결과 JSON
 */
function callUpstageOcr(fileBuffer, filename, mimetype) {
  return new Promise((resolve, reject) => {
    // multipart/form-data 수동 생성
    const boundary = `----FormBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;

    // document 필드 (파일)
    const fileHeader = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="document"; filename="${filename}"\r\n` +
      `Content-Type: ${mimetype}\r\n\r\n`
    );
    // model 필드
    const modelField = Buffer.from(
      `\r\n--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n` +
      `ocr`
    );
    const ending = Buffer.from(`\r\n--${boundary}--\r\n`);

    // 전체 body 조합
    const body = Buffer.concat([fileHeader, fileBuffer, modelField, ending]);

    const options = {
      hostname: 'api.upstage.ai',
      path: '/v1/document-digitization',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.UPSTAGE_API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      timeout: 60000, // 60초 (대용량 PDF 고려)
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');
        try {
          const json = JSON.parse(data);
          if (res.statusCode !== 200) {
            reject(new Error(json.message || json.error || `Upstage API 오류: HTTP ${res.statusCode}`));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error(`Upstage API 응답 파싱 실패: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Upstage OCR API 요청 시간 초과 (60초)'));
    });

    req.write(body);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  // CORS 처리
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST만 허용됩니다.' });
  }

  // 인증 체크
  const { error: authError } = requireAdmin(req);
  if (authError) return res.status(401).json({ error: authError });

  // Rate Limit 체크
  if (checkRateLimit(req, res, 'ocr')) return;

  // API 키 확인
  if (!process.env.UPSTAGE_API_KEY) {
    return res.status(500).json({ error: 'UPSTAGE_API_KEY 환경변수가 설정되지 않았습니다.' });
  }

  try {
    // multipart/form-data 처리
    await new Promise((resolve, reject) => {
      upload.single('file')(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // 파일 버퍼 추출
    let fileBuffer, filename, mimetype;

    if (req.file) {
      // multipart 업로드
      fileBuffer = req.file.buffer;
      // multer는 파일명을 Latin-1로 디코딩하므로 UTF-8로 재변환 (한글 깨짐 방지)
      const rawName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      filename = sanitizeFilename(rawName);
      mimetype = req.file.mimetype;
    } else if (req.body && req.body.fileBase64) {
      // JSON base64 업로드
      fileBuffer = Buffer.from(req.body.fileBase64, 'base64');
      filename = sanitizeFilename(req.body.filename || 'file.png');
      mimetype = req.body.mimetype || 'image/png';
    } else {
      return res.status(400).json({ error: 'OCR할 파일이 필요합니다. (file 필드 또는 fileBase64)' });
    }

    console.log(`[OCR] 요청: ${filename} (${mimetype}, ${(fileBuffer.length / 1024).toFixed(1)}KB)`);

    // Upstage OCR API 호출
    const ocrResult = await callUpstageOcr(fileBuffer, filename, mimetype);

    console.log(`[OCR] 완료: ${filename}, confidence: ${ocrResult.confidence || 'N/A'}`);

    res.json({
      success: true,
      filename,
      ...ocrResult,
    });
  } catch (err) {
    sendError(res, err, '[OCR]');
  }
};
