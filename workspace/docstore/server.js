require('dotenv').config();

const express = require('express');
const path = require('path');

// ── 필수 환경변수 검증 ────────────────────────────────
const REQUIRED_ENVS = ['DATABASE_URL', 'AUTH_TOKEN_SECRET'];
const missing = REQUIRED_ENVS.filter(key => !process.env[key]?.trim());
if (missing.length > 0) {
  console.error(`[서버 시작 실패] 필수 환경변수 누락: ${missing.join(', ')}`);
  console.error('  .env 파일 또는 Vercel 환경변수 설정을 확인해주세요.');
  if (require.main === module) process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

// ── 미들웨어 ──────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// ── POST /api/login ─────────────────────────────────
const loginHandler = require('./api/login');
app.post('/api/login', (req, res) => loginHandler(req, res));

// ── /api/documents (GET, POST, DELETE) ──────────────
const documentsHandler = require('./api/documents');
app.get('/api/documents', (req, res) => documentsHandler(req, res));
app.post('/api/documents', (req, res) => documentsHandler(req, res));
app.delete('/api/documents', (req, res) => documentsHandler(req, res));

// ── POST /api/upload ──────────────────────────────────
const uploadHandler = require('./api/upload');
app.post('/api/upload', (req, res) => uploadHandler(req, res));

// ── POST /api/upload-url — 대용량 파일 signed upload URL 발급 ──
const uploadUrlHandler = require('./api/upload-url');
app.post('/api/upload-url', (req, res) => uploadUrlHandler(req, res));

// ── POST /api/law ───────────────────────────────────
const lawHandler = require('./api/law');
app.post('/api/law', (req, res) => lawHandler(req, res));

// ── POST /api/law-import ────────────────────────────
const lawImportHandler = require('./api/law-import');
app.post('/api/law-import', (req, res) => lawImportHandler(req, res));

// ── GET /api/search ───────────────────────────────────
const searchHandler = require('./api/search');
app.get('/api/search', (req, res) => searchHandler(req, res));

// ── POST /api/rag ────────────────────────────────────
const ragHandler = require('./api/rag');
app.post('/api/rag', (req, res) => ragHandler(req, res));

// ── POST /api/summary ────────────────────────────────
const summaryHandler = require('./api/summary');
app.post('/api/summary', (req, res) => summaryHandler(req, res));

// ── POST /api/url-import ─────────────────────────────
const urlImportHandler = require('./api/url-import');
app.post('/api/url-import', (req, res) => urlImportHandler(req, res));

// ── POST /api/ocr ────────────────────────────────────
const ocrHandler = require('./api/ocr');
app.post('/api/ocr', (req, res) => ocrHandler(req, res));

// ── /api/api-usage (GET, POST) — API 사용량 + OCR 설정 ──
const apiUsageHandler = require('./api/api-usage');
app.get('/api/api-usage', (req, res) => apiUsageHandler(req, res));
app.post('/api/api-usage', (req, res) => apiUsageHandler(req, res));

// ── GET /api/law-graph — 법령 참조 관계 그래프 ──
const lawGraphHandler = require('./api/law-graph');
app.get('/api/law-graph', (req, res) => lawGraphHandler(req, res));

// ── /api/chat-sessions (GET, POST, DELETE) — 대화 히스토리 ──
const chatSessionsHandler = require('./api/chat-sessions');
app.get('/api/chat-sessions', (req, res) => chatSessionsHandler(req, res));
app.post('/api/chat-sessions', (req, res) => chatSessionsHandler(req, res));
app.delete('/api/chat-sessions', (req, res) => chatSessionsHandler(req, res));

// ── /api/prompts (GET, POST, DELETE) — 프롬프트 템플릿 관리 ──
const promptsHandler = require('./api/prompts');
app.get('/api/prompts', (req, res) => promptsHandler(req, res));
app.post('/api/prompts', (req, res) => promptsHandler(req, res));
app.delete('/api/prompts', (req, res) => promptsHandler(req, res));

// ── /api/observability (GET) — LangFuse 관측성 상태 확인 ──
const observabilityHandler = require('./api/observability');
app.get('/api/observability', (req, res) => observabilityHandler(req, res));

// ── /api/rag-traces (GET, DELETE) — RAG 자체 트레이싱 조회/삭제 ──
const ragTracesHandler = require('./api/rag-traces');
app.get('/api/rag-traces', (req, res) => ragTracesHandler(req, res));
app.delete('/api/rag-traces', (req, res) => ragTracesHandler(req, res));

// ── /api/cross-references (GET, POST) — 교차 참조 매트릭스 ──
const crossRefHandler = require('./api/cross-references');
app.get('/api/cross-references', (req, res) => crossRefHandler(req, res));
app.post('/api/cross-references', (req, res) => crossRefHandler(req, res));

// ── /api/knowledge-graph (GET, POST, DELETE) — 지식 그래프 트리플스토어 ──
const knowledgeGraphHandler = require('./api/knowledge-graph');
app.get('/api/knowledge-graph', (req, res) => knowledgeGraphHandler(req, res));
app.post('/api/knowledge-graph', (req, res) => knowledgeGraphHandler(req, res));
app.delete('/api/knowledge-graph', (req, res) => knowledgeGraphHandler(req, res));

// ── /api/communities (GET, POST, DELETE) — 커뮤니티 탐지 + 요약 + 글로벌 검색 ──
const communitiesHandler = require('./api/communities');
app.get('/api/communities', (req, res) => communitiesHandler(req, res));
app.post('/api/communities', (req, res) => communitiesHandler(req, res));
app.delete('/api/communities', (req, res) => communitiesHandler(req, res));

// ── /api/knowledge-graph-neo4j (GET, POST, DELETE) — Neo4j 지식 그래프 + 비교 ──
const kgNeo4jHandler = require('./api/knowledge-graph-neo4j');
app.get('/api/knowledge-graph-neo4j', (req, res) => kgNeo4jHandler(req, res));
app.post('/api/knowledge-graph-neo4j', (req, res) => kgNeo4jHandler(req, res));
app.delete('/api/knowledge-graph-neo4j', (req, res) => kgNeo4jHandler(req, res));

// ── /api/tokenize-ko (POST, GET) — 한국어 형태소 분석 (로컬 프록시) ──
// Vercel에서는 Python 서버리스 함수로 직접 실행됨
// 로컬 개발 시에는 kiwipiepy가 없으므로 N-gram 폴백 제공
app.post('/api/tokenize-ko', (req, res) => {
  const { texts = [], mode = 'tokens' } = req.body;
  if (!texts.length) return res.status(400).json({ error: 'texts 배열이 필요합니다.' });
  const { generateNgrams } = require('./lib/korean-tokenizer');
  // 로컬 폴백: 간단한 공백 + N-gram 토큰화
  const results = texts.map(text => {
    if (!text || !text.trim()) return { tokens: [], tsvector_text: '' };
    const words = text.split(/\s+/).filter(w => w.length >= 2);
    const tokens = new Set();
    for (const w of words) {
      tokens.add(w);
      for (const ng of generateNgrams(w, 2, 3)) tokens.add(ng);
    }
    const unique = [...tokens];
    return { tokens: unique, tsvector_text: unique.join(' ') };
  });
  res.json({ results, count: results.length, mode, engine: 'ngram-fallback' });
});
app.get('/api/tokenize-ko', (req, res) => {
  res.json({ status: 'ok', engine: 'ngram-fallback (local)', hint: 'Vercel 배포 시 kiwipiepy 사용' });
});

// ── /api/organizations (GET, POST) — 조직 관리 (슈퍼 어드민 전용) ──
const organizationsHandler = require('./api/organizations');
app.get('/api/organizations', (req, res) => organizationsHandler(req, res));
app.post('/api/organizations', (req, res) => organizationsHandler(req, res));

// ── /api/deidentify (GET, POST) — 비식별화 키워드 관리 ──
const deidentifyHandler = require('./api/deidentify');
app.get('/api/deidentify', (req, res) => deidentifyHandler(req, res));
app.post('/api/deidentify', (req, res) => deidentifyHandler(req, res));

// ── /api/crawl-sources (GET, POST, PUT, DELETE) — 크롤링 소스 + 제외 패턴 ──
const crawlSourcesHandler = require('./api/crawl-sources');
app.get('/api/crawl-sources', (req, res) => crawlSourcesHandler(req, res));
app.post('/api/crawl-sources', (req, res) => crawlSourcesHandler(req, res));
app.put('/api/crawl-sources', (req, res) => crawlSourcesHandler(req, res));
app.delete('/api/crawl-sources', (req, res) => crawlSourcesHandler(req, res));

// ── /api/crawl-keywords (GET, POST, PUT, DELETE) — 크롤링 키워드 ──
const crawlKeywordsHandler = require('./api/crawl-keywords');
app.get('/api/crawl-keywords', (req, res) => crawlKeywordsHandler(req, res));
app.post('/api/crawl-keywords', (req, res) => crawlKeywordsHandler(req, res));
app.put('/api/crawl-keywords', (req, res) => crawlKeywordsHandler(req, res));
app.delete('/api/crawl-keywords', (req, res) => crawlKeywordsHandler(req, res));

// ── POST /api/naver-news — 네이버 뉴스 검색 ──
const naverNewsHandler = require('./api/naver-news');
app.post('/api/naver-news', (req, res) => naverNewsHandler(req, res));

// ── /api/settings (GET, POST) — 앱 설정 (카테고리 등) ──
const settingsHandler = require('./api/settings');
app.get('/api/settings', (req, res) => settingsHandler(req, res));
app.post('/api/settings', (req, res) => settingsHandler(req, res));

// ── GET /api/pdf-loaders — PDF 로더 목록 ──
const pdfLoadersHandler = require('./api/pdf-loaders');
app.get('/api/pdf-loaders', (req, res) => pdfLoadersHandler(req, res));

// ── POST /api/split-preview — 청크 분할 미리보기 ──
const splitPreviewHandler = require('./api/split-preview');
app.post('/api/split-preview', (req, res) => splitPreviewHandler(req, res));

// ── POST /api/crawl — 사이트 게시판 크롤링 실행 ──
const crawlHandler = require('./api/crawl');
app.post('/api/crawl', (req, res) => crawlHandler(req, res));

// ── /api/crawl-ingest (GET, POST, DELETE) — 크롤링 결과 지식화 ──
const crawlIngestHandler = require('./api/crawl-ingest');
app.get('/api/crawl-ingest', (req, res) => crawlIngestHandler(req, res));
app.post('/api/crawl-ingest', (req, res) => crawlIngestHandler(req, res));
app.delete('/api/crawl-ingest', (req, res) => crawlIngestHandler(req, res));

// ── 서버 시작 / Vercel 서버리스 export ────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`DocStore 서버 실행 중: http://localhost:${PORT}`);
  });
}

module.exports = app;
