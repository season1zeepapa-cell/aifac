// ============================================
// KICKS 쇼핑몰 서버 — Supabase(PostgreSQL) 연동 버전
// ============================================
// 이전에는 데이터를 메모리(배열/객체)에 저장했지만,
// 이제는 Supabase(PostgreSQL 데이터베이스)에 저장해요.
// 서버를 재시작해도 데이터가 사라지지 않아요!
//
// (비유: 메모장에 적어두던 것을 → 서랍장에 보관하는 것으로 업그레이드!)

require('dotenv').config();  // .env 파일에서 환경변수(DATABASE_URL) 읽기

const express = require('express');
const session = require('express-session');
const path = require('path');
const { Pool } = require('pg');  // PostgreSQL 클라이언트

const app = express();
const PORT = 3000;

// ============================================
// 데이터베이스 연결 설정
// ============================================
// Pool = 데이터베이스와의 연결을 여러 개 미리 만들어두고 재사용하는 것
// (비유: 은행 창구를 여러 개 열어두고, 고객이 오면 빈 창구로 안내하는 것!)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }  // Supabase는 SSL 연결 필요
});

// DB 연결 확인
pool.query('SELECT NOW()')
  .then(() => console.log('Supabase 데이터베이스 연결 성공!'))
  .catch(err => console.error('DB 연결 실패:', err.message));

// ============================================
// 미들웨어 설정
// ============================================

// JSON 요청 본문을 읽을 수 있게 해주는 미들웨어
app.use(express.json());

// 세션 설정 — 로그인 상태를 유지하기 위한 설정
app.use(session({
  secret: 'shopping-mall-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 }  // 24시간
}));

// 정적 파일 서빙
app.use(express.static(path.join(__dirname)));

// ============================================
// 인증 미들웨어 — 로그인 필수 검문소
// ============================================
function requireAuth(req, res, next) {
  const publicPaths = ['/login', '/signup', '/payments/confirm'];
  if (publicPaths.includes(req.path)) {
    return next();
  }
  if (!req.session.user) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  next();
}

app.use('/api', requireAuth);

// ============================================
// 인증 API — Supabase DB 사용
// ============================================

// 회원가입 API
app.post('/api/signup', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 모두 입력해주세요.' });
  }
  if (username.length < 3) {
    return res.status(400).json({ error: '아이디는 3자 이상이어야 합니다.' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: '비밀번호는 4자 이상이어야 합니다.' });
  }

  try {
    // DB에서 같은 아이디가 있는지 확인
    // $1 = 첫 번째 파라미터 (username) — SQL 인젝션 방지를 위해 이렇게 써요!
    const existing = await pool.query(
      'SELECT id FROM shopping_users WHERE username = $1', [username]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: '이미 사용 중인 아이디입니다.' });
    }

    // 새 사용자를 DB에 저장
    // RETURNING * = 저장한 결과를 바로 돌려받음 (INSERT 후 SELECT 안 해도 됨!)
    const result = await pool.query(
      'INSERT INTO shopping_users (username, password) VALUES ($1, $2) RETURNING id, username',
      [username, password]
    );
    const newUser = result.rows[0];

    // 세션에 저장 → 로그인 처리
    req.session.user = { id: newUser.id, username: newUser.username };

    res.status(201).json({
      message: '회원가입이 완료되었습니다!',
      user: { id: newUser.id, username: newUser.username }
    });
  } catch (err) {
    console.error('회원가입 오류:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 로그인 API
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 모두 입력해주세요.' });
  }

  try {
    // DB에서 아이디+비밀번호가 일치하는 사용자 찾기
    const result = await pool.query(
      'SELECT id, username FROM shopping_users WHERE username = $1 AND password = $2',
      [username, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }

    const user = result.rows[0];
    req.session.user = { id: user.id, username: user.username };

    res.json({
      message: '로그인 성공!',
      user: { id: user.id, username: user.username }
    });
  } catch (err) {
    console.error('로그인 오류:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 로그아웃 API
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: '로그아웃에 실패했습니다.' });
    }
    res.json({ message: '로그아웃되었습니다.' });
  });
});

// 현재 로그인 상태 확인 API
app.get('/api/me', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  try {
    // DB에서 가입일 등 추가 정보를 가져옴
    const result = await pool.query(
      'SELECT id, username, created_at FROM shopping_users WHERE id = $1',
      [req.session.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    // DB 오류 시 세션 정보라도 돌려줌
    res.json({ user: req.session.user });
  }
});

// 비밀번호 변경 API
// 현재 비밀번호를 확인한 후, 새 비밀번호로 변경
app.put('/api/me/password', async (req, res) => {
  const userId = req.session.user.id;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: '현재 비밀번호와 새 비밀번호를 모두 입력해주세요.' });
  }

  if (newPassword.length < 4) {
    return res.status(400).json({ error: '새 비밀번호는 4자 이상이어야 합니다.' });
  }

  try {
    // 현재 비밀번호가 맞는지 확인
    const result = await pool.query(
      'SELECT id FROM shopping_users WHERE id = $1 AND password = $2',
      [userId, currentPassword]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
    }

    // 새 비밀번호로 변경
    await pool.query(
      'UPDATE shopping_users SET password = $1 WHERE id = $2',
      [newPassword, userId]
    );

    res.json({ message: '비밀번호가 변경되었습니다.' });
  } catch (err) {
    console.error('비밀번호 변경 오류:', err);
    res.status(500).json({ error: '비밀번호 변경에 실패했습니다.' });
  }
});

// ============================================
// 상품 API — Supabase DB에서 조회
// ============================================

// 상품 전체 목록 조회
app.get('/api/products', async (req, res) => {
  try {
    // DB에서 모든 상품을 id순으로 가져옴
    const result = await pool.query(
      'SELECT * FROM shopping_products ORDER BY id'
    );
    res.json({ products: result.rows });
  } catch (err) {
    console.error('상품 목록 조회 오류:', err);
    res.status(500).json({ error: '상품 목록을 불러오는 데 실패했습니다.' });
  }
});

// 상품 1개 상세 조회
app.get('/api/products/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await pool.query(
      'SELECT * FROM shopping_products WHERE id = $1', [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
    }

    res.json({ product: result.rows[0] });
  } catch (err) {
    console.error('상품 조회 오류:', err);
    res.status(500).json({ error: '상품을 불러오는 데 실패했습니다.' });
  }
});

// ============================================
// 장바구니 API — Supabase DB 사용
// ============================================
// 이제 장바구니가 DB에 저장되니까:
// - 서버 재시작해도 장바구니가 유지돼요!
// - 다른 기기에서 로그인해도 같은 장바구니를 볼 수 있어요!

// 장바구니 조회
app.get('/api/cart', async (req, res) => {
  const userId = req.session.user.id;

  try {
    // 장바구니 아이템과 상품 정보를 JOIN해서 한 번에 가져옴
    // JOIN = 두 테이블을 연결해서 조회하는 것
    // (비유: 장바구니 목록표에 상품 카탈로그를 붙여서 보는 것!)
    const result = await pool.query(`
      SELECT
        ci.id as cart_item_id,
        ci.size,
        ci.quantity,
        p.id, p.name, p.description, p.price, p.category, p.sizes, p.image
      FROM shopping_cart_items ci
      JOIN shopping_products p ON ci.product_id = p.id
      WHERE ci.user_id = $1
      ORDER BY ci.created_at
    `, [userId]);

    // 프론트엔드가 기대하는 형식으로 변환
    // { product: {...상품정보}, size: 270, quantity: 2 }
    const cart = result.rows.map(row => ({
      product: {
        id: row.id,
        name: row.name,
        description: row.description,
        price: row.price,
        category: row.category,
        sizes: row.sizes,
        image: row.image
      },
      size: row.size,
      quantity: row.quantity
    }));

    res.json({ cart });
  } catch (err) {
    console.error('장바구니 조회 오류:', err);
    res.status(500).json({ error: '장바구니를 불러오는 데 실패했습니다.' });
  }
});

// 장바구니에 상품 추가
app.post('/api/cart', async (req, res) => {
  const userId = req.session.user.id;
  const { productId, size, quantity } = req.body;

  if (!productId || !size) {
    return res.status(400).json({ error: '상품 ID와 사이즈를 입력해주세요.' });
  }

  try {
    // 상품이 존재하는지 확인
    const productResult = await pool.query(
      'SELECT id, sizes FROM shopping_products WHERE id = $1', [productId]
    );
    if (productResult.rows.length === 0) {
      return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
    }

    // 사이즈가 유효한지 확인
    const product = productResult.rows[0];
    if (!product.sizes.includes(size)) {
      return res.status(400).json({ error: '유효하지 않은 사이즈입니다.' });
    }

    // 같은 상품+사이즈가 이미 장바구니에 있는지 확인
    const existing = await pool.query(
      'SELECT id, quantity FROM shopping_cart_items WHERE user_id = $1 AND product_id = $2 AND size = $3',
      [userId, productId, size]
    );

    if (existing.rows.length > 0) {
      // 이미 있으면 수량 증가
      await pool.query(
        'UPDATE shopping_cart_items SET quantity = quantity + $1 WHERE id = $2',
        [quantity || 1, existing.rows[0].id]
      );
    } else {
      // 없으면 새로 추가
      await pool.query(
        'INSERT INTO shopping_cart_items (user_id, product_id, size, quantity) VALUES ($1, $2, $3, $4)',
        [userId, productId, size, quantity || 1]
      );
    }

    res.status(201).json({ message: '장바구니에 담았습니다!' });
  } catch (err) {
    console.error('장바구니 추가 오류:', err);
    res.status(500).json({ error: '장바구니에 담는 데 실패했습니다.' });
  }
});

// 장바구니 수량 변경
// :index = 장바구니 목록에서 몇 번째 아이템인지 (0부터 시작)
app.put('/api/cart/:index', async (req, res) => {
  const userId = req.session.user.id;
  const index = parseInt(req.params.index);
  const { quantity } = req.body;

  try {
    // 이 사용자의 장바구니 아이템 목록을 가져옴 (순서 유지)
    const cartResult = await pool.query(
      'SELECT id FROM shopping_cart_items WHERE user_id = $1 ORDER BY created_at',
      [userId]
    );

    // index 번째 아이템이 있는지 확인
    if (!cartResult.rows[index]) {
      return res.status(404).json({ error: '장바구니 아이템을 찾을 수 없습니다.' });
    }

    const cartItemId = cartResult.rows[index].id;

    if (quantity < 1) {
      // 수량이 0 이하면 삭제
      await pool.query('DELETE FROM shopping_cart_items WHERE id = $1', [cartItemId]);
      return res.json({ message: '상품이 삭제되었습니다.' });
    }

    // 수량 업데이트
    await pool.query(
      'UPDATE shopping_cart_items SET quantity = $1 WHERE id = $2',
      [quantity, cartItemId]
    );
    res.json({ message: '수량이 변경되었습니다.' });
  } catch (err) {
    console.error('수량 변경 오류:', err);
    res.status(500).json({ error: '수량 변경에 실패했습니다.' });
  }
});

// 장바구니에서 상품 삭제
app.delete('/api/cart/:index', async (req, res) => {
  const userId = req.session.user.id;
  const index = parseInt(req.params.index);

  try {
    const cartResult = await pool.query(
      'SELECT id FROM shopping_cart_items WHERE user_id = $1 ORDER BY created_at',
      [userId]
    );

    if (!cartResult.rows[index]) {
      return res.status(404).json({ error: '장바구니 아이템을 찾을 수 없습니다.' });
    }

    await pool.query('DELETE FROM shopping_cart_items WHERE id = $1', [cartResult.rows[index].id]);
    res.json({ message: '상품이 삭제되었습니다.' });
  } catch (err) {
    console.error('장바구니 삭제 오류:', err);
    res.status(500).json({ error: '삭제에 실패했습니다.' });
  }
});

// 장바구니 전체 비우기
app.delete('/api/cart', async (req, res) => {
  const userId = req.session.user.id;

  try {
    await pool.query('DELETE FROM shopping_cart_items WHERE user_id = $1', [userId]);
    res.json({ message: '장바구니가 비워졌습니다.' });
  } catch (err) {
    console.error('장바구니 비우기 오류:', err);
    res.status(500).json({ error: '장바구니 비우기에 실패했습니다.' });
  }
});

// ============================================
// 주문 API — Supabase DB 사용
// ============================================

// 주문 생성
app.post('/api/orders', async (req, res) => {
  const userId = req.session.user.id;
  const { orderId } = req.body;

  try {
    // 장바구니에서 상품 정보와 함께 조회
    const cartResult = await pool.query(`
      SELECT ci.product_id, ci.size, ci.quantity, p.name, p.price
      FROM shopping_cart_items ci
      JOIN shopping_products p ON ci.product_id = p.id
      WHERE ci.user_id = $1
    `, [userId]);

    if (cartResult.rows.length === 0) {
      return res.status(400).json({ error: '장바구니가 비어있습니다.' });
    }

    // 총 금액 계산 (서버에서 직접 계산 — 보안!)
    let totalAmount = 0;
    cartResult.rows.forEach(item => {
      totalAmount += item.price * item.quantity;
    });

    const finalOrderId = orderId || `ORDER_${Date.now()}`;

    // 주문 저장
    await pool.query(
      `INSERT INTO shopping_orders (order_id, user_id, total_amount, status)
       VALUES ($1, $2, $3, 'pending')`,
      [finalOrderId, userId, totalAmount]
    );

    // 주문 상품 저장
    for (const item of cartResult.rows) {
      await pool.query(
        `INSERT INTO shopping_order_items (order_id, product_id, name, price, size, quantity)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [finalOrderId, item.product_id, item.name, item.price, item.size, item.quantity]
      );
    }

    res.status(201).json({
      message: '주문이 생성되었습니다.',
      order: {
        id: finalOrderId,
        userId,
        totalAmount,
        status: 'pending',
        items: cartResult.rows
      }
    });
  } catch (err) {
    console.error('주문 생성 오류:', err);
    res.status(500).json({ error: '주문 생성에 실패했습니다.' });
  }
});

// 내 주문 목록 조회
app.get('/api/orders', async (req, res) => {
  const userId = req.session.user.id;

  try {
    const result = await pool.query(
      'SELECT * FROM shopping_orders WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    res.json({ orders: result.rows });
  } catch (err) {
    console.error('주문 목록 조회 오류:', err);
    res.status(500).json({ error: '주문 목록을 불러오는 데 실패했습니다.' });
  }
});

// 주문 상세 조회
app.get('/api/orders/:id', async (req, res) => {
  const userId = req.session.user.id;
  const orderId = req.params.id;

  try {
    // 주문 기본 정보
    const orderResult = await pool.query(
      'SELECT * FROM shopping_orders WHERE order_id = $1 AND user_id = $2',
      [orderId, userId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
    }

    // 주문 상품 목록
    const itemsResult = await pool.query(
      'SELECT * FROM shopping_order_items WHERE order_id = $1',
      [orderId]
    );

    res.json({
      order: {
        ...orderResult.rows[0],
        items: itemsResult.rows
      }
    });
  } catch (err) {
    console.error('주문 조회 오류:', err);
    res.status(500).json({ error: '주문을 불러오는 데 실패했습니다.' });
  }
});

// ============================================
// 토스페이먼츠 결제 API
// ============================================

const TOSS_SECRET_KEY = 'test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6';

// 결제 성공 리다이렉트
app.get('/success', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 결제 실패 리다이렉트
app.get('/fail', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 결제 승인 API
app.post('/api/payments/confirm', async (req, res) => {
  const { paymentKey, orderId, amount } = req.body;

  if (!paymentKey || !orderId || !amount) {
    return res.status(400).json({
      error: '결제 정보가 누락되었습니다. (paymentKey, orderId, amount 필요)'
    });
  }

  try {
    // 토스페이먼츠 결제 승인 API 호출
    const encodedKey = Buffer.from(TOSS_SECRET_KEY + ':').toString('base64');

    const response = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${encodedKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        paymentKey,
        orderId,
        amount: Number(amount),
      }),
    });

    const data = await response.json();

    if (response.ok) {
      console.log('결제 승인 성공:', {
        orderId: data.orderId,
        totalAmount: data.totalAmount,
        method: data.method,
        status: data.status,
      });

      // DB에서 주문 상태를 'paid'로 업데이트
      const orderResult = await pool.query(
        `UPDATE shopping_orders
         SET status = 'paid', payment_key = $1, method = $2, paid_at = NOW()
         WHERE order_id = $3
         RETURNING user_id`,
        [data.paymentKey, data.method, data.orderId]
      );

      // 결제 완료 후 장바구니 비우기
      if (orderResult.rows.length > 0) {
        const userId = orderResult.rows[0].user_id;
        await pool.query('DELETE FROM shopping_cart_items WHERE user_id = $1', [userId]);
      }

      res.json({
        orderId: data.orderId,
        totalAmount: data.totalAmount,
        method: data.method,
        status: data.status,
        approvedAt: data.approvedAt,
      });
    } else {
      console.error('결제 승인 실패:', data.code, data.message);
      res.status(400).json({
        error: data.message || '결제 승인에 실패했습니다.',
        code: data.code,
      });
    }
  } catch (err) {
    console.error('결제 승인 중 서버 오류:', err);
    res.status(500).json({
      error: '결제 승인 처리 중 서버 오류가 발생했습니다.',
    });
  }
});

// ============================================
// 서버 시작
// ============================================
// Vercel 서버리스 환경에서는 app.listen()을 호출하지 않고 모듈로 내보냄
// 로컬 개발 시에는 기존처럼 포트를 열어서 실행
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`🛒 쇼핑몰 서버가 http://localhost:${PORT} 에서 실행 중입니다!`);
  });
}

// Vercel Serverless Function으로 내보내기
module.exports = app;
