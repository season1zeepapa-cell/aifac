// 크롤링 결과 선택적 지식화 API
// POST /api/crawl-ingest { resultIds: [1,2,3], category }
// → crawl_results에서 선택된 항목의 URL 콘텐츠를 가져와서 documents 테이블에 저장
// → 섹션 분리 + 임베딩 자동 처리
// GET /api/crawl-ingest → 크롤링 결과 목록 (미리보기용)
// DELETE /api/crawl-ingest?id=N → 크롤링 결과 삭제
const https = require('https');
const http = require('http');
const { query } = require('../lib/db');
const { requireAuth, orgFilter } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { sendError } = require('../lib/error-handler');

// URL 콘텐츠 가져오기
function fetchUrl(url, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DocStoreCrawler/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        const redirectUrl = new URL(res.headers.location, url).href;
        return fetchUrl(redirectUrl, maxRedirects - 1).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || '';
        const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
        let encoding = (charsetMatch && charsetMatch[1]) || 'utf-8';
        if (encoding.toLowerCase().includes('euc-kr')) {
          try {
            const iconv = require('iconv-lite');
            resolve(iconv.decode(buffer, 'euc-kr'));
          } catch {
            resolve(buffer.toString('utf-8'));
          }
        } else {
          resolve(buffer.toString('utf-8'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('요청 타임아웃')); });
  });
}

// HTML에서 본문 텍스트 추출
function extractText(html) {
  if (!html) return '';
  // script, style, nav, header, footer 등 제거
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '');
  // 본문 영역 우선 추출 시도
  const contentMatch = text.match(/<(?:article|div)[^>]*class="[^"]*(?:content|body|view|detail|article)[^"]*"[^>]*>([\s\S]*?)<\/(?:article|div)>/i);
  if (contentMatch) text = contentMatch[1];
  // HTML 태그 제거
  text = text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ');
  // 공백 정리
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

// 제목 추출
function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (match) return match[1].replace(/<[^>]*>/g, '').trim();
  return '';
}

// 단락 기반 섹션 분할
function splitIntoSections(text) {
  if (!text) return [];
  const paragraphs = text.split(/\n{2,}|\r\n{2,}/).filter(p => p.trim().length >= 30);
  if (paragraphs.length === 0 && text.length >= 30) return [text];
  return paragraphs;
}

module.exports = async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, DELETE, OPTIONS' })) return;

  const { user, orgId, error: authError } = requireAuth(req);
  if (authError) return res.status(401).json({ error: authError });

  try {
    // ── 크롤링 결과 목록 조회 (미리보기) ──
    if (req.method === 'GET') {
      const { clause, params, nextIdx } = orgFilter(orgId, 'r', 1);
      const where = clause ? `WHERE ${clause}` : 'WHERE 1=1';
      const showIngested = req.query.ingested === 'true';

      let filterSql = '';
      if (!showIngested) {
        filterSql = ` AND r.is_ingested = FALSE`;
      }

      const result = await query(
        `SELECT r.id, r.source_type, r.title, r.url, r.snippet, r.published_at,
                r.relevance_score, r.title_score, r.content_score,
                r.is_ingested, r.document_id, r.crawled_at,
                s.name AS source_name
         FROM crawl_results r
         LEFT JOIN crawl_sources s ON r.source_id = s.id
         ${where}${filterSql}
         ORDER BY r.relevance_score DESC, r.crawled_at DESC
         LIMIT 200`,
        params
      );
      return res.json({ results: result.rows });
    }

    // ── 크롤링 결과 삭제 ──
    if (req.method === 'DELETE') {
      const id = parseInt(req.query.id);
      if (id) {
        await query('DELETE FROM crawl_results WHERE id = $1', [id]);
        return res.json({ success: true });
      }
      // 전체 삭제 (ingested 제외)
      if (req.query.clearAll === 'true') {
        await query('DELETE FROM crawl_results WHERE is_ingested = FALSE AND (org_id IS NULL OR org_id = $1)', [orgId]);
        return res.json({ success: true });
      }
      return res.status(400).json({ error: 'id 또는 clearAll=true가 필요합니다.' });
    }

    // ── 선택적 지식화 ──
    if (req.method !== 'POST') return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });

    const { resultIds, category } = req.body || {};
    if (!resultIds || !Array.isArray(resultIds) || resultIds.length === 0) {
      return res.status(400).json({ error: 'resultIds 배열이 필요합니다.' });
    }

    // 선택된 결과 로드
    const selected = await query(
      `SELECT * FROM crawl_results WHERE id = ANY($1) AND is_ingested = FALSE`,
      [resultIds]
    );

    if (selected.rows.length === 0) {
      return res.status(400).json({ error: '지식화할 결과가 없습니다 (이미 처리됨).' });
    }

    const ingestResults = [];
    const { createEmbeddingsForDocument } = require('../lib/embeddings');

    for (const crawlResult of selected.rows) {
      try {
        // 1) URL에서 콘텐츠 가져오기
        let fullText = '';
        let pageTitle = crawlResult.title;
        try {
          const html = await fetchUrl(crawlResult.url);
          fullText = extractText(html);
          const htmlTitle = extractTitle(html);
          if (htmlTitle && htmlTitle.length > pageTitle.length) pageTitle = htmlTitle;
        } catch (fetchErr) {
          console.warn(`[CrawlIngest] URL 가져오기 실패 (${crawlResult.url}):`, fetchErr.message);
          fullText = crawlResult.snippet || '';
        }

        if (fullText.length < 10) fullText = crawlResult.snippet || crawlResult.title;

        // 2) documents 테이블에 저장
        const docResult = await query(
          `INSERT INTO documents (title, file_type, category, metadata, org_id)
           VALUES ($1, 'url', $2, $3, $4)
           RETURNING id`,
          [
            pageTitle,
            category || '크롤링',
            JSON.stringify({
              sourceUrl: crawlResult.url,
              sourceType: crawlResult.source_type,
              crawledAt: crawlResult.crawled_at,
              relevanceScore: crawlResult.relevance_score,
            }),
            orgId,
          ]
        );
        const documentId = docResult.rows[0].id;

        // 3) 섹션 분할 + 저장
        const sections = splitIntoSections(fullText);
        const sectionTexts = sections.length > 0 ? sections : [fullText];
        for (let i = 0; i < sectionTexts.length; i++) {
          await query(
            `INSERT INTO document_sections (document_id, section_type, section_index, raw_text, metadata)
             VALUES ($1, 'paragraph', $2, $3, '{}')`,
            [documentId, i, sectionTexts[i]]
          );
        }

        // 4) 임베딩 생성
        try {
          await createEmbeddingsForDocument({ query }, documentId, 'CrawlIngest', 'sentence');
        } catch (embErr) {
          console.warn(`[CrawlIngest] 임베딩 생성 실패 (docId=${documentId}):`, embErr.message);
        }

        // 5) crawl_results 업데이트
        await query(
          `UPDATE crawl_results SET is_ingested = TRUE, document_id = $1 WHERE id = $2`,
          [documentId, crawlResult.id]
        );

        ingestResults.push({
          crawlResultId: crawlResult.id,
          documentId,
          title: pageTitle,
          sectionCount: sectionTexts.length,
          textLength: fullText.length,
          status: 'success',
        });
      } catch (itemErr) {
        console.error(`[CrawlIngest] 지식화 실패 (id=${crawlResult.id}):`, itemErr.message);
        ingestResults.push({
          crawlResultId: crawlResult.id,
          title: crawlResult.title,
          status: 'error',
          error: itemErr.message,
        });
      }
    }

    return res.json({
      totalRequested: resultIds.length,
      processed: ingestResults.length,
      succeeded: ingestResults.filter(r => r.status === 'success').length,
      failed: ingestResults.filter(r => r.status === 'error').length,
      results: ingestResults,
    });
  } catch (err) {
    sendError(res, err, '[CrawlIngest]');
  }
};
