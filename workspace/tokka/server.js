// ============================================================
// TOKKA - 카카오톡 스타일 채팅앱 백엔드 서버
// Express 4 + PostgreSQL(Supabase) + JWT 인증
// ============================================================

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

// OpenAI 클라이언트 (AI 챗봇용)
const openai = new OpenAI({
  apiKey: (process.env.OPENAI_API_KEY || '').trim(),
});

// Supabase 클라이언트 (Storage용 - Service Role Key 사용)
const supabase = createClient(
  (process.env.SUPABASE_URL || '').trim(),
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = (process.env.JWT_SECRET || 'fallback_secret').trim();

// ============================================================
// 1. PostgreSQL 연결 (Lazy Init 패턴)
// ============================================================
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').trim(),
  ssl: { rejectUnauthorized: false },
  max: 10,                       // 최대 커넥션 수
  idleTimeoutMillis: 30000,      // 유휴 커넥션 30초 후 정리
  connectionTimeoutMillis: 10000, // 연결 대기 최대 10초
});

// DB 연결 상태 확인용
let dbReady = false;
async function ensureDB() {
  if (dbReady) return;
  try {
    await pool.query('SELECT 1');
    dbReady = true;
  } catch (err) {
    console.error('DB 연결 실패:', err.message);
    throw err;
  }
}

// ============================================================
// 2. Multer 설정 (메모리 스토리지 → Supabase Storage 업로드)
// ============================================================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB 제한 (Vercel 4.5MB 제한 고려)
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('지원하지 않는 이미지 형식입니다. (jpg, png, gif, webp만 허용)'));
    }
  },
});

// Supabase Storage 버킷 초기화 (없으면 생성)
async function ensureStorageBucket() {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.find(b => b.name === 'avatars')) {
    await supabase.storage.createBucket('avatars', { public: true });
  }
}
ensureStorageBucket().catch(err => console.warn('Storage 버킷 초기화:', err.message));

// ============================================================
// 3. 미들웨어 설정
// ============================================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 정적 파일 서빙: 프로젝트 루트 (index.html, client.js)
app.use(express.static(path.join(__dirname)));

// API 라우트 진입 전 DB 연결 확인 미들웨어
app.use('/api', async (_req, res, next) => {
  try {
    await ensureDB();
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: 'DB 연결에 실패했습니다.' });
  }
});

// ============================================================
// 4. JWT 인증 미들웨어
// ============================================================
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: '인증 토큰이 필요합니다.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, email, nickname }
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: '유효하지 않은 토큰입니다.' });
  }
}

// ============================================================
// 5. 인증 API (/api/auth)
// ============================================================

// 회원가입
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, nickname } = req.body;

    // 입력값 검증
    if (!email || !password || !nickname) {
      return res.status(400).json({ success: false, message: '이메일, 비밀번호, 닉네임은 필수입니다.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: '비밀번호는 6자 이상이어야 합니다.' });
    }

    // 이메일 중복 확인
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, message: '이미 사용 중인 이메일입니다.' });
    }

    // 비밀번호 해싱 후 저장
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, nickname)
       VALUES ($1, $2, $3)
       RETURNING id, email, nickname, profile_image, status_message, created_at`,
      [email, passwordHash, nickname]
    );

    const user = result.rows[0];

    // 토큰 발급
    const token = jwt.sign(
      { id: user.id, email: user.email, nickname: user.nickname },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      data: { user, token },
      message: '회원가입이 완료되었습니다.',
    });
  } catch (err) {
    console.error('회원가입 오류:', err.message);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 로그인
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: '이메일과 비밀번호를 입력해주세요.' });
    }

    // 유저 조회
    const result = await pool.query(
      'SELECT id, email, password_hash, nickname, profile_image, status_message FROM users WHERE email = $1',
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 일치하지 않습니다.' });
    }

    const user = result.rows[0];

    // 비밀번호 검증
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 일치하지 않습니다.' });
    }

    // 토큰 발급
    const token = jwt.sign(
      { id: user.id, email: user.email, nickname: user.nickname },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // 응답에서 password_hash 제거
    const { password_hash, ...safeUser } = user;

    res.json({
      success: true,
      data: { user: safeUser, token },
      message: '로그인에 성공했습니다.',
    });
  } catch (err) {
    console.error('로그인 오류:', err.message);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 현재 로그인 유저 정보
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, nickname, profile_image, status_message, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: '유저를 찾을 수 없습니다.' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('유저 조회 오류:', err.message);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// ============================================================
// 6. 유저 API (/api/users)
// ============================================================

// 유저 검색 (닉네임 또는 이메일) - AI 유저 제외
app.get('/api/users/search', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    const userId = req.user.id;

    // 이미 친구이거나 차단한 유저를 제외하는 서브쿼리
    const excludeFriends = `
      AND id NOT IN (
        SELECT friend_id FROM friendships WHERE user_id = $USERIDX AND status IN ('accepted', 'blocked')
        UNION
        SELECT user_id FROM friendships WHERE friend_id = $USERIDX AND status IN ('accepted', 'blocked')
      )`;

    let result;
    if (!q || q.trim().length < 1) {
      result = await pool.query(
        `SELECT id, email, nickname, profile_image, status_message
         FROM users
         WHERE id != $1 AND (is_ai IS NULL OR is_ai = FALSE)
         ${excludeFriends.replace(/\$USERIDX/g, '$1')}
         ORDER BY created_at DESC
         LIMIT 50`,
        [userId]
      );
    } else {
      const searchTerm = `%${q.trim()}%`;
      result = await pool.query(
        `SELECT id, email, nickname, profile_image, status_message
         FROM users
         WHERE (nickname ILIKE $1 OR email ILIKE $1) AND id != $2 AND (is_ai IS NULL OR is_ai = FALSE)
         ${excludeFriends.replace(/\$USERIDX/g, '$2')}
         ORDER BY nickname ASC
         LIMIT 20`,
        [searchTerm, userId]
      );
    }

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('유저 검색 오류:', err.message);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 프로필 수정
app.put('/api/users/profile', authMiddleware, async (req, res) => {
  try {
    const { nickname, status_message, profile_image } = req.body;
    const updates = [];
    const values = [];
    let paramIdx = 1;

    if (nickname !== undefined) {
      updates.push(`nickname = $${paramIdx++}`);
      values.push(nickname);
    }
    if (status_message !== undefined) {
      updates.push(`status_message = $${paramIdx++}`);
      values.push(status_message);
    }
    if (profile_image !== undefined) {
      updates.push(`profile_image = $${paramIdx++}`);
      values.push(profile_image);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: '수정할 항목이 없습니다.' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(req.user.id);

    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIdx}
       RETURNING id, email, nickname, profile_image, status_message, updated_at`,
      values
    );

    res.json({
      success: true,
      data: result.rows[0],
      message: '프로필이 수정되었습니다.',
    });
  } catch (err) {
    console.error('프로필 수정 오류:', err.message);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 프로필 이미지 업로드 (Supabase Storage)
app.post('/api/users/profile-image', authMiddleware, (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: '파일 크기는 4MB 이하만 허용됩니다.' });
      }
      return res.status(400).json({ success: false, message: `업로드 오류: ${err.message}` });
    }
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: '이미지 파일을 선택해주세요.' });
    }

    try {
      // Supabase Storage에 업로드 (클라이언트에서 항상 JPEG로 압축됨)
      const fileName = `${req.user.id}-${Date.now()}.jpg`;

      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(fileName, req.file.buffer, {
          contentType: 'image/jpeg',
          upsert: true,
        });

      if (uploadErr) {
        console.error('Supabase Storage 업로드 오류:', uploadErr);
        return res.status(500).json({ 
          success: false, 
          message: `이미지 업로드에 실패했습니다: ${uploadErr.message || uploadErr.error || '알 수 없는 오류'}` 
        });
      }

      // 공개 URL 생성
      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);
      const imageUrl = urlData.publicUrl;

      // DB에 프로필 이미지 URL 업데이트
      const result = await pool.query(
        `UPDATE users SET profile_image = $1, updated_at = NOW() WHERE id = $2
         RETURNING id, email, nickname, profile_image, status_message`,
        [imageUrl, req.user.id]
      );

      res.json({
        success: true,
        data: result.rows[0],
        message: '프로필 이미지가 업로드되었습니다.',
      });
    } catch (dbErr) {
      console.error('프로필 이미지 업로드 오류:', dbErr.message);
      res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
    }
  });
});

// ============================================================
// 7. 친구 API (/api/friends)
// ============================================================

// 내 친구 목록 조회 (AI 친구 포함)
app.get('/api/friends', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.nickname, u.profile_image, u.status_message, 
              u.is_ai, u.ai_persona_id, f.status, f.created_at AS friend_since
       FROM friendships f
       JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = $1 AND f.status = 'accepted'
       ORDER BY u.is_ai ASC, u.nickname ASC`,
      [req.user.id]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('친구 목록 조회 오류:', err.message);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 차단된 유저 목록 조회
app.get('/api/friends/blocked', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.nickname, u.profile_image, u.status_message, f.created_at AS blocked_since
       FROM friendships f
       JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = $1 AND f.status = 'blocked'
       ORDER BY f.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('차단 목록 조회 오류:', err.message);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// AI 친구 추가 (페르소나 기반) - :friendId 라우트보다 먼저 정의해야 함!
app.post('/api/friends/ai', authMiddleware, async (req, res) => {
  try {
    console.log('[AI친구추가] req.body:', req.body);
    console.log('[AI친구추가] req.body type:', typeof req.body);
    
    const { personaId } = req.body || {};
    const userId = req.user.id;

    console.log('[AI친구추가] 요청:', { personaId, userId, bodyKeys: Object.keys(req.body || {}) });

    if (!personaId) {
      return res.status(400).json({ success: false, message: '페르소나를 선택해주세요.' });
    }

    // 페르소나 존재 확인
    console.log('[AI친구추가] 페르소나 조회 시작');
    const personaResult = await pool.query(
      'SELECT id, name, display_name, avatar_url, description FROM ai_personas WHERE id = $1',
      [personaId]
    );
    console.log('[AI친구추가] 페르소나 조회 결과:', personaResult.rows.length);
    if (personaResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: '해당 페르소나를 찾을 수 없습니다.' });
    }
    const persona = personaResult.rows[0];

    // 해당 유저가 이미 이 페르소나의 AI 친구를 가지고 있는지 확인
    const existingFriendship = await pool.query(
      `SELECT u.id, u.email, u.nickname, u.profile_image, u.status_message, u.is_ai 
       FROM users u
       JOIN friendships f ON f.friend_id = u.id
       WHERE f.user_id = $1 AND u.is_ai = TRUE AND u.ai_persona_id = $2 AND f.status = 'accepted'`,
      [userId, personaId]
    );
    if (existingFriendship.rows.length > 0) {
      return res.status(409).json({ success: false, message: '이미 이 AI 친구가 추가되어 있습니다.' });
    }

    // AI 유저 이메일 (각 사용자별로 독립적인 AI 친구)
    const aiEmail = `ai_${persona.name}_${userId.substring(0, 8)}@tokka.ai`;
    console.log('[AI친구추가] AI 이메일:', aiEmail);
    
    // 기존 AI 유저 확인 (이전 실패로 인해 생성만 되고 친구 관계가 안된 경우)
    let aiUser;
    console.log('[AI친구추가] 기존 AI 유저 확인');
    const existingAIUser = await pool.query(
      'SELECT id, email, nickname, profile_image, status_message, is_ai FROM users WHERE email = $1',
      [aiEmail]
    );
    console.log('[AI친구추가] 기존 AI 유저:', existingAIUser.rows.length);
    
    if (existingAIUser.rows.length > 0) {
      // 기존 AI 유저 재사용
      aiUser = existingAIUser.rows[0];
      console.log('[AI친구추가] 기존 유저 재사용:', aiUser.id);
    } else {
      // 새 AI 유저 생성
      console.log('[AI친구추가] 새 AI 유저 생성 시작');
      const aiResult = await pool.query(
        `INSERT INTO users (email, password_hash, nickname, profile_image, status_message, is_ai, ai_persona_id)
         VALUES ($1, 'AI_NO_LOGIN', $2, $3, $4, TRUE, $5)
         RETURNING id, email, nickname, profile_image, status_message, is_ai`,
        [aiEmail, persona.display_name, persona.avatar_url || '', persona.description || '', personaId]
      );
      aiUser = aiResult.rows[0];
      console.log('[AI친구추가] 새 유저 생성 완료:', aiUser.id);
    }

    // 친구 관계 생성 (단방향 - 유저 → AI만, 중복 시 무시)
    console.log('[AI친구추가] 친구 관계 생성');
    await pool.query(
      `INSERT INTO friendships (user_id, friend_id, status) VALUES ($1, $2, 'accepted')
       ON CONFLICT (user_id, friend_id) DO UPDATE SET status = 'accepted'`,
      [userId, aiUser.id]
    );
    console.log('[AI친구추가] 완료');

    res.status(201).json({
      success: true,
      data: aiUser,
      message: `${persona.display_name} AI 친구가 추가되었습니다.`,
    });
  } catch (err) {
    console.error('AI 친구 추가 오류:', err.message);
    console.error('AI 친구 추가 스택:', err.stack);
    res.status(500).json({ 
      success: false, 
      message: `서버 오류: ${err.message}`,
      error: err.message,
      stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined
    });
  }
});

// 친구 추가
app.post('/api/friends/:friendId', authMiddleware, async (req, res) => {
  try {
    const { friendId } = req.params;
    const userId = req.user.id;

    // 자기 자신 추가 방지
    if (friendId === userId) {
      return res.status(400).json({ success: false, message: '자기 자신을 친구로 추가할 수 없습니다.' });
    }

    // 상대방 존재 확인
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [friendId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: '해당 유저를 찾을 수 없습니다.' });
    }

    // 이미 친구인지 확인
    const existing = await pool.query(
      'SELECT id, status FROM friendships WHERE user_id = $1 AND friend_id = $2',
      [userId, friendId]
    );
    if (existing.rows.length > 0) {
      const { status } = existing.rows[0];
      if (status === 'accepted') {
        return res.status(409).json({ success: false, message: '이미 친구로 등록되어 있습니다.' });
      }
      if (status === 'blocked') {
        return res.status(400).json({ success: false, message: '차단된 유저입니다. 차단 해제 후 친구 추가해주세요.' });
      }
    }

    // 양방향 친구 관계 생성 (카카오톡 스타일: 바로 수락)
    await pool.query(
      `INSERT INTO friendships (user_id, friend_id, status) VALUES ($1, $2, 'accepted')
       ON CONFLICT (user_id, friend_id) DO UPDATE SET status = 'accepted'`,
      [userId, friendId]
    );
    await pool.query(
      `INSERT INTO friendships (user_id, friend_id, status) VALUES ($1, $2, 'accepted')
       ON CONFLICT (user_id, friend_id) DO UPDATE SET status = 'accepted'`,
      [friendId, userId]
    );

    // 추가된 친구 정보 반환
    const friend = await pool.query(
      'SELECT id, email, nickname, profile_image, status_message FROM users WHERE id = $1',
      [friendId]
    );

    res.status(201).json({
      success: true,
      data: friend.rows[0],
      message: '친구가 추가되었습니다.',
    });
  } catch (err) {
    console.error('친구 추가 오류:', err.message);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 친구 삭제
app.delete('/api/friends/:friendId', authMiddleware, async (req, res) => {
  try {
    const { friendId } = req.params;
    const userId = req.user.id;

    // 양방향 관계 삭제
    await pool.query(
      'DELETE FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)',
      [userId, friendId]
    );

    res.json({ success: true, message: '친구가 삭제되었습니다.' });
  } catch (err) {
    console.error('친구 삭제 오류:', err.message);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 친구 차단
app.post('/api/friends/:friendId/block', authMiddleware, async (req, res) => {
  try {
    const { friendId } = req.params;
    const userId = req.user.id;

    // 내쪽 관계를 blocked로 변경 (상대방에서 나를 향한 관계도 삭제)
    await pool.query(
      `INSERT INTO friendships (user_id, friend_id, status) VALUES ($1, $2, 'blocked')
       ON CONFLICT (user_id, friend_id) DO UPDATE SET status = 'blocked'`,
      [userId, friendId]
    );
    // 상대방 -> 나 관계 삭제 (차단 시 상대방 친구 목록에서도 제거)
    await pool.query(
      'DELETE FROM friendships WHERE user_id = $1 AND friend_id = $2',
      [friendId, userId]
    );

    res.json({ success: true, message: '해당 유저를 차단했습니다.' });
  } catch (err) {
    console.error('친구 차단 오류:', err.message);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 차단 해제
app.post('/api/friends/:friendId/unblock', authMiddleware, async (req, res) => {
  try {
    const { friendId } = req.params;
    const userId = req.user.id;

    // 차단 상태 확인
    const existing = await pool.query(
      "SELECT id FROM friendships WHERE user_id = $1 AND friend_id = $2 AND status = 'blocked'",
      [userId, friendId]
    );
    if (existing.rows.length === 0) {
      return res.status(400).json({ success: false, message: '차단 상태가 아닙니다.' });
    }

    // 차단 관계 삭제 (친구 관계도 해제, 다시 친구 추가 필요)
    await pool.query(
      'DELETE FROM friendships WHERE user_id = $1 AND friend_id = $2',
      [userId, friendId]
    );

    res.json({ success: true, message: '차단이 해제되었습니다.' });
  } catch (err) {
    console.error('차단 해제 오류:', err.message);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// ============================================================
// 7-1. AI 페르소나 API (/api/ai-personas)
// ============================================================

// AI 페르소나 목록 조회
app.get('/api/ai-personas', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, display_name, avatar_url, description, personality_tags
       FROM ai_personas
       ORDER BY display_name ASC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('AI 페르소나 조회 오류:', err.message);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// ============================================================
// 8. 채팅방 API (/api/rooms)
// ============================================================

// 내 채팅방 목록 조회 (최근 메시지 + 안 읽은 메시지 수 포함)
app.get('/api/rooms', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        cr.id, cr.name, cr.type, cr.created_at,
        -- 최근 메시지
        m.content AS last_message,
        m.created_at AS last_message_at,
        sender.nickname AS last_message_sender,
        -- 멤버 수
        (SELECT COUNT(*) FROM chat_room_members WHERE room_id = cr.id AND left_at IS NULL)::int AS member_count,
        -- 안 읽은 메시지 수 (내 last_read_at 이후 메시지)
        (SELECT COUNT(*) FROM messages WHERE room_id = cr.id AND created_at > crm.last_read_at)::int AS unread_count,
        -- 1:1 채팅방일 경우 상대방 정보 (AI 여부 포함)
        CASE WHEN cr.type = 'direct' THEN (
          SELECT json_build_object('id', u.id, 'nickname', u.nickname, 'profile_image', u.profile_image, 'status_message', u.status_message, 'is_ai', u.is_ai)
          FROM chat_room_members crm2
          JOIN users u ON u.id = crm2.user_id
          WHERE crm2.room_id = cr.id AND crm2.user_id != $1 AND crm2.left_at IS NULL
          LIMIT 1
        ) END AS other_user
       FROM chat_rooms cr
       JOIN chat_room_members crm ON crm.room_id = cr.id
       -- 최근 메시지 서브쿼리 (LATERAL JOIN)
       LEFT JOIN LATERAL (
         SELECT content, created_at, sender_id
         FROM messages
         WHERE room_id = cr.id
         ORDER BY created_at DESC
         LIMIT 1
       ) m ON true
       LEFT JOIN users sender ON sender.id = m.sender_id
       WHERE crm.user_id = $1 AND crm.left_at IS NULL
       ORDER BY COALESCE(m.created_at, cr.created_at) DESC`,
      [req.user.id]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('채팅방 목록 조회 오류:', err.message);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 채팅방 생성
app.post('/api/rooms', authMiddleware, async (req, res) => {
  try {
    const { name, memberIds } = req.body;
    const userId = req.user.id;

    if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({ success: false, message: '멤버를 1명 이상 선택해주세요.' });
    }

    // AI 친구 제한 검사: 채팅방에 AI는 1명만 허용
    const aiCheckResult = await pool.query(
      `SELECT id, nickname FROM users WHERE id = ANY($1) AND is_ai = TRUE`,
      [memberIds]
    );
    const aiCount = aiCheckResult.rows.length;
    
    if (aiCount > 1) {
      return res.status(400).json({ 
        success: false, 
        message: '채팅방에는 AI 친구를 1명만 초대할 수 있습니다. (무한 대화 방지)' 
      });
    }

    // 1:1 채팅: 기존 방이 있으면 반환
    if (memberIds.length === 1) {
      const otherId = memberIds[0];

      const existingRoom = await pool.query(
        `SELECT cr.id, cr.name, cr.type, cr.created_at
         FROM chat_rooms cr
         WHERE cr.type = 'direct'
         AND EXISTS (
           SELECT 1 FROM chat_room_members WHERE room_id = cr.id AND user_id = $1 AND left_at IS NULL
         )
         AND EXISTS (
           SELECT 1 FROM chat_room_members WHERE room_id = cr.id AND user_id = $2 AND left_at IS NULL
         )
         AND (SELECT COUNT(*) FROM chat_room_members WHERE room_id = cr.id AND left_at IS NULL) = 2
         LIMIT 1`,
        [userId, otherId]
      );

      if (existingRoom.rows.length > 0) {
        return res.json({
          success: true,
          data: existingRoom.rows[0],
          message: '기존 채팅방을 반환합니다.',
        });
      }
    }

    // 방 타입 결정
    const roomType = memberIds.length === 1 ? 'direct' : 'group';
    const roomName = roomType === 'group' ? (name || '그룹 채팅') : '';

    // 채팅방 생성
    const roomResult = await pool.query(
      'INSERT INTO chat_rooms (name, type) VALUES ($1, $2) RETURNING id, name, type, created_at',
      [roomName, roomType]
    );
    const room = roomResult.rows[0];

    // 나 자신 + 선택한 멤버들 추가
    const allMembers = [userId, ...memberIds];
    const memberInserts = allMembers.map(
      (memberId, idx) => `($1, $${idx + 2})`
    );
    const memberValues = [room.id, ...allMembers];

    await pool.query(
      `INSERT INTO chat_room_members (room_id, user_id) VALUES ${memberInserts.join(', ')}`,
      memberValues
    );

    res.status(201).json({
      success: true,
      data: room,
      message: '채팅방이 생성되었습니다.',
    });
  } catch (err) {
    console.error('채팅방 생성 오류:', err.message);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 채팅방 상세 정보 (멤버 목록 포함)
app.get('/api/rooms/:roomId', authMiddleware, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    // 내가 해당 방의 멤버인지 확인
    const memberCheck = await pool.query(
      'SELECT id FROM chat_room_members WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL',
      [roomId, userId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ success: false, message: '이 채팅방에 접근할 수 없습니다.' });
    }

    // 채팅방 정보
    const roomResult = await pool.query(
      'SELECT id, name, type, created_at FROM chat_rooms WHERE id = $1',
      [roomId]
    );
    if (roomResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: '채팅방을 찾을 수 없습니다.' });
    }

    // 멤버 목록 (AI 정보 포함)
    const membersResult = await pool.query(
      `SELECT u.id, u.email, u.nickname, u.profile_image, u.status_message, u.is_ai, crm.joined_at
       FROM chat_room_members crm
       JOIN users u ON u.id = crm.user_id
       WHERE crm.room_id = $1 AND crm.left_at IS NULL
       ORDER BY crm.joined_at ASC`,
      [roomId]
    );

    const room = roomResult.rows[0];
    room.members = membersResult.rows;

    res.json({ success: true, data: room });
  } catch (err) {
    console.error('채팅방 상세 조회 오류:', err.message);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 채팅방 나가기
app.post('/api/rooms/:roomId/leave', authMiddleware, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    // left_at 설정 (소프트 삭제)
    const result = await pool.query(
      'UPDATE chat_room_members SET left_at = NOW() WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL RETURNING id',
      [roomId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: '이미 나간 채팅방이거나 멤버가 아닙니다.' });
    }

    // 남은 멤버가 없으면 채팅방 삭제 (정리)
    const remaining = await pool.query(
      'SELECT COUNT(*) AS cnt FROM chat_room_members WHERE room_id = $1 AND left_at IS NULL',
      [roomId]
    );
    if (parseInt(remaining.rows[0].cnt) === 0) {
      await pool.query('DELETE FROM messages WHERE room_id = $1', [roomId]);
      await pool.query('DELETE FROM chat_room_members WHERE room_id = $1', [roomId]);
      await pool.query('DELETE FROM chat_rooms WHERE id = $1', [roomId]);
    }

    res.json({ success: true, message: '채팅방을 나갔습니다.' });
  } catch (err) {
    console.error('채팅방 나가기 오류:', err.message);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 채팅방 읽음 처리
app.put('/api/rooms/:roomId/read', authMiddleware, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    // 멤버 확인 및 last_read_at 업데이트
    const result = await pool.query(
      `UPDATE chat_room_members 
       SET last_read_at = NOW() 
       WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL 
       RETURNING id, last_read_at`,
      [roomId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ success: false, message: '이 채팅방의 멤버가 아닙니다.' });
    }

    res.json({ 
      success: true, 
      data: { last_read_at: result.rows[0].last_read_at },
      message: '읽음 처리 완료' 
    });
  } catch (err) {
    console.error('읽음 처리 오류:', err.message);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 멤버 초대 (그룹 채팅)
app.post('/api/rooms/:roomId/invite', authMiddleware, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { memberIds } = req.body;
    const userId = req.user.id;

    if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({ success: false, message: '초대할 멤버를 선택해주세요.' });
    }

    // 내가 멤버인지 확인
    const memberCheck = await pool.query(
      'SELECT id FROM chat_room_members WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL',
      [roomId, userId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ success: false, message: '이 채팅방의 멤버가 아닙니다.' });
    }

    // 그룹 채팅방인지 확인
    const roomCheck = await pool.query(
      'SELECT type FROM chat_rooms WHERE id = $1',
      [roomId]
    );
    if (roomCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: '채팅방을 찾을 수 없습니다.' });
    }
    if (roomCheck.rows[0].type !== 'group') {
      return res.status(400).json({ success: false, message: '그룹 채팅방에서만 멤버를 초대할 수 있습니다.' });
    }

    // 초대하려는 멤버 중 AI가 있는지 확인
    const aiCheckResult = await pool.query(
      `SELECT id FROM users WHERE id = ANY($1) AND is_ai = TRUE`,
      [memberIds]
    );
    const invitingAICount = aiCheckResult.rows.length;

    if (invitingAICount > 0) {
      // 채팅방에 이미 AI가 있는지 확인
      const existingAIResult = await pool.query(
        `SELECT u.id FROM chat_room_members crm
         JOIN users u ON u.id = crm.user_id
         WHERE crm.room_id = $1 AND crm.left_at IS NULL AND u.is_ai = TRUE`,
        [roomId]
      );
      
      if (existingAIResult.rows.length > 0) {
        return res.status(400).json({ 
          success: false, 
          message: '채팅방에는 AI 친구를 1명만 초대할 수 있습니다. 이미 AI 친구가 있습니다.' 
        });
      }
      
      if (invitingAICount > 1) {
        return res.status(400).json({ 
          success: false, 
          message: '채팅방에는 AI 친구를 1명만 초대할 수 있습니다.' 
        });
      }
    }

    // 멤버 추가 (이미 있는 멤버는 무시)
    for (const memberId of memberIds) {
      await pool.query(
        `INSERT INTO chat_room_members (room_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (room_id, user_id) DO UPDATE SET left_at = NULL`,
        [roomId, memberId]
      );
    }

    res.json({
      success: true,
      message: `${memberIds.length}명을 초대했습니다.`,
    });
  } catch (err) {
    console.error('멤버 초대 오류:', err.message);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// ============================================================
// 9. 메시지 API (/api/rooms/:roomId/messages)
// ============================================================

// AI 응답 생성 함수 (비동기)
async function generateAIResponse(roomId, aiUserId) {
  try {
    // 1. AI 유저의 페르소나 정보 조회
    const aiUserResult = await pool.query(
      `SELECT u.id, u.nickname, ap.system_prompt, ap.display_name
       FROM users u
       JOIN ai_personas ap ON ap.id = u.ai_persona_id
       WHERE u.id = $1 AND u.is_ai = TRUE`,
      [aiUserId]
    );
    if (aiUserResult.rows.length === 0) {
      console.error('AI 유저 정보를 찾을 수 없습니다:', aiUserId);
      return;
    }
    const { system_prompt, display_name } = aiUserResult.rows[0];

    // 2. 최근 대화 이력 조회 (컨텍스트용, 최대 10개)
    const recentMessages = await pool.query(
      `SELECT m.sender_id, m.content, u.is_ai
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.room_id = $1
       ORDER BY m.created_at DESC
       LIMIT 10`,
      [roomId]
    );
    const messages = recentMessages.rows.reverse();

    // 3. OpenAI API 호출
    const chatMessages = [
      { role: 'system', content: system_prompt },
      ...messages.map(m => ({
        role: m.sender_id === aiUserId ? 'assistant' : 'user',
        content: m.content
      }))
    ];

    // 1-2초 딜레이로 자연스러운 대화 연출
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: chatMessages,
      max_tokens: 500,
      temperature: 0.8,
    });

    const aiContent = response.choices[0]?.message?.content;
    if (!aiContent) {
      console.error('AI 응답이 비어있습니다.');
      return;
    }

    // 4. AI가 메시지를 "읽음" 처리 (last_read_at 업데이트)
    await pool.query(
      `UPDATE chat_room_members SET last_read_at = NOW()
       WHERE room_id = $1 AND user_id = $2`,
      [roomId, aiUserId]
    );

    // 5. AI 응답을 메시지로 저장
    await pool.query(
      `INSERT INTO messages (room_id, sender_id, content) VALUES ($1, $2, $3)`,
      [roomId, aiUserId, aiContent.trim()]
    );

    console.log(`[AI 응답] ${display_name}: ${aiContent.substring(0, 50)}...`);
  } catch (err) {
    console.error('AI 응답 생성 오류:', err.message);
  }
}

// 메시지 목록 조회 (커서 기반 페이지네이션)
app.get('/api/rooms/:roomId/messages', authMiddleware, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100); // 최대 100개
    const before = req.query.before; // ISO 타임스탬프 커서

    // 멤버 확인
    const memberCheck = await pool.query(
      'SELECT id FROM chat_room_members WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL',
      [roomId, userId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ success: false, message: '이 채팅방에 접근할 수 없습니다.' });
    }

    // 메시지 조회 (unread_count 포함)
    // unread_count = 전체 활성 멤버 수 - 메시지 작성 시각 이후에 읽은 멤버 수
    let query;
    let values;
    if (before) {
      query = `SELECT m.id, m.room_id, m.sender_id, m.content, m.created_at,
                      u.nickname AS sender_nickname, u.profile_image AS sender_profile_image, u.is_ai AS sender_is_ai,
                      (
                        (SELECT COUNT(*) FROM chat_room_members WHERE room_id = m.room_id AND left_at IS NULL)
                        -
                        (SELECT COUNT(*) FROM chat_room_members WHERE room_id = m.room_id AND left_at IS NULL AND last_read_at >= m.created_at)
                      )::int AS unread_count
               FROM messages m
               JOIN users u ON u.id = m.sender_id
               WHERE m.room_id = $1 AND m.created_at < $2
               ORDER BY m.created_at DESC
               LIMIT $3`;
      values = [roomId, before, limit];
    } else {
      query = `SELECT m.id, m.room_id, m.sender_id, m.content, m.created_at,
                      u.nickname AS sender_nickname, u.profile_image AS sender_profile_image, u.is_ai AS sender_is_ai,
                      (
                        (SELECT COUNT(*) FROM chat_room_members WHERE room_id = m.room_id AND left_at IS NULL)
                        -
                        (SELECT COUNT(*) FROM chat_room_members WHERE room_id = m.room_id AND left_at IS NULL AND last_read_at >= m.created_at)
                      )::int AS unread_count
               FROM messages m
               JOIN users u ON u.id = m.sender_id
               WHERE m.room_id = $1
               ORDER BY m.created_at DESC
               LIMIT $2`;
      values = [roomId, limit];
    }

    const result = await pool.query(query, values);

    // 시간순 정렬로 뒤집기 (최신이 아래로)
    const messages = result.rows.reverse();

    res.json({
      success: true,
      data: messages,
      meta: {
        count: messages.length,
        hasMore: result.rows.length === limit,
      },
    });
  } catch (err) {
    console.error('메시지 조회 오류:', err.message);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 메시지 전송
app.post('/api/rooms/:roomId/messages', authMiddleware, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { content } = req.body;
    const userId = req.user.id;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ success: false, message: '메시지 내용을 입력해주세요.' });
    }

    // 멤버 확인
    const memberCheck = await pool.query(
      'SELECT id FROM chat_room_members WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL',
      [roomId, userId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ success: false, message: '이 채팅방에 메시지를 보낼 수 없습니다.' });
    }

    // 발신자가 AI인지 확인
    const senderCheck = await pool.query(
      'SELECT is_ai FROM users WHERE id = $1',
      [userId]
    );
    const senderIsAI = senderCheck.rows[0]?.is_ai || false;

    // 메시지 저장
    const result = await pool.query(
      `INSERT INTO messages (room_id, sender_id, content) VALUES ($1, $2, $3)
       RETURNING id, room_id, sender_id, content, created_at`,
      [roomId, userId, content.trim()]
    );

    // 발신자 정보 추가
    const message = result.rows[0];
    message.sender_nickname = req.user.nickname;

    // 발신자 프로필 이미지 조회
    const senderInfo = await pool.query(
      'SELECT profile_image FROM users WHERE id = $1',
      [userId]
    );
    message.sender_profile_image = senderInfo.rows[0]?.profile_image || '';

    // unread_count 계산 (전체 활성 멤버 - 1, 본인은 읽은 것으로 처리)
    const memberCountResult = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM chat_room_members WHERE room_id = $1 AND left_at IS NULL',
      [roomId]
    );
    message.unread_count = Math.max(0, (memberCountResult.rows[0]?.cnt || 1) - 1);

    // AI 응답 생성 준비 (발신자가 AI가 아닌 경우에만)
    // Vercel 서버리스에서는 응답 후 비동기 작업이 중단될 수 있으므로 응답 전에 처리
    let aiResponsePromise = null;
    if (!senderIsAI) {
      // 채팅방에 AI 멤버가 있는지 확인
      const aiMemberResult = await pool.query(
        `SELECT u.id FROM chat_room_members crm
         JOIN users u ON u.id = crm.user_id
         WHERE crm.room_id = $1 AND crm.left_at IS NULL AND u.is_ai = TRUE
         LIMIT 1`,
        [roomId]
      );
      
      if (aiMemberResult.rows.length > 0) {
        const aiUserId = aiMemberResult.rows[0].id;
        // AI 응답 생성 (동기적으로 대기)
        aiResponsePromise = generateAIResponse(roomId, aiUserId).catch(err => {
          console.error('AI 응답 생성 실패:', err.message);
        });
      }
    }

    // AI 응답 대기 (최대 10초) - 서버리스 환경에서 안정적으로 동작하도록
    if (aiResponsePromise) {
      await Promise.race([
        aiResponsePromise,
        new Promise(resolve => setTimeout(resolve, 10000))
      ]);
    }

    res.status(201).json({
      success: true,
      data: message,
      message: '메시지가 전송되었습니다.',
    });
  } catch (err) {
    console.error('메시지 전송 오류:', err.message);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// ============================================================
// 10. 에러 핸들링 미들웨어
// ============================================================

// 404 처리 (API 경로만)
app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, message: '존재하지 않는 API 엔드포인트입니다.' });
});

// 전역 에러 핸들러
app.use((err, _req, res, _next) => {
  console.error('서버 에러:', err.message);
  res.status(500).json({ success: false, message: '서버 내부 오류가 발생했습니다.' });
});

// ============================================================
// 11. 서버 시작 / Vercel 서버리스 export
// ============================================================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`TOKKA 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  });
}

module.exports = app;
