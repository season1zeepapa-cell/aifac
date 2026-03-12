// DocStore DB 테이블 생성 스크립트 (전체 스키마 통합)
// 실행: npm run setup-db
//
// 모든 마이그레이션 스크립트(add-*.js)의 내용을 통합하여
// 빈 DB에서 한 번에 전체 스키마를 구축할 수 있다.
// 이미 존재하는 테이블/컬럼/인덱스는 IF NOT EXISTS로 건너뛴다.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query, getPool } = require('../api/db');

async function createTables() {
  console.log('DocStore 전체 스키마 생성 시작...\n');

  try {
    // ════════════════════════════════════════
    // 1. 확장(Extension) 활성화
    // ════════════════════════════════════════
    console.log('1. pgvector 확장 활성화...');
    await query('CREATE EXTENSION IF NOT EXISTS vector;');
    console.log('   완료!\n');

    // ════════════════════════════════════════
    // 2. 핵심 테이블: organizations (다른 테이블이 FK 참조)
    // ════════════════════════════════════════
    console.log('2. organizations 테이블 생성...');
    await query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('   완료!\n');

    // ════════════════════════════════════════
    // 3. documents 테이블 (모든 컬럼 포함)
    // ════════════════════════════════════════
    console.log('3. documents 테이블 생성...');
    await query(`
      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        title VARCHAR(500) NOT NULL,
        file_type VARCHAR(20) DEFAULT 'pdf',
        category VARCHAR(50),
        upload_date TIMESTAMPTZ DEFAULT NOW(),
        metadata JSONB DEFAULT '{}',
        original_file BYTEA,
        original_filename VARCHAR(500),
        original_mimetype VARCHAR(100),
        file_size INT DEFAULT 0,
        storage_path TEXT,
        summary TEXT,
        keywords TEXT[],
        summary_embedding vector(1536),
        deleted_at TIMESTAMPTZ DEFAULT NULL,
        is_favorited BOOLEAN DEFAULT FALSE,
        org_id INTEGER REFERENCES organizations(id)
      )
    `);
    // documents 인덱스
    await query(`CREATE INDEX IF NOT EXISTS idx_documents_not_deleted ON documents (upload_date DESC) WHERE deleted_at IS NULL`);
    await query(`CREATE INDEX IF NOT EXISTS idx_documents_favorited ON documents(is_favorited) WHERE is_favorited = TRUE`);
    await query(`CREATE INDEX IF NOT EXISTS idx_documents_org_id ON documents(org_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_documents_org_deleted ON documents(org_id, deleted_at)`);
    try {
      await query(`CREATE INDEX IF NOT EXISTS idx_documents_summary_embedding ON documents USING hnsw (summary_embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`);
    } catch (e) { /* 벡터 인덱스 생성 실패 무시 (데이터 없을 때) */ }
    console.log('   완료!\n');

    // ════════════════════════════════════════
    // 4. document_sections 테이블
    // ════════════════════════════════════════
    console.log('4. document_sections 테이블 생성...');
    await query(`
      CREATE TABLE IF NOT EXISTS document_sections (
        id SERIAL PRIMARY KEY,
        document_id INT REFERENCES documents(id) ON DELETE CASCADE,
        section_type VARCHAR(20) NOT NULL,
        section_index INT DEFAULT 0,
        raw_text TEXT,
        image_url TEXT,
        summary TEXT,
        fts_vector tsvector,
        fts_morpheme_vector tsvector
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_sections_fts ON document_sections USING GIN (fts_vector)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_sections_fts_morpheme ON document_sections USING GIN (fts_morpheme_vector) WHERE fts_morpheme_vector IS NOT NULL`);
    console.log('   완료!\n');

    // ════════════════════════════════════════
    // 5. document_chunks 테이블
    // ════════════════════════════════════════
    console.log('5. document_chunks 테이블 생성...');
    await query(`
      CREATE TABLE IF NOT EXISTS document_chunks (
        id SERIAL PRIMARY KEY,
        section_id INT REFERENCES document_sections(id) ON DELETE CASCADE,
        chunk_text TEXT NOT NULL,
        embedding vector(1536),
        chunk_index INT DEFAULT 0,
        enriched_text TEXT,
        fts_vector tsvector,
        fts_morpheme_vector tsvector
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_chunks_fts ON document_chunks USING GIN (fts_vector)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_chunks_fts_morpheme ON document_chunks USING GIN (fts_morpheme_vector) WHERE fts_morpheme_vector IS NOT NULL`);
    try {
      await query(`CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw ON document_chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`);
    } catch (e) { /* 벡터 인덱스 생성 실패 무시 */ }
    console.log('   완료!\n');

    // ════════════════════════════════════════
    // 6. FTS 트리거 (전문검색 자동 갱신)
    // ════════════════════════════════════════
    console.log('6. FTS 트리거 생성...');
    await query(`
      CREATE OR REPLACE FUNCTION chunks_fts_trigger_fn()
      RETURNS trigger AS $$
      BEGIN
        NEW.fts_vector := to_tsvector('simple', COALESCE(NEW.chunk_text, ''));
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await query(`
      DROP TRIGGER IF EXISTS trg_chunks_fts ON document_chunks
    `);
    await query(`
      CREATE TRIGGER trg_chunks_fts
      BEFORE INSERT OR UPDATE OF chunk_text ON document_chunks
      FOR EACH ROW EXECUTE FUNCTION chunks_fts_trigger_fn()
    `);
    await query(`
      CREATE OR REPLACE FUNCTION sections_fts_trigger_fn()
      RETURNS trigger AS $$
      BEGIN
        NEW.fts_vector := to_tsvector('simple', COALESCE(NEW.raw_text, ''));
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await query(`
      DROP TRIGGER IF EXISTS trg_sections_fts ON document_sections
    `);
    await query(`
      CREATE TRIGGER trg_sections_fts
      BEFORE INSERT OR UPDATE OF raw_text ON document_sections
      FOR EACH ROW EXECUTE FUNCTION sections_fts_trigger_fn()
    `);
    console.log('   완료!\n');

    // ════════════════════════════════════════
    // 7. tags + document_tags (라벨링)
    // ════════════════════════════════════════
    console.log('7. tags / document_tags 테이블 생성...');
    await query(`
      CREATE TABLE IF NOT EXISTS tags (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        color VARCHAR(7) DEFAULT '#6B7280',
        usage_count INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        org_id INTEGER REFERENCES organizations(id)
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS document_tags (
        document_id INT REFERENCES documents(id) ON DELETE CASCADE,
        tag_id INT REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (document_id, tag_id)
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_document_tags_doc ON document_tags(document_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_document_tags_tag ON document_tags(tag_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_tags_org_id ON tags(org_id)`);
    try {
      await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_org ON tags(name, COALESCE(org_id, 0))`);
    } catch (e) { /* 이미 존재 시 무시 */ }
    console.log('   완료!\n');

    // ════════════════════════════════════════
    // 8. cross_references (교차 참조)
    // ════════════════════════════════════════
    console.log('8. cross_references 테이블 생성...');
    await query(`
      CREATE TABLE IF NOT EXISTS cross_references (
        id SERIAL PRIMARY KEY,
        source_section_id INT REFERENCES document_sections(id) ON DELETE CASCADE,
        target_section_id INT REFERENCES document_sections(id) ON DELETE CASCADE,
        source_document_id INT REFERENCES documents(id) ON DELETE CASCADE,
        target_document_id INT REFERENCES documents(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL,
        confidence FLOAT DEFAULT 1.0,
        context TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(source_section_id, target_section_id, relation_type)
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_crossref_source_doc ON cross_references(source_document_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_crossref_target_doc ON cross_references(target_document_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_crossref_type ON cross_references(relation_type)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_crossref_confidence ON cross_references(confidence DESC)`);
    console.log('   완료!\n');

    // ════════════════════════════════════════
    // 9. chat_sessions (대화 히스토리)
    // ════════════════════════════════════════
    console.log('9. chat_sessions 테이블 생성...');
    await query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '새 대화',
        messages JSONB NOT NULL DEFAULT '[]',
        provider TEXT DEFAULT 'gemini',
        doc_ids INT[] DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        org_id INTEGER REFERENCES organizations(id)
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_org_id ON chat_sessions(org_id)`);
    console.log('   완료!\n');

    // ════════════════════════════════════════
    // 10. 크롤링 테이블 (sources, keywords, exclusions, results)
    // ════════════════════════════════════════
    console.log('10. 크롤링 테이블 생성...');
    await query(`
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
      )
    `);
    await query(`
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
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS crawl_exclusions (
        id SERIAL PRIMARY KEY,
        url_pattern TEXT NOT NULL,
        reason VARCHAR(500),
        org_id INTEGER REFERENCES organizations(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`
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
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_crawl_results_url ON crawl_results(url)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_crawl_results_org ON crawl_results(org_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_crawl_results_ingested ON crawl_results(is_ingested)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_crawl_results_score ON crawl_results(relevance_score DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_crawl_sources_org ON crawl_sources(org_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_crawl_keywords_org ON crawl_keywords(org_id)`);
    console.log('   완료!\n');

    // ════════════════════════════════════════
    // 11. entities + knowledge_triples (지식 그래프)
    // ════════════════════════════════════════
    console.log('11. entities / knowledge_triples 테이블 생성...');
    await query(`
      CREATE TABLE IF NOT EXISTS entities (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        aliases TEXT[] DEFAULT '{}',
        document_id INT REFERENCES documents(id) ON DELETE SET NULL,
        section_id INT REFERENCES document_sections(id) ON DELETE SET NULL,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(name, entity_type, document_id)
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS knowledge_triples (
        id SERIAL PRIMARY KEY,
        subject_id INT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        predicate TEXT NOT NULL,
        object_id INT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        confidence FLOAT DEFAULT 1.0,
        source_document_id INT REFERENCES documents(id) ON DELETE SET NULL,
        source_section_id INT REFERENCES document_sections(id) ON DELETE SET NULL,
        context TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(subject_id, predicate, object_id)
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_entities_doc ON entities(document_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_triples_subject ON knowledge_triples(subject_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_triples_object ON knowledge_triples(object_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_triples_predicate ON knowledge_triples(predicate)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_triples_source_doc ON knowledge_triples(source_document_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_triples_confidence ON knowledge_triples(confidence DESC)`);
    console.log('   완료!\n');

    // ════════════════════════════════════════
    // 12. prompt_templates (프롬프트 템플릿)
    // ════════════════════════════════════════
    console.log('12. prompt_templates 테이블 생성...');
    await query(`
      CREATE TABLE IF NOT EXISTS prompt_templates (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'default',
        stage TEXT NOT NULL DEFAULT 'main',
        template TEXT NOT NULL,
        few_shot_examples JSONB DEFAULT '[]',
        model_params JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        version INTEGER DEFAULT 1,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(name, category)
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_prompt_templates_name_category ON prompt_templates(name, category)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_prompt_templates_active ON prompt_templates(is_active, name)`);
    console.log('   완료!\n');

    // ════════════════════════════════════════
    // 13. rag_traces (RAG 자체 트레이싱)
    // ════════════════════════════════════════
    console.log('13. rag_traces 테이블 생성...');
    await query(`
      CREATE TABLE IF NOT EXISTS rag_traces (
        id SERIAL PRIMARY KEY,
        question TEXT NOT NULL,
        user_id TEXT,
        session_id TEXT,
        provider TEXT NOT NULL DEFAULT 'gemini',
        model TEXT,
        category TEXT DEFAULT 'default',
        prompt_template TEXT,
        prompt_from_db BOOLEAN DEFAULT false,
        options JSONB DEFAULT '{}',
        query_rewrite JSONB,
        hyde JSONB,
        search_results JSONB,
        sources_count INTEGER DEFAULT 0,
        hops INTEGER DEFAULT 1,
        cross_refs JSONB,
        prompt_text TEXT,
        llm_raw_output TEXT,
        tokens_in INTEGER DEFAULT 0,
        tokens_out INTEGER DEFAULT 0,
        cost_estimate NUMERIC(10, 6) DEFAULT 0,
        parsed_output JSONB,
        parse_format TEXT,
        parse_warnings JSONB DEFAULT '[]',
        conclusion TEXT,
        verification JSONB,
        total_duration_ms INTEGER DEFAULT 0,
        search_duration_ms INTEGER DEFAULT 0,
        llm_duration_ms INTEGER DEFAULT 0,
        status TEXT DEFAULT 'success',
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_rag_traces_created ON rag_traces(created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_rag_traces_user ON rag_traces(user_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_rag_traces_status ON rag_traces(status)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_rag_traces_provider ON rag_traces(provider, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_rag_traces_category ON rag_traces(category)`);
    console.log('   완료!\n');

    // ════════════════════════════════════════
    // 14. api_usage + api_key_status (API 사용량 추적)
    // ════════════════════════════════════════
    console.log('14. api_usage / api_key_status 테이블 생성...');
    await query(`
      CREATE TABLE IF NOT EXISTS api_usage (
        id SERIAL PRIMARY KEY,
        provider VARCHAR(30) NOT NULL,
        model VARCHAR(50) NOT NULL,
        endpoint VARCHAR(100) NOT NULL,
        tokens_in INT DEFAULT 0,
        tokens_out INT DEFAULT 0,
        cost_estimate NUMERIC(10,6) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'success',
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage(created_at)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_api_usage_provider ON api_usage(provider, created_at)`);
    await query(`
      CREATE TABLE IF NOT EXISTS api_key_status (
        provider VARCHAR(30) PRIMARY KEY,
        is_active BOOLEAN DEFAULT true,
        last_checked TIMESTAMPTZ,
        last_error TEXT,
        daily_limit INT DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`
      INSERT INTO api_key_status (provider, daily_limit) VALUES
        ('openai', 500), ('anthropic', 50), ('gemini', 300)
      ON CONFLICT (provider) DO NOTHING
    `);
    console.log('   완료!\n');

    // ════════════════════════════════════════
    // 15. app_settings (앱 설정 키-값)
    // ════════════════════════════════════════
    console.log('15. app_settings 테이블 생성...');
    await query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('   완료!\n');

    // ════════════════════════════════════════
    // 16. ocr_engine_config (OCR 엔진 설정)
    // ════════════════════════════════════════
    console.log('16. ocr_engine_config 테이블 생성...');
    await query(`
      CREATE TABLE IF NOT EXISTS ocr_engine_config (
        id SERIAL PRIMARY KEY,
        engine_id VARCHAR(50) NOT NULL UNIQUE,
        display_name VARCHAR(100) NOT NULL,
        provider VARCHAR(50) NOT NULL,
        is_enabled BOOLEAN DEFAULT true,
        priority_order INT DEFAULT 99,
        config JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`
      INSERT INTO ocr_engine_config (engine_id, display_name, provider, is_enabled, priority_order) VALUES
        ('upstage-ocr', 'Upstage OCR', 'upstage', true, 1),
        ('gemini-vision', 'Gemini Vision', 'gemini', true, 2),
        ('claude-vision', 'Claude Vision', 'anthropic', true, 3)
      ON CONFLICT (engine_id) DO NOTHING
    `);
    console.log('   완료!\n');

    // ════════════════════════════════════════
    // 17. deidentify_words (비식별화 키워드)
    // ════════════════════════════════════════
    console.log('17. deidentify_words 테이블 생성...');
    await query(`
      CREATE TABLE IF NOT EXISTS deidentify_words (
        id SERIAL PRIMARY KEY,
        keyword TEXT NOT NULL UNIQUE,
        replacement TEXT DEFAULT '***',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('   완료!\n');

    // ════════════════════════════════════════
    // 18. rate_limits (API 요청 제한)
    // ════════════════════════════════════════
    console.log('18. rate_limits 테이블 생성...');
    await query(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        key VARCHAR(255) PRIMARY KEY,
        count INT DEFAULT 1,
        window_start TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('   완료!\n');

    // ════════════════════════════════════════
    console.log('══════════════════════════════════════');
    console.log('전체 18개 테이블 + 인덱스 + 트리거 생성 완료!');
    console.log('══════════════════════════════════════');
  } catch (err) {
    console.error('테이블 생성 실패:', err.message);
    process.exit(1);
  } finally {
    const pool = getPool();
    await pool.end();
  }
}

createTables();
