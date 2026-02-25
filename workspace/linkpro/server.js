// ============================================================
// LinkPro - Linktree 클론 서비스 백엔드
// ============================================================

const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// ------------------------------------------------------------
// 앱 초기화 및 설정
// ------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = (process.env.JWT_SECRET || '').trim();
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_AVATAR_BUCKET = (process.env.SUPABASE_AVATAR_BUCKET || 'linkpro-avatars').trim();

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET 환경변수가 설정되지 않았습니다.');
}

// PostgreSQL 연결 풀 (Supabase)
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').trim(),
  ssl: { rejectUnauthorized: false },
});

// ------------------------------------------------------------
// 미들웨어 설정
// ------------------------------------------------------------
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname)));

// ------------------------------------------------------------
// DB 초기화 - Lazy Init 패턴 (서버리스 cold start 대응)
// ------------------------------------------------------------
let dbInitialized = false;
const ALLOWED_THEMES = new Set(['default', 'ocean', 'sunset', 'forest', 'midnight', 'candy']);
const MAX_AVATAR_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED_AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
let avatarBucketInitialized = false;

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function getBase64DecodedSize(base64Body) {
  const padding = (base64Body.match(/=+$/) || [''])[0].length;
  return Math.floor((base64Body.length * 3) / 4) - padding;
}

function isValidBase64ImageDataUrl(value) {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/i.exec(value);
  if (!match) return false;
  const mimeType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  if (!ALLOWED_AVATAR_MIME_TYPES.includes(mimeType)) return false;
  const decodedSize = getBase64DecodedSize(match[2]);
  return decodedSize > 0 && decodedSize <= MAX_AVATAR_IMAGE_BYTES;
}

function isValidAvatarUrl(value) {
  return isValidHttpUrl(value) || isValidBase64ImageDataUrl(value);
}

function getSupabaseStorageAuthHeaders() {
  return {
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    apikey: SUPABASE_SERVICE_ROLE_KEY,
  };
}

function normalizeMimeType(mimeType) {
  return mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
}

function getAvatarExtension(mimeType) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  return 'png';
}

function parseImageDataUrl(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) return null;

  const mimeType = normalizeMimeType(match[1].toLowerCase());
  if (!ALLOWED_AVATAR_MIME_TYPES.includes(mimeType)) return null;

  const base64Body = match[2];
  const decodedSize = getBase64DecodedSize(base64Body);
  if (decodedSize <= 0 || decodedSize > MAX_AVATAR_IMAGE_BYTES) return null;

  return {
    mimeType,
    buffer: Buffer.from(base64Body, 'base64'),
  };
}

async function ensureAvatarBucketExists() {
  if (avatarBucketInitialized) return;

  const headers = getSupabaseStorageAuthHeaders();
  const bucketRes = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${SUPABASE_AVATAR_BUCKET}`, {
    method: 'GET',
    headers,
  });

  if (bucketRes.status === 404) {
    const createRes = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: SUPABASE_AVATAR_BUCKET,
        name: SUPABASE_AVATAR_BUCKET,
        public: true,
        file_size_limit: MAX_AVATAR_IMAGE_BYTES,
        allowed_mime_types: ALLOWED_AVATAR_MIME_TYPES,
      }),
    });

    if (!createRes.ok && createRes.status !== 409) {
      const errorText = await createRes.text();
      throw new Error(`스토리지 버킷 생성 실패: ${errorText || createRes.status}`);
    }
  } else if (!bucketRes.ok) {
    const errorText = await bucketRes.text();
    throw new Error(`스토리지 버킷 확인 실패: ${errorText || bucketRes.status}`);
  }

  avatarBucketInitialized = true;
}

function buildPublicAvatarUrl(objectPath) {
  const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
  return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_AVATAR_BUCKET}/${encodedPath}`;
}

async function uploadAvatarToSupabaseStorage(userId, imageDataUrl) {
  const parsedImage = parseImageDataUrl(imageDataUrl);
  if (!parsedImage) {
    throw new Error('지원하지 않는 이미지 형식이거나 크기 제한(2MB)을 초과했습니다.');
  }

  await ensureAvatarBucketExists();

  const extension = getAvatarExtension(parsedImage.mimeType);
  const objectPath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
  const headers = getSupabaseStorageAuthHeaders();

  const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_AVATAR_BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': parsedImage.mimeType,
      'x-upsert': 'true',
    },
    body: parsedImage.buffer,
  });

  if (!uploadRes.ok) {
    const errorText = await uploadRes.text();
    throw new Error(`스토리지 업로드 실패: ${errorText || uploadRes.status}`);
  }

  return buildPublicAvatarUrl(objectPath);
}

async function initDB() {
  if (dbInitialized) return;

  const client = await pool.connect();
  try {
    // linkpro_users 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS linkpro_users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        username VARCHAR(50) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // linkpro_profiles 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS linkpro_profiles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE REFERENCES linkpro_users(id) ON DELETE CASCADE,
        display_name VARCHAR(100),
        bio TEXT,
        avatar_url TEXT,
        theme VARCHAR(50) DEFAULT 'default',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // linkpro_links 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS linkpro_links (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES linkpro_users(id) ON DELETE CASCADE,
        title VARCHAR(200) NOT NULL,
        url TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    dbInitialized = true;
  } finally {
    client.release();
  }
}

// API 라우트 전에 DB 초기화 미들웨어 적용
app.use('/api', async (_req, res, next) => {
  try {
    await initDB();
    next();
  } catch (err) {
    console.error('DB 초기화 실패:', err.message);
    res.status(500).json({ success: false, message: 'DB 초기화에 실패했습니다.' });
  }
});

// ------------------------------------------------------------
// JWT 인증 미들웨어
// ------------------------------------------------------------
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: '인증 토큰이 필요합니다.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: '유효하지 않은 토큰입니다.' });
  }
}

// ============================================================
// API 라우트 - 인증
// ============================================================

// POST /api/auth/register - 회원가입
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, username } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();
    const normalizedUsername = (username || '').trim().toLowerCase();

    // 입력값 검증
    if (!normalizedEmail || !password || !normalizedUsername) {
      return res.status(400).json({ success: false, message: 'email, password, username은 필수입니다.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: '비밀번호는 6자 이상이어야 합니다.' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ success: false, message: '유효한 이메일 형식이 아닙니다.' });
    }

    // username 형식 검증 (영문 소문자, 숫자, 하이픈, 언더스코어만 허용)
    if (!/^[a-z0-9_-]+$/.test(normalizedUsername)) {
      return res.status(400).json({ success: false, message: 'username은 영문 소문자, 숫자, 하이픈, 언더스코어만 사용할 수 있습니다.' });
    }

    // 비밀번호 해싱
    const passwordHash = await bcrypt.hash(password, 10);

    let user;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userResult = await client.query(
        'INSERT INTO linkpro_users (email, password_hash, username) VALUES ($1, $2, $3) RETURNING id, email, username, created_at',
        [normalizedEmail, passwordHash, normalizedUsername]
      );
      user = userResult.rows[0];

      await client.query(
        'INSERT INTO linkpro_profiles (user_id, display_name) VALUES ($1, $2)',
        [user.id, normalizedUsername]
      );

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      if (txErr.code === '23505') {
        return res.status(409).json({ success: false, message: '이미 사용 중인 이메일 또는 username입니다.' });
      }
      throw txErr;
    } finally {
      client.release();
    }

    // JWT 토큰 발급
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      success: true,
      data: {
        user: { id: user.id, email: user.email, username: user.username, created_at: user.created_at },
        token,
      },
    });
  } catch (err) {
    console.error('회원가입 오류:', err.message);
    res.status(500).json({ success: false, message: '회원가입 처리 중 오류가 발생했습니다.' });
  }
});

// POST /api/auth/login - 로그인
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();

    if (!normalizedEmail || !password) {
      return res.status(400).json({ success: false, message: 'email과 password는 필수입니다.' });
    }

    // 사용자 조회
    const userResult = await pool.query(
      'SELECT id, email, username, password_hash, created_at FROM linkpro_users WHERE email = $1',
      [normalizedEmail]
    );
    if (userResult.rows.length === 0) {
      return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 일치하지 않습니다.' });
    }

    const user = userResult.rows[0];

    // 비밀번호 검증
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 일치하지 않습니다.' });
    }

    // JWT 토큰 발급
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      data: {
        user: { id: user.id, email: user.email, username: user.username, created_at: user.created_at },
        token,
      },
    });
  } catch (err) {
    console.error('로그인 오류:', err.message);
    res.status(500).json({ success: false, message: '로그인 처리 중 오류가 발생했습니다.' });
  }
});

// GET /api/auth/me - 현재 로그인한 사용자 정보
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const userResult = await pool.query(
      'SELECT id, email, username, created_at FROM linkpro_users WHERE id = $1',
      [req.userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
    }

    res.json({ success: true, data: userResult.rows[0] });
  } catch (err) {
    console.error('사용자 정보 조회 오류:', err.message);
    res.status(500).json({ success: false, message: '사용자 정보 조회 중 오류가 발생했습니다.' });
  }
});

// POST /api/uploads/avatar - 아바타 이미지 업로드 (Supabase Storage)
app.post('/api/uploads/avatar', authMiddleware, async (req, res) => {
  try {
    const { image_data_url } = req.body;
    const normalizedDataUrl = typeof image_data_url === 'string' ? image_data_url.trim() : '';

    if (!normalizedDataUrl) {
      return res.status(400).json({ success: false, message: 'image_data_url은 필수입니다.' });
    }

    if (!isValidBase64ImageDataUrl(normalizedDataUrl)) {
      return res.status(400).json({ success: false, message: '지원하지 않는 이미지 형식이거나 크기 제한(2MB)을 초과했습니다.' });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(503).json({
        success: false,
        message: '서버 업로드 환경이 설정되지 않았습니다. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY를 확인해 주세요.',
      });
    }

    const publicUrl = await uploadAvatarToSupabaseStorage(req.userId, normalizedDataUrl);
    return res.json({ success: true, data: { url: publicUrl } });
  } catch (err) {
    console.error('아바타 업로드 오류:', err.message);
    return res.status(500).json({ success: false, message: '아바타 업로드 중 오류가 발생했습니다.' });
  }
});

// ============================================================
// API 라우트 - 프로필 관리
// ============================================================

// GET /api/profile - 내 프로필 조회
app.get('/api/profile', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, user_id, display_name, bio, avatar_url, theme, created_at FROM linkpro_profiles WHERE user_id = $1',
      [req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: '프로필을 찾을 수 없습니다.' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('프로필 조회 오류:', err.message);
    res.status(500).json({ success: false, message: '프로필 조회 중 오류가 발생했습니다.' });
  }
});

// PUT /api/profile - 프로필 수정
app.put('/api/profile', authMiddleware, async (req, res) => {
  try {
    const { display_name, bio, avatar_url, theme } = req.body;
    const nextTheme = typeof theme === 'string' ? theme.trim().toLowerCase() : theme;
    const nextAvatarUrl = typeof avatar_url === 'string' ? avatar_url.trim() : avatar_url;

    if (nextTheme != null && !ALLOWED_THEMES.has(nextTheme)) {
      return res.status(400).json({ success: false, message: '지원하지 않는 테마입니다.' });
    }

    if (nextAvatarUrl && !isValidAvatarUrl(nextAvatarUrl)) {
      return res.status(400).json({ success: false, message: 'avatar_url은 http(s) URL 또는 2MB 이하 업로드 이미지(data URL)만 허용됩니다.' });
    }

    const result = await pool.query(
      `UPDATE linkpro_profiles
       SET display_name = COALESCE($1, display_name),
           bio = COALESCE($2, bio),
           avatar_url = COALESCE($3, avatar_url),
           theme = COALESCE($4, theme)
       WHERE user_id = $5
       RETURNING id, user_id, display_name, bio, avatar_url, theme, created_at`,
      [display_name, bio, nextAvatarUrl, nextTheme, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: '프로필을 찾을 수 없습니다.' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('프로필 수정 오류:', err.message);
    res.status(500).json({ success: false, message: '프로필 수정 중 오류가 발생했습니다.' });
  }
});

// ============================================================
// API 라우트 - 링크 관리
// ============================================================

// GET /api/links - 내 링크 목록 조회
app.get('/api/links', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, title, url, sort_order, is_active, created_at FROM linkpro_links WHERE user_id = $1 ORDER BY sort_order ASC, created_at ASC',
      [req.userId]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('링크 목록 조회 오류:', err.message);
    res.status(500).json({ success: false, message: '링크 목록 조회 중 오류가 발생했습니다.' });
  }
});

// POST /api/links - 링크 추가
app.post('/api/links', authMiddleware, async (req, res) => {
  try {
    const { title, url } = req.body;
    const normalizedTitle = (title || '').trim();
    const normalizedUrl = (url || '').trim();

    if (!normalizedTitle || !normalizedUrl) {
      return res.status(400).json({ success: false, message: 'title과 url은 필수입니다.' });
    }

    if (!isValidHttpUrl(normalizedUrl)) {
      return res.status(400).json({ success: false, message: 'url은 http(s) URL이어야 합니다.' });
    }

    // 현재 최대 sort_order 조회
    const maxOrderResult = await pool.query(
      'SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM linkpro_links WHERE user_id = $1',
      [req.userId]
    );
    const nextOrder = maxOrderResult.rows[0].max_order + 1;

    const result = await pool.query(
      'INSERT INTO linkpro_links (user_id, title, url, sort_order) VALUES ($1, $2, $3, $4) RETURNING id, title, url, sort_order, is_active, created_at',
      [req.userId, normalizedTitle, normalizedUrl, nextOrder]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('링크 추가 오류:', err.message);
    res.status(500).json({ success: false, message: '링크 추가 중 오류가 발생했습니다.' });
  }
});

// PUT /api/links/reorder - 링크 순서 변경 (반드시 :id 라우트보다 먼저 선언)
app.put('/api/links/reorder', authMiddleware, async (req, res) => {
  try {
    const { orders } = req.body;

    // orders: [{ id: 1, sort_order: 0 }, { id: 2, sort_order: 1 }, ...]
    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ success: false, message: 'orders 배열이 필요합니다. [{ id, sort_order }]' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const item of orders) {
        if (item.id == null || item.sort_order == null) continue;
        // 본인 소유 링크만 업데이트 가능
        await client.query(
          'UPDATE linkpro_links SET sort_order = $1 WHERE id = $2 AND user_id = $3',
          [item.sort_order, item.id, req.userId]
        );
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // 업데이트된 링크 목록 반환
    const result = await pool.query(
      'SELECT id, title, url, sort_order, is_active, created_at FROM linkpro_links WHERE user_id = $1 ORDER BY sort_order ASC',
      [req.userId]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('링크 순서 변경 오류:', err.message);
    res.status(500).json({ success: false, message: '링크 순서 변경 중 오류가 발생했습니다.' });
  }
});

// PUT /api/links/:id - 링크 수정
app.put('/api/links/:id', authMiddleware, async (req, res) => {
  try {
    const linkId = parseInt(req.params.id, 10);
    if (isNaN(linkId)) {
      return res.status(400).json({ success: false, message: '유효하지 않은 링크 ID입니다.' });
    }

    const { title, url, is_active } = req.body;
    const normalizedTitle = typeof title === 'string' ? title.trim() : title;
    const normalizedUrl = typeof url === 'string' ? url.trim() : url;

    if (normalizedTitle != null && normalizedTitle.length === 0) {
      return res.status(400).json({ success: false, message: 'title은 비어 있을 수 없습니다.' });
    }

    if (normalizedUrl != null) {
      if (!normalizedUrl) {
        return res.status(400).json({ success: false, message: 'url은 비어 있을 수 없습니다.' });
      }
      if (!isValidHttpUrl(normalizedUrl)) {
        return res.status(400).json({ success: false, message: 'url은 http(s) URL이어야 합니다.' });
      }
    }

    const result = await pool.query(
      `UPDATE linkpro_links
       SET title = COALESCE($1, title),
           url = COALESCE($2, url),
           is_active = COALESCE($3, is_active)
       WHERE id = $4 AND user_id = $5
       RETURNING id, title, url, sort_order, is_active, created_at`,
      [normalizedTitle, normalizedUrl, is_active, linkId, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: '링크를 찾을 수 없거나 권한이 없습니다.' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('링크 수정 오류:', err.message);
    res.status(500).json({ success: false, message: '링크 수정 중 오류가 발생했습니다.' });
  }
});

// DELETE /api/links/:id - 링크 삭제
app.delete('/api/links/:id', authMiddleware, async (req, res) => {
  try {
    const linkId = parseInt(req.params.id, 10);
    if (isNaN(linkId)) {
      return res.status(400).json({ success: false, message: '유효하지 않은 링크 ID입니다.' });
    }

    const result = await pool.query(
      'DELETE FROM linkpro_links WHERE id = $1 AND user_id = $2 RETURNING id',
      [linkId, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: '링크를 찾을 수 없거나 권한이 없습니다.' });
    }

    res.json({ success: true, message: '링크가 삭제되었습니다.' });
  } catch (err) {
    console.error('링크 삭제 오류:', err.message);
    res.status(500).json({ success: false, message: '링크 삭제 중 오류가 발생했습니다.' });
  }
});

// ============================================================
// API 라우트 - 공개 페이지
// ============================================================

// GET /api/public/:username - 공개 프로필 + 활성화된 링크
app.get('/api/public/:username', async (req, res) => {
  try {
    const { username } = req.params;

    // 사용자 조회
    const userResult = await pool.query(
      'SELECT id, username, created_at FROM linkpro_users WHERE username = $1',
      [username]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: '해당 사용자를 찾을 수 없습니다.' });
    }

    const user = userResult.rows[0];

    // 프로필 조회
    const profileResult = await pool.query(
      'SELECT display_name, bio, avatar_url, theme FROM linkpro_profiles WHERE user_id = $1',
      [user.id]
    );
    const profile = profileResult.rows[0] || { display_name: username, bio: null, avatar_url: null, theme: 'default' };

    // 활성화된 링크만 조회
    const linksResult = await pool.query(
      'SELECT id, title, url, sort_order FROM linkpro_links WHERE user_id = $1 AND is_active = true ORDER BY sort_order ASC',
      [user.id]
    );

    res.json({
      success: true,
      data: {
        username: user.username,
        profile,
        links: linksResult.rows,
      },
    });
  } catch (err) {
    console.error('공개 페이지 조회 오류:', err.message);
    res.status(500).json({ success: false, message: '공개 페이지 조회 중 오류가 발생했습니다.' });
  }
});

// ============================================================
// SPA 폴백 - 모든 비-API 라우트를 index.html로 전달
// (Express 5 와일드카드 문법)
// ============================================================
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================================
// 전역 에러 핸들링 미들웨어
// ============================================================
app.use((err, _req, res, _next) => {
  console.error('서버 에러:', err.message);
  res.status(500).json({ success: false, message: '서버 내부 오류가 발생했습니다.' });
});

// ============================================================
// 서버 시작 (로컬) / 모듈 내보내기 (Vercel 서버리스)
// ============================================================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`LinkPro 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  });
}

module.exports = app;
