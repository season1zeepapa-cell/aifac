// 멀티테넌시: organizations 테이블 + org_id 컬럼 마이그레이션
// 실행: node scripts/add-organizations.js
//
// 변경 사항:
// 1. organizations 테이블 생성 (조직 정의)
// 2. users, documents, chat_sessions, tags에 org_id 컬럼 추가
// 3. 기본 조직('default') 생성 + 기존 데이터 일괄 할당
// 4. tags UNIQUE 제약을 (name, org_id) 복합 유니크로 변경

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getPool } = require('../lib/db');

async function migrate() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    console.log('[멀티테넌시 마이그레이션] 시작...\n');

    await client.query('BEGIN');

    // ── 1. organizations 테이블 생성 ──
    console.log('[1/6] organizations 테이블 생성...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── 2. 각 테이블에 org_id 컬럼 추가 ──
    console.log('[2/6] org_id 컬럼 추가...');

    // users (public 스키마 — workspace/error와 공유, nullable로 영향 없음)
    await client.query(`
      ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id)
    `);

    // documents
    await client.query(`
      ALTER TABLE documents
      ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id)
    `);

    // chat_sessions
    await client.query(`
      ALTER TABLE chat_sessions
      ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id)
    `);

    // tags — 기존 UNIQUE(name)을 (name, org_id) 복합 유니크로 변경
    await client.query(`
      ALTER TABLE tags
      ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id)
    `);

    // tags UNIQUE 제약 변경: 같은 이름의 태그가 다른 조직에 존재 가능
    // 기존 UNIQUE(name) 제거 시도 (이름은 DB마다 다를 수 있음)
    try {
      await client.query(`ALTER TABLE tags DROP CONSTRAINT IF EXISTS tags_name_key`);
    } catch { /* 제약이 없으면 무시 */ }
    // 새 복합 유니크 추가
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_org
      ON tags(name, COALESCE(org_id, 0))
    `);

    // ── 3. 인덱스 생성 ──
    console.log('[3/6] 인덱스 생성...');
    await client.query(`CREATE INDEX IF NOT EXISTS idx_documents_org_id ON documents(org_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_org_id ON public.users(org_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_org_id ON chat_sessions(org_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tags_org_id ON tags(org_id)`);
    // 복합 인덱스: org + deleted_at (문서 목록 조회 최적화)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_documents_org_deleted ON documents(org_id, deleted_at)`);

    // ── 4. 기본 조직 생성 ──
    console.log('[4/6] 기본 조직 생성...');
    await client.query(`
      INSERT INTO organizations (name, slug)
      VALUES ('기본 조직', 'default')
      ON CONFLICT (slug) DO NOTHING
    `);

    // ── 5. 기존 데이터 마이그레이션 — 기본 조직에 할당 ──
    console.log('[5/6] 기존 데이터 기본 조직 할당...');
    const orgResult = await client.query(`SELECT id FROM organizations WHERE slug = 'default'`);
    const defaultOrgId = orgResult.rows[0].id;

    const r1 = await client.query(
      `UPDATE public.users SET org_id = $1 WHERE org_id IS NULL`, [defaultOrgId]
    );
    const r2 = await client.query(
      `UPDATE documents SET org_id = $1 WHERE org_id IS NULL`, [defaultOrgId]
    );
    const r3 = await client.query(
      `UPDATE chat_sessions SET org_id = $1 WHERE org_id IS NULL`, [defaultOrgId]
    );
    const r4 = await client.query(
      `UPDATE tags SET org_id = $1 WHERE org_id IS NULL`, [defaultOrgId]
    );
    console.log(`  users: ${r1.rowCount}건, documents: ${r2.rowCount}건, chat_sessions: ${r3.rowCount}건, tags: ${r4.rowCount}건`);

    // ── 6. 검증 ──
    console.log('[6/6] 검증...');
    const verify = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM organizations) AS org_count,
        (SELECT COUNT(*) FROM public.users WHERE org_id IS NOT NULL) AS users_with_org,
        (SELECT COUNT(*) FROM documents WHERE org_id IS NOT NULL) AS docs_with_org
    `);
    const v = verify.rows[0];

    await client.query('COMMIT');

    console.log(`\n[멀티테넌시 마이그레이션] 완료!`);
    console.log(`  조직 수: ${v.org_count}`);
    console.log(`  org 할당된 사용자: ${v.users_with_org}`);
    console.log(`  org 할당된 문서: ${v.docs_with_org}`);
    console.log(`  기본 조직 ID: ${defaultOrgId}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[멀티테넌시 마이그레이션] 실패:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(() => process.exit(1));
