// ============================================
// Supabase 데이터베이스 초기 설정 스크립트
// ============================================
// 이 스크립트는 한 번만 실행하면 돼요!
// 역할: 테이블 생성 + 신발 상품 10개 데이터 삽입
//
// 실행 방법: node setup-db.js

require('dotenv').config();
const { Pool } = require('pg');

// .env 파일에서 데이터베이스 연결 정보를 가져옴
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }  // Supabase는 SSL 연결이 필요해요
});

async function setup() {
  const client = await pool.connect();

  try {
    console.log('Supabase 데이터베이스에 연결되었습니다!');

    // ============================================
    // 1단계: 테이블 생성 (shopping_ prefix 사용)
    // ============================================
    // IF NOT EXISTS = 이미 테이블이 있으면 건너뜀 (에러 방지)

    // 회원 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS shopping_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('shopping_users 테이블 생성 완료');

    // 상품 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS shopping_products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        price INTEGER NOT NULL,
        category VARCHAR(50),
        sizes JSONB DEFAULT '[]',
        image VARCHAR(500),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('shopping_products 테이블 생성 완료');

    // 장바구니 테이블
    // user_id로 어떤 사용자의 장바구니인지, product_id로 어떤 상품인지 연결
    await client.query(`
      CREATE TABLE IF NOT EXISTS shopping_cart_items (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        size INTEGER NOT NULL,
        quantity INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('shopping_cart_items 테이블 생성 완료');

    // 주문 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS shopping_orders (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(100) UNIQUE NOT NULL,
        user_id INTEGER NOT NULL,
        total_amount INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        payment_key VARCHAR(200),
        method VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW(),
        paid_at TIMESTAMP
      )
    `);
    console.log('shopping_orders 테이블 생성 완료');

    // 주문 상품 테이블 — 주문에 포함된 개별 상품들
    await client.query(`
      CREATE TABLE IF NOT EXISTS shopping_order_items (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(100) NOT NULL,
        product_id INTEGER NOT NULL,
        name VARCHAR(100) NOT NULL,
        price INTEGER NOT NULL,
        size INTEGER NOT NULL,
        quantity INTEGER DEFAULT 1
      )
    `);
    console.log('shopping_order_items 테이블 생성 완료');

    // ============================================
    // 2단계: 신발 상품 10개 Seed 데이터 삽입
    // ============================================
    // 이미 데이터가 있으면 건너뜀
    const { rows } = await client.query('SELECT COUNT(*) FROM shopping_products');
    const productCount = parseInt(rows[0].count);

    if (productCount > 0) {
      console.log(`이미 상품 ${productCount}개가 있어서 seed 데이터를 건너뜁니다.`);
    } else {
      // 신발 10개 데이터 삽입
      const products = [
        {
          name: '울트라부스트 5.0',
          description: '최고급 쿠셔닝의 러닝화. 에너지 리턴 기술로 편안한 달리기를 경험하세요.',
          price: 219000,
          category: '러닝화',
          sizes: [250, 255, 260, 265, 270, 275, 280, 285, 290],
          image: 'https://images.unsplash.com/photo-1556048219-bb6978360b84?w=600&h=600&fit=crop'
        },
        {
          name: '스탠스미스 클래식',
          description: '시대를 초월한 클래식 스니커즈. 깔끔한 화이트 디자인의 정석.',
          price: 139000,
          category: '스니커즈',
          sizes: [240, 245, 250, 255, 260, 265, 270, 275, 280],
          image: 'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=600&h=600&fit=crop'
        },
        {
          name: '에어맥스 스포츠',
          description: '통기성 뛰어난 메쉬 소재의 운동화. 가볍고 유연한 착용감.',
          price: 169000,
          category: '운동화',
          sizes: [250, 255, 260, 265, 270, 275, 280],
          image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&h=600&fit=crop'
        },
        {
          name: '클라우드폼 슬라이드',
          description: '극한의 편안함을 제공하는 스포츠 슬리퍼. 샤워 후나 일상에서 완벽.',
          price: 49000,
          category: '슬리퍼',
          sizes: [250, 260, 270, 280, 290],
          image: 'https://images.unsplash.com/photo-1603487742131-4160ec999306?w=600&h=600&fit=crop'
        },
        {
          name: '프리데터 엣지',
          description: '정확한 볼 컨트롤을 위한 축구화. 프로 선수급 퍼포먼스.',
          price: 289000,
          category: '축구화',
          sizes: [250, 255, 260, 265, 270, 275, 280],
          image: 'https://images.unsplash.com/photo-1511886929837-354d827aafe2?w=600&h=600&fit=crop'
        },
        {
          name: '레트로 러너 90',
          description: '90년대 레트로 감성의 러닝화. 빈티지와 현대의 완벽한 조화.',
          price: 159000,
          category: '러닝화',
          sizes: [245, 250, 255, 260, 265, 270, 275, 280],
          image: 'https://images.unsplash.com/photo-1600185365926-3a2ce3cdb9eb?w=600&h=600&fit=crop'
        },
        {
          name: '하이탑 스트릿',
          description: '스트릿 패션의 핵심 아이템. 높은 목으로 발목 보호와 스타일을 동시에.',
          price: 189000,
          category: '스니커즈',
          sizes: [250, 255, 260, 265, 270, 275, 280, 285],
          image: 'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=600&h=600&fit=crop'
        },
        {
          name: '트레일 마스터',
          description: '험난한 산길도 거뜬한 트레일 러닝화. 강력한 그립과 방수 기능.',
          price: 199000,
          category: '러닝화',
          sizes: [255, 260, 265, 270, 275, 280, 285],
          image: 'https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=600&h=600&fit=crop'
        },
        {
          name: '캔버스 로우',
          description: '가벼운 캔버스 소재의 데일리 스니커즈. 어떤 옷에도 잘 어울려요.',
          price: 89000,
          category: '스니커즈',
          sizes: [240, 245, 250, 255, 260, 265, 270, 275, 280],
          image: 'https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?w=600&h=600&fit=crop'
        },
        {
          name: '컴포트 홈 슬리퍼',
          description: '집에서도 편안하게. 메모리폼 깔창의 실내용 슬리퍼.',
          price: 39000,
          category: '슬리퍼',
          sizes: [250, 260, 270, 280],
          image: 'https://images.unsplash.com/photo-1575537302964-96cd47c06b1b?w=600&h=600&fit=crop'
        }
      ];

      for (const p of products) {
        await client.query(
          `INSERT INTO shopping_products (name, description, price, category, sizes, image)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [p.name, p.description, p.price, p.category, JSON.stringify(p.sizes), p.image]
        );
      }
      console.log('신발 상품 10개 seed 데이터 삽입 완료!');
    }

    console.log('\n모든 설정이 완료되었습니다!');

  } catch (err) {
    console.error('설정 중 오류 발생:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

setup();
