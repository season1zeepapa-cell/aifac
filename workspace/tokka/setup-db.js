// Supabase DB 테이블 생성 스크립트
// 실행: npm run setup-db
require('dotenv').config();
const { Pool } = require('pg');

// 여러 연결 방식 시도
const originalUrl = process.env.DATABASE_URL;
// 프로젝트 ref에서 올바른 연결 URL 구성
const supabaseUrl = process.env.SUPABASE_URL;
const projectRef = supabaseUrl ? supabaseUrl.replace('https://', '').replace('.supabase.co', '') : '';

// 연결 URL 후보들
const connectionUrls = [
  originalUrl, // 원본 URL
  originalUrl.replace(':6543/', ':5432/'), // 세션 모드 포트
  `postgresql://postgres.${projectRef}:VphUMgqXo4V5fPam@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres`, // 올바른 ref
  `postgresql://postgres.${projectRef}:VphUMgqXo4V5fPam@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres`, // 올바른 ref + 세션모드
];

let pool;

const setupSQL = `
-- 0. AI 페르소나 테이블 (users 테이블보다 먼저 생성 - FK 참조용)
CREATE TABLE IF NOT EXISTS ai_personas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  avatar_url TEXT DEFAULT '',
  system_prompt TEXT NOT NULL,
  description TEXT DEFAULT '',
  personality_tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 1. 유저 테이블
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  nickname VARCHAR(50) NOT NULL,
  profile_image TEXT DEFAULT '',
  status_message VARCHAR(200) DEFAULT '',
  is_ai BOOLEAN DEFAULT FALSE,
  ai_persona_id UUID REFERENCES ai_personas(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- AI 컬럼 마이그레이션 (기존 테이블 대응)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_ai BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_persona_id UUID REFERENCES ai_personas(id) ON DELETE SET NULL;

-- 2. 친구 관계 테이블
CREATE TABLE IF NOT EXISTS friendships (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'accepted' CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, friend_id)
);

-- 3. 채팅방 테이블
CREATE TABLE IF NOT EXISTS chat_rooms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(100) DEFAULT '',
  type VARCHAR(10) DEFAULT 'direct' CHECK (type IN ('direct', 'group')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. 채팅방 멤버 테이블
CREATE TABLE IF NOT EXISTS chat_room_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  left_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  last_read_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(room_id, user_id)
);

-- 기존 테이블에 last_read_at 컬럼 추가 (마이그레이션)
ALTER TABLE chat_room_members ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 5. 메시지 테이블
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성 (빠른 조회용)
CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_room_members_user ON chat_room_members(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_room_members_room ON chat_room_members(room_id, last_read_at);
CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id);

-- Supabase Realtime 활성화 (messages 테이블) - 이미 등록된 경우 무시
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Supabase Realtime 활성화 (chat_room_members 테이블 - 읽음 상태 실시간 반영용)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE chat_room_members;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AI 페르소나 인덱스
CREATE INDEX IF NOT EXISTS idx_users_is_ai ON users(is_ai) WHERE is_ai = TRUE;

-- 6. 탈퇴 설문 테이블 (회원 정보와 분리하여 익명 저장)
CREATE TABLE IF NOT EXISTS withdrawal_surveys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reasons TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
`;

// RLS 정책 SQL (멱등성 보장 - DROP IF EXISTS 후 재생성)
const rlsSQL = `
-- ============================================================
-- RLS 활성화
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_personas ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 기존 정책 제거 (멱등성)
-- ============================================================
DROP POLICY IF EXISTS "anon_select_users" ON users;
DROP POLICY IF EXISTS "anon_select_friendships" ON friendships;
DROP POLICY IF EXISTS "anon_select_chat_rooms" ON chat_rooms;
DROP POLICY IF EXISTS "anon_select_chat_room_members" ON chat_room_members;
DROP POLICY IF EXISTS "anon_select_messages" ON messages;
DROP POLICY IF EXISTS "anon_insert_messages" ON messages;
DROP POLICY IF EXISTS "service_all_users" ON users;
DROP POLICY IF EXISTS "service_all_friendships" ON friendships;
DROP POLICY IF EXISTS "service_all_chat_rooms" ON chat_rooms;
DROP POLICY IF EXISTS "service_all_chat_room_members" ON chat_room_members;
DROP POLICY IF EXISTS "service_all_messages" ON messages;
DROP POLICY IF EXISTS "anon_select_ai_personas" ON ai_personas;
DROP POLICY IF EXISTS "service_all_ai_personas" ON ai_personas;

-- ============================================================
-- anon 역할: SELECT만 허용 (Realtime 구독용)
-- ============================================================

-- users: 프로필 정보 조회 (닉네임, 이미지 등)
CREATE POLICY "anon_select_users" ON users
  FOR SELECT TO anon
  USING (true);

-- friendships: 친구 관계 조회
CREATE POLICY "anon_select_friendships" ON friendships
  FOR SELECT TO anon
  USING (true);

-- chat_rooms: 채팅방 정보 조회
CREATE POLICY "anon_select_chat_rooms" ON chat_rooms
  FOR SELECT TO anon
  USING (true);

-- chat_room_members: 멤버 조회
CREATE POLICY "anon_select_chat_room_members" ON chat_room_members
  FOR SELECT TO anon
  USING (true);

-- messages: 메시지 조회 (Realtime INSERT 이벤트 수신에 필수)
CREATE POLICY "anon_select_messages" ON messages
  FOR SELECT TO anon
  USING (true);

-- ai_personas: AI 페르소나 조회
CREATE POLICY "anon_select_ai_personas" ON ai_personas
  FOR SELECT TO anon
  USING (true);

-- ============================================================
-- service_role: 모든 작업 허용 (서버 API용)
-- (service_role은 기본적으로 RLS를 우회하지만 명시적 정책 추가)
-- ============================================================
CREATE POLICY "service_all_users" ON users
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_all_friendships" ON friendships
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_all_chat_rooms" ON chat_rooms
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_all_chat_room_members" ON chat_room_members
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_all_messages" ON messages
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_all_ai_personas" ON ai_personas
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
`;

// 기본 AI 페르소나 시드 데이터
const seedPersonasSQL = `
INSERT INTO ai_personas (name, display_name, avatar_url, system_prompt, description, personality_tags)
VALUES 
  ('dajeong', '다정이', '', 
   '너는 "다정이"라는 이름의 따뜻하고 공감적인 AI 친구야. 항상 상대방의 이야기에 진심으로 귀 기울이고, 위로와 격려의 말을 건네. 존댓말보다는 친한 친구처럼 반말을 사용해. 이모티콘을 적절히 사용하고, 답변은 2-3문장으로 짧고 따뜻하게 해줘.',
   '따뜻하고 공감 잘 해주는 친구',
   ARRAY['다정다감', '위로형', '공감왕']),
  
  ('tsundere', '츤데레', '',
   '너는 "츤데레"라는 이름의 겉으론 차갑지만 속은 따뜻한 AI 친구야. 처음엔 퉁명스럽게 대답하지만, 결국엔 도움을 주고 걱정해줘. "흥", "별로야", "어쩔 수 없지" 같은 표현을 자주 써. 반말을 사용하고, 답변은 2-3문장으로 짧게 해줘.',
   '겉으론 차갑지만 속은 따뜻한 친구',
   ARRAY['츤데레', '장난기', '솔직함']),
  
  ('smarty', '똑똑이', '',
   '너는 "똑똑이"라는 이름의 박식하고 논리적인 AI 친구야. 질문에 정확하고 유용한 정보를 제공해주지만, 딱딱하지 않게 친근하게 설명해줘. 반말을 사용하고, 답변은 2-3문장으로 핵심만 간결하게 해줘.',
   '박식하고 논리적인 조언가',
   ARRAY['지적', '분석적', '도움됨']),
  
  ('positive', '긍정이', '',
   '너는 "긍정이"라는 이름의 밝고 에너지 넘치는 AI 친구야. 항상 긍정적인 시각으로 상황을 바라보고, 응원과 격려를 아끼지 않아. "화이팅!", "넌 할 수 있어!", "대박!" 같은 표현을 자주 써. 반말을 사용하고, 이모티콘을 많이 사용해. 답변은 2-3문장으로 밝게 해줘.',
   '밝고 에너지 넘치는 응원단',
   ARRAY['긍정적', '활발', '응원왕']),
  
  ('emotional', '감성이', '',
   '너는 "감성이"라는 이름의 시적이고 감성적인 AI 친구야. 일상적인 것에서도 아름다움을 발견하고, 감성적인 표현으로 대화해. 가끔 짧은 시구나 명언을 인용하기도 해. 반말을 사용하고, 답변은 2-3문장으로 감성적으로 해줘.',
   '시적이고 감성적인 예술가',
   ARRAY['감성적', '문학적', '예술적'])
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  system_prompt = EXCLUDED.system_prompt,
  description = EXCLUDED.description,
  personality_tags = EXCLUDED.personality_tags;
`;

async function tryConnect(url, label) {
  const p = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    const client = await p.connect();
    console.log(`[${label}] 연결 성공!`);
    return { pool: p, client };
  } catch (err) {
    console.log(`[${label}] 연결 실패: ${err.message}`);
    await p.end().catch(() => {});
    return null;
  }
}

async function setup() {
  let connection = null;
  for (let i = 0; i < connectionUrls.length; i++) {
    connection = await tryConnect(connectionUrls[i], `방식 ${i + 1}`);
    if (connection) break;
  }

  if (!connection) {
    console.error('모든 연결 방식 실패. DATABASE_URL을 확인해주세요.');
    process.exit(1);
  }

  const { pool: connPool, client } = connection;
  try {
    console.log('DB 테이블 생성 시작...');
    await client.query(setupSQL);
    console.log('모든 테이블이 성공적으로 생성되었습니다!');

    const result = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('users', 'friendships', 'chat_rooms', 'chat_room_members', 'messages')
      ORDER BY table_name
    `);
    console.log('생성된 테이블:', result.rows.map(r => r.table_name).join(', '));

    // RLS 정책 적용
    console.log('\nRLS 정책 적용 시작...');
    await client.query(rlsSQL);
    console.log('RLS 정책이 성공적으로 적용되었습니다!');

    // RLS 상태 확인
    const rlsCheck = await client.query(`
      SELECT tablename, rowsecurity
      FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename IN ('users', 'friendships', 'chat_rooms', 'chat_room_members', 'messages', 'ai_personas')
      ORDER BY tablename
    `);
    rlsCheck.rows.forEach(r => {
      console.log(`  ${r.tablename}: RLS ${r.rowsecurity ? 'ON' : 'OFF'}`);
    });

    // 정책 확인
    const policyCheck = await client.query(`
      SELECT tablename, policyname
      FROM pg_policies
      WHERE schemaname = 'public'
      ORDER BY tablename, policyname
    `);
    console.log(`\n적용된 RLS 정책 (${policyCheck.rows.length}개):`);
    policyCheck.rows.forEach(r => {
      console.log(`  ${r.tablename} → ${r.policyname}`);
    });

    // AI 페르소나 시드 데이터 삽입
    console.log('\nAI 페르소나 시드 데이터 삽입...');
    await client.query(seedPersonasSQL);
    const personaCheck = await client.query('SELECT name, display_name FROM ai_personas ORDER BY name');
    console.log(`AI 페르소나 (${personaCheck.rows.length}개):`);
    personaCheck.rows.forEach(r => {
      console.log(`  ${r.name} → ${r.display_name}`);
    });
  } catch (err) {
    console.error('DB 설정 오류:', err.message);
  } finally {
    client.release();
    await connPool.end();
  }
}

setup();
