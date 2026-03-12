// 대용량 파일 업로드를 위한 Signed Upload URL 발급 API
//
// Vercel 서버리스 함수의 body 크기 제한(4.5MB)을 우회하기 위해
// 클라이언트가 Supabase Storage에 직접 업로드할 수 있는 서명된 URL을 발급한다.
//
// POST /api/upload-url
// Body: { filename, mimetype, fileSize }
// Response: { signedUrl, storagePath, token }

const { requireAuth } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { createSignedUploadUrl, isStorageAvailable } = require('../lib/storage');
const { sanitizeFilename } = require('../lib/input-sanitizer');
const { sendError } = require('../lib/error-handler');

// 허용 MIME 타입 (upload.js와 동일)
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'text/plain', 'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv', 'application/json',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
]);

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

module.exports = async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  }

  const { user, orgId, error: authError } = requireAuth(req);
  if (authError) return res.status(401).json({ error: authError });

  try {
    if (!isStorageAvailable()) {
      return res.status(503).json({ error: 'Storage가 설정되지 않았습니다. SUPABASE_URL, SUPABASE_SERVICE_KEY를 확인하세요.' });
    }

    const { filename, mimetype, fileSize } = req.body || {};

    if (!filename || !mimetype) {
      return res.status(400).json({ error: 'filename과 mimetype이 필요합니다.' });
    }

    if (!ALLOWED_MIMES.has(mimetype)) {
      return res.status(400).json({ error: `허용되지 않는 파일 형식입니다: ${mimetype}` });
    }

    if (fileSize && fileSize > MAX_FILE_SIZE) {
      return res.status(400).json({ error: `파일 크기가 50MB를 초과합니다.` });
    }

    // 안전한 파일 경로 생성: temp-uploads/{orgId}/{timestamp}_{safeName}
    const safeName = sanitizeFilename(filename);
    const storagePath = `temp-uploads/${orgId}/${Date.now()}_${safeName}`;

    const data = await createSignedUploadUrl(storagePath);

    console.log(`[Upload URL] 발급: ${storagePath} (${mimetype}, ${fileSize || '?'} bytes)`);

    res.json({
      success: true,
      signedUrl: data.signedUrl,
      storagePath,
      token: data.token,
    });
  } catch (err) {
    sendError(res, err, '[Upload URL]');
  }
};
