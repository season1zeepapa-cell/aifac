// ========================================
// Todo App 01 - Express 백엔드 서버
// PostgreSQL(Supabase) + JWT 인증
// ========================================
require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ========================================
// 미들웨어 설정
// ========================================
// JSON 요청 본문 파싱 (클라이언트가 보내는 JSON 데이터를 읽기 위해)
app.use(express.json());
// 정적 파일 서빙 (index.html 등)
app.use(express.static(path.join(__dirname)));

// ========================================
// PostgreSQL 연결 (지연 초기화)
// ========================================
let pool = null;

// 데이터베이스 연결 풀을 가져오는 함수
// 처음 호출될 때만 연결을 생성하고, 이후에는 기존 연결을 재사용
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

// ========================================
// 테이블 자동 생성
// ========================================
async function initDatabase() {
  const db = getPool();

  // 사용자 테이블 생성
  await db.query(`
    CREATE TABLE IF NOT EXISTS todo_app_01_users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // 할 일 테이블 생성
  await db.query(`
    CREATE TABLE IF NOT EXISTS todo_app_01_todos (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES todo_app_01_users(id) ON DELETE CASCADE,
      text VARCHAR(500) NOT NULL,
      completed BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  console.log('데이터베이스 테이블 준비 완료');
}

// ========================================
// JWT 인증 미들웨어
// ========================================
// 보호된 API 라우트에서 사용 - 토큰을 검증하고 사용자 정보를 req.user에 저장
function authenticateToken(req, res, next) {
  // Authorization 헤더에서 토큰 추출 (형식: "Bearer 토큰값")
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: '인증 토큰이 필요합니다' });
  }

  try {
    // 토큰 검증 및 디코딩
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, email }
    next();
  } catch (err) {
    return res.status(403).json({ success: false, message: '유효하지 않은 토큰입니다' });
  }
}

// ========================================
// 인증 API 라우트
// ========================================

// 회원가입
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    // 입력값 검증
    if (!email || !password) {
      return res.status(400).json({ success: false, message: '이메일과 비밀번호를 입력해주세요' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: '비밀번호는 6자 이상이어야 합니다' });
    }

    const db = getPool();

    // 이메일 중복 확인
    const existing = await db.query(
      'SELECT id FROM todo_app_01_users WHERE email = $1',
      [email]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, message: '이미 사용 중인 이메일입니다' });
    }

    // 비밀번호 해싱 (bcrypt로 안전하게 저장)
    const hashedPassword = await bcrypt.hash(password, 10);

    // 사용자 생성
    const result = await db.query(
      'INSERT INTO todo_app_01_users (email, password) VALUES ($1, $2) RETURNING id, email, created_at',
      [email, hashedPassword]
    );

    const user = result.rows[0];

    // JWT 토큰 생성
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      data: { token, user: { id: user.id, email: user.email } },
    });
  } catch (err) {
    console.error('회원가입 오류:', err);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다' });
  }
});

// 로그인
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: '이메일과 비밀번호를 입력해주세요' });
    }

    const db = getPool();

    // 사용자 조회
    const result = await db.query(
      'SELECT id, email, password FROM todo_app_01_users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 올바르지 않습니다' });
    }

    const user = result.rows[0];

    // 비밀번호 검증
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 올바르지 않습니다' });
    }

    // JWT 토큰 생성
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      data: { token, user: { id: user.id, email: user.email } },
    });
  } catch (err) {
    console.error('로그인 오류:', err);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다' });
  }
});

// ========================================
// 할 일 CRUD API 라우트 (인증 필요)
// ========================================

// 내 할 일 목록 조회
app.get('/api/todos', authenticateToken, async (req, res) => {
  try {
    const db = getPool();
    const result = await db.query(
      'SELECT id, text, completed, created_at as "createdAt", updated_at as "updatedAt" FROM todo_app_01_todos WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('할 일 조회 오류:', err);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다' });
  }
});

// 할 일 추가
app.post('/api/todos', authenticateToken, async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: '할 일 내용을 입력해주세요' });
    }

    const db = getPool();
    const result = await db.query(
      'INSERT INTO todo_app_01_todos (user_id, text) VALUES ($1, $2) RETURNING id, text, completed, created_at as "createdAt", updated_at as "updatedAt"',
      [req.user.id, text.trim()]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('할 일 추가 오류:', err);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다' });
  }
});

// 할 일 수정 (완료 토글)
app.patch('/api/todos/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { completed } = req.body;

    const db = getPool();
    const result = await db.query(
      'UPDATE todo_app_01_todos SET completed = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING id, text, completed, created_at as "createdAt", updated_at as "updatedAt"',
      [completed, id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: '할 일을 찾을 수 없습니다' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('할 일 수정 오류:', err);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다' });
  }
});

// 완료 항목 일괄 삭제 (주의: 이 라우트를 :id 라우트보다 먼저 정의)
app.delete('/api/todos/completed', authenticateToken, async (req, res) => {
  try {
    const db = getPool();
    const result = await db.query(
      'DELETE FROM todo_app_01_todos WHERE user_id = $1 AND completed = true RETURNING id',
      [req.user.id]
    );

    res.json({ success: true, data: { deletedCount: result.rowCount } });
  } catch (err) {
    console.error('완료 항목 삭제 오류:', err);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다' });
  }
});

// 할 일 개별 삭제
app.delete('/api/todos/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const db = getPool();
    const result = await db.query(
      'DELETE FROM todo_app_01_todos WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: '할 일을 찾을 수 없습니다' });
    }

    res.json({ success: true, data: { id: Number(id) } });
  } catch (err) {
    console.error('할 일 삭제 오류:', err);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다' });
  }
});

// ========================================
// 모든 기타 요청은 index.html로 보내기 (SPA 지원)
// ========================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ========================================
// 서버 시작 (Vercel 호환 패턴)
// ========================================
if (require.main === module) {
  initDatabase()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`서버가 http://localhost:${PORT} 에서 실행 중입니다`);
      });
    })
    .catch((err) => {
      console.error('서버 시작 실패:', err);
      process.exit(1);
    });
}

// Vercel 서버리스 함수로 내보내기
module.exports = app;
