// 크롤링 & 지식화 시스템용 테이블 생성 마이그레이션
// crawl_sources: 크롤링 대상 사이트
// crawl_keywords: 검색 키워드 + 점수 설정
// crawl_exclusions: 제외 사이트/URL 패턴
// crawl_results: 크롤링 결과 임시 저장
require('dotenv').config();
const { Pool } = require('pg');

async function migrate() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) 크롤링 소스 (사이트 정보)
    await client.query(`
      CREATE TABLE IF NOT EXISTS crawl_sources (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        base_url TEXT NOT NULL,
        board_url TEXT NOT NULL,
        site_type VARCHAR(50) DEFAULT 'board',
        css_selectors JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT TRUE,
        org_id INTEGER REFERENCES organizations(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('[OK] crawl_sources 테이블 생성');

    // 2) 크롤링 키워드 + 점수 설정
    await client.query(`
      CREATE TABLE IF NOT EXISTS crawl_keywords (
        id SERIAL PRIMARY KEY,
        keyword VARCHAR(200) NOT NULL,
        max_results INTEGER DEFAULT 20,
        title_weight NUMERIC(5,2) DEFAULT 10.0,
        content_weight NUMERIC(5,2) DEFAULT 3.0,
        is_active BOOLEAN DEFAULT TRUE,
        org_id INTEGER REFERENCES organizations(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('[OK] crawl_keywords 테이블 생성');

    // 3) 제외 URL 패턴
    await client.query(`
      CREATE TABLE IF NOT EXISTS crawl_exclusions (
        id SERIAL PRIMARY KEY,
        url_pattern TEXT NOT NULL,
        reason VARCHAR(500),
        org_id INTEGER REFERENCES organizations(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('[OK] crawl_exclusions 테이블 생성');

    // 4) 크롤링 결과 (미리보기 + 선택적 지식화용)
    await client.query(`
      CREATE TABLE IF NOT EXISTS crawl_results (
        id SERIAL PRIMARY KEY,
        source_id INTEGER REFERENCES crawl_sources(id) ON DELETE SET NULL,
        keyword_id INTEGER REFERENCES crawl_keywords(id) ON DELETE SET NULL,
        source_type VARCHAR(50) NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        snippet TEXT,
        full_text TEXT,
        published_at TIMESTAMPTZ,
        relevance_score NUMERIC(10,4) DEFAULT 0,
        title_score NUMERIC(10,4) DEFAULT 0,
        content_score NUMERIC(10,4) DEFAULT 0,
        is_ingested BOOLEAN DEFAULT FALSE,
        document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
        org_id INTEGER REFERENCES organizations(id),
        crawled_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(url, org_id)
      );
    `);
    console.log('[OK] crawl_results 테이블 생성');

    // 인덱스
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crawl_results_url ON crawl_results(url);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crawl_results_org ON crawl_results(org_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crawl_results_ingested ON crawl_results(is_ingested);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crawl_results_score ON crawl_results(relevance_score DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crawl_sources_org ON crawl_sources(org_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crawl_keywords_org ON crawl_keywords(org_id);`);
    console.log('[OK] 인덱스 생성');

    // 기본 크롤링 소스 3개 삽입
    const defaultSources = [
      {
        name: 'KISA (한국인터넷진흥원)',
        base_url: 'https://www.kisa.or.kr',
        board_url: 'https://www.kisa.or.kr/401',
        css_selectors: JSON.stringify({
          listSelector: '.board_list tbody tr',
          titleSelector: 'td.subject a',
          dateSelector: 'td.date',
          linkPrefix: 'https://www.kisa.or.kr',
        }),
      },
      {
        name: '개인정보포털',
        base_url: 'https://www.privacy.go.kr',
        board_url: 'https://www.privacy.go.kr/front/bbs/bbsList.do?bbsNo=BBSMSTR_000000000001',
        css_selectors: JSON.stringify({
          listSelector: '.board_list tbody tr',
          titleSelector: 'td.subject a',
          dateSelector: 'td.date',
          linkPrefix: 'https://www.privacy.go.kr',
        }),
      },
      {
        name: '개인정보보호위원회',
        base_url: 'https://www.pipc.go.kr',
        board_url: 'https://www.pipc.go.kr/np/cop/bbs/selectBoardList.do?bbsId=BS074&mCode=C020010000',
        css_selectors: JSON.stringify({
          listSelector: '.board_list tbody tr',
          titleSelector: 'td.subject a',
          dateSelector: 'td.date',
          linkPrefix: 'https://www.pipc.go.kr',
        }),
      },
    ];

    for (const src of defaultSources) {
      await client.query(
        `INSERT INTO crawl_sources (name, base_url, board_url, css_selectors)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [src.name, src.base_url, src.board_url, src.css_selectors]
      );
    }
    console.log('[OK] 기본 크롤링 소스 3개 등록');

    await client.query('COMMIT');
    console.log('\n[완료] 크롤링 테이블 마이그레이션 성공!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[실패]', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(() => process.exit(1));
