// rag_traces 테이블 생성 마이그레이션
// RAG 질의응답 전 과정을 기록하는 자체 트레이싱 테이블
//
// 기록 내용: 질문 → 쿼리 강화 → 검색 결과 → 프롬프트 → LLM 응답 → 파싱 결과 → 검증
//
// 실행: node scripts/add-rag-traces-table.js
require('dotenv').config();
const { query } = require('../lib/db');

async function migrate() {
  console.log('[마이그레이션] rag_traces 테이블 생성 시작...');

  await query(`
    CREATE TABLE IF NOT EXISTS rag_traces (
      id SERIAL PRIMARY KEY,

      -- 입력
      question TEXT NOT NULL,
      user_id TEXT,
      session_id TEXT,

      -- 설정
      provider TEXT NOT NULL DEFAULT 'gemini',
      model TEXT,
      category TEXT DEFAULT 'default',
      prompt_template TEXT,
      prompt_from_db BOOLEAN DEFAULT false,
      options JSONB DEFAULT '{}',

      -- 쿼리 강화 단계
      query_rewrite JSONB,
      hyde JSONB,

      -- 검색 단계
      search_results JSONB,
      sources_count INTEGER DEFAULT 0,
      hops INTEGER DEFAULT 1,
      cross_refs JSONB,

      -- LLM 호출 단계
      prompt_text TEXT,
      llm_raw_output TEXT,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      cost_estimate NUMERIC(10, 6) DEFAULT 0,

      -- 파싱 단계
      parsed_output JSONB,
      parse_format TEXT,
      parse_warnings JSONB DEFAULT '[]',
      conclusion TEXT,

      -- 검증 단계
      verification JSONB,

      -- 메타
      total_duration_ms INTEGER DEFAULT 0,
      search_duration_ms INTEGER DEFAULT 0,
      llm_duration_ms INTEGER DEFAULT 0,
      status TEXT DEFAULT 'success',
      error_message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // 인덱스
  await query(`CREATE INDEX IF NOT EXISTS idx_rag_traces_created ON rag_traces(created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_rag_traces_user ON rag_traces(user_id, created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_rag_traces_status ON rag_traces(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_rag_traces_provider ON rag_traces(provider, created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_rag_traces_category ON rag_traces(category)`);

  console.log('[마이그레이션] rag_traces 테이블 + 인덱스 생성 완료');
}

migrate()
  .then(() => { console.log('완료'); process.exit(0); })
  .catch(err => { console.error('실패:', err); process.exit(1); });
