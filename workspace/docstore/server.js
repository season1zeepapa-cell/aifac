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

// ── /api/deidentify (GET, POST) — 비식별화 키워드 관리 ──
const deidentifyHandler = require('./api/deidentify');
app.get('/api/deidentify', (req, res) => deidentifyHandler(req, res));
app.post('/api/deidentify', (req, res) => deidentifyHandler(req, res));

// ── 서버 시작 / Vercel 서버리스 export ────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`DocStore 서버 실행 중: http://localhost:${PORT}`);
  });
}

module.exports = app;
