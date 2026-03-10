// 웹 URL 크롤링 → 텍스트 추출 → DB 저장 API
// POST /api/url-import
// { url: "https://example.com/page", title: "제목" (선택), category: "기타" (선택) }
const https = require('https');
const http = require('http');
const { chunkText, generateEmbeddings } = require('../lib/embeddings');
const { query } = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { checkRateLimit } = require('../lib/rate-limit');
const { uploadFile, isStorageAvailable } = require('../lib/storage');

/**
 * URL에서 HTML을 가져온 뒤 본문 텍스트를 추출
 */
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DocStore/1.0)',
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
      timeout: 15000,
    }, (res) => {
      // 리다이렉트 처리
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('요청 시간 초과')); });
  });
}

/**
 * HTML에서 본문 텍스트 추출 (태그 제거, script/style 제거)
 */
function extractTextFromHtml(html) {
  // script, style, nav, header, footer 태그 제거
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '');

  // HTML 태그 제거
  text = text.replace(/<[^>]+>/g, ' ');

  // HTML 엔티티 디코딩
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // 연속 공백/줄바꿈 정리
  text = text.replace(/\s+/g, ' ').trim();

  // 문단 복원 (마침표 후 대문자로 시작하면 줄바꿈)
  text = text.replace(/\.\s+/g, '.\n');

  return text;
}

/**
 * HTML에서 title 태그 추출
 */
function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].replace(/<[^>]+>/g, '').trim() : '';
}

/**
 * 텍스트를 단락 기준으로 섹션 분할
 */
function splitIntoParagraphs(text) {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 30);
  if (paragraphs.length === 0) {
    return [{ text: text.trim(), index: 0 }];
  }
  return paragraphs.map((p, i) => ({ text: p.trim(), index: i }));
}

module.exports = async (req, res) => {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  // 인증 체크
  const { error: authError } = requireAdmin(req);
  if (authError) return res.status(401).json({ error: authError });

  if (checkRateLimit(req, res, 'urlImport')) return;

  const { url, title: inputTitle, category = '기타' } = req.body;

  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ error: '유효한 URL이 필요합니다. (http:// 또는 https://)' });
  }

  try {
    console.log(`[URL Import] 크롤링 시작: ${url}`);

    // 1) HTML 가져오기
    const html = await fetchUrl(url);

    // 2) 텍스트 추출
    const extractedText = extractTextFromHtml(html);
    if (extractedText.length < 50) {
      return res.status(400).json({ error: '페이지에서 충분한 텍스트를 추출할 수 없습니다.' });
    }

    // 3) 제목 결정
    const title = inputTitle || extractTitle(html) || new URL(url).hostname;

    // 4) 섹션 분할
    const paragraphs = splitIntoParagraphs(extractedText);

    // 5) DB 저장 (메타 정보만, 원본 HTML은 Storage에 저장)
    const htmlBuffer = Buffer.from(html, 'utf-8');
    const htmlFilename = `${title}.html`;
    const docResult = await query(
      `INSERT INTO documents (title, file_type, category, metadata, original_filename, original_mimetype, file_size)
       VALUES ($1, 'url', $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        title,
        category,
        JSON.stringify({
          sourceUrl: url,
          charCount: extractedText.length,
          sectionCount: paragraphs.length,
        }),
        htmlFilename,
        'text/html',
        htmlBuffer.length,
      ]
    );
    const documentId = docResult.rows[0].id;

    // 원본 HTML을 Supabase Storage에 업로드
    if (isStorageAvailable()) {
      try {
        const storagePath = await uploadFile(htmlBuffer, documentId, htmlFilename, 'text/html');
        await query('UPDATE documents SET storage_path = $1 WHERE id = $2', [storagePath, documentId]);
      } catch (storageErr) {
        console.warn(`[URL Import] Storage 업로드 실패 (문서 ${documentId}):`, storageErr.message);
      }
    }

    for (const para of paragraphs) {
      await query(
        `INSERT INTO document_sections (document_id, section_type, section_index, raw_text, metadata)
         VALUES ($1, 'paragraph', $2, $3, $4)`,
        [documentId, para.index, para.text, JSON.stringify({ sourceUrl: url })]
      );
    }

    console.log(`[URL Import] 저장 완료: 문서 ID ${documentId}, ${paragraphs.length}개 섹션`);

    // 6) 임베딩 생성
    const embeddingPromise = (async () => {
      try {
        let totalChunks = 0;
        const savedSections = await query(
          'SELECT id, raw_text FROM document_sections WHERE document_id = $1 ORDER BY id',
          [documentId]
        );
        for (const section of savedSections.rows) {
          if (!section.raw_text || section.raw_text.trim().length === 0) continue;
          const chunks = chunkText(section.raw_text);
          if (chunks.length === 0) continue;
          const embeddings = await generateEmbeddings(chunks);
          for (let i = 0; i < chunks.length; i++) {
            const vecStr = `[${embeddings[i].join(',')}]`;
            await query(
              `INSERT INTO document_chunks (section_id, chunk_text, embedding, chunk_index)
               VALUES ($1, $2, $3::vector, $4)`,
              [section.id, chunks[i], vecStr, i]
            );
          }
          totalChunks += chunks.length;
        }
        await query(`UPDATE documents SET embedding_status = 'done' WHERE id = $1`, [documentId]);
        console.log(`[URL Import] 임베딩 완료: ${totalChunks}개 청크`);
      } catch (embErr) {
        await query(`UPDATE documents SET embedding_status = 'failed' WHERE id = $1`, [documentId]).catch(() => {});
        console.error(`[URL Import] 임베딩 실패:`, embErr.message);
      }
    })();

    if (process.env.VERCEL) await embeddingPromise;

    res.json({
      success: true,
      documentId,
      title,
      category,
      charCount: extractedText.length,
      sectionCount: paragraphs.length,
    });
  } catch (err) {
    console.error('[URL Import] 에러:', err);
    res.status(500).json({ error: err.message });
  }
};
