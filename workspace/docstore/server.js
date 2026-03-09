require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// ── 미들웨어 ──────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// ── /api/documents (GET, POST) ────────────────────────
const documentsHandler = require('./api/documents');
app.get('/api/documents', (req, res) => documentsHandler(req, res));
app.post('/api/documents', (req, res) => documentsHandler(req, res));

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

// ── 서버 시작 / Vercel 서버리스 export ────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`DocStore 서버 실행 중: http://localhost:${PORT}`);
  });
}

module.exports = app;
