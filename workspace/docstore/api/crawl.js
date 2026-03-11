// 사이트 게시판 크롤링 실행 API
// POST /api/crawl { sourceId, keyword, recentDays, titleWeight, contentWeight }
// → 등록된 사이트 게시판에서 게시물 목록 수집 → 점수 계산 → crawl_results 저장
const https = require('https');
const http = require('http');
const { query } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { sendError } = require('../lib/error-handler');

// HTML에서 텍스트 추출
function stripHtml(str) {
  if (!str) return '';
  return str.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// URL 요청 (리다이렉트 포함)
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
        // 인코딩 감지
        const contentType = res.headers['content-type'] || '';
        const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
        let encoding = (charsetMatch && charsetMatch[1]) || 'utf-8';
        if (encoding.toLowerCase() === 'euc-kr' || encoding.toLowerCase() === 'euc_kr') {
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

// 간이 HTML 파서: 게시판 목록에서 게시물 추출
function parseBoard(html, selectors, baseUrl) {
  const results = [];

  // 기본 전략: <a> 태그에서 제목 + href 추출
  // 다양한 정부기관 게시판 패턴 지원
  const patterns = [
    // 패턴 1: <td class="subject"><a href="...">제목</a></td>
    /<tr[^>]*>[\s\S]*?<td[^>]*class="[^"]*(?:subject|title|tit)[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<td[^>]*class="[^"]*(?:date|reg)[^"]*"[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi,
    // 패턴 2: <a href="..." class="...">제목</a> ... <span class="date">날짜</span>
    /<a[^>]*href="([^"]*)"[^>]*class="[^"]*(?:subject|title|link)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
    // 패턴 3: 일반적인 게시판 리스트 (li 기반)
    /<li[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<span[^>]*class="[^"]*date[^"]*"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/li>/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const href = match[1];
      const title = stripHtml(match[2]);
      const dateStr = match[3] ? stripHtml(match[3]) : '';

      if (!title || title.length < 2) continue;

      // 절대 URL 변환
      let fullUrl;
      try {
        fullUrl = new URL(href, baseUrl).href;
      } catch {
        fullUrl = baseUrl + href;
      }

      results.push({
        title,
        url: fullUrl,
        dateStr,
        publishedAt: parseDateStr(dateStr),
      });
    }
    if (results.length > 0) break; // 첫 번째 매칭 패턴 사용
  }

  return results;
}

// 날짜 문자열 파싱 (YYYY-MM-DD, YYYY.MM.DD, MM-DD 등)
function parseDateStr(str) {
  if (!str) return null;
  const clean = str.replace(/\s+/g, '').trim();

  // YYYY-MM-DD 또는 YYYY.MM.DD
  const full = clean.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (full) return new Date(`${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`).toISOString();

  // MM-DD (올해로 추정)
  const short = clean.match(/(\d{1,2})[.\-/](\d{1,2})/);
  if (short) {
    const year = new Date().getFullYear();
    return new Date(`${year}-${short[1].padStart(2, '0')}-${short[2].padStart(2, '0')}`).toISOString();
  }

  return null;
}

// 키워드 매칭 점수 계산
function calculateScore(title, snippet, keyword, titleWeight = 10, contentWeight = 3) {
  const titleLower = (title || '').toLowerCase();
  const snippetLower = (snippet || '').toLowerCase();
  const kwWords = keyword.toLowerCase().split(/\s+/).filter(w => w.length > 0);

  let titleScore = 0;
  let contentScore = 0;

  for (const word of kwWords) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const titleMatches = (titleLower.match(new RegExp(escaped, 'g')) || []).length;
    titleScore += titleMatches * titleWeight;
    const contentMatches = (snippetLower.match(new RegExp(escaped, 'g')) || []).length;
    contentScore += contentMatches * contentWeight;
  }

  return {
    titleScore: Math.round(titleScore * 100) / 100,
    contentScore: Math.round(contentScore * 100) / 100,
    totalScore: Math.round((titleScore + contentScore) * 100) / 100,
  };
}

module.exports = async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return;
  if (req.method !== 'POST') return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });

  const { user, orgId, error: authError } = requireAuth(req);
  if (authError) return res.status(401).json({ error: authError });

  try {
    const { sourceId, keyword, recentDays, titleWeight, contentWeight } = req.body || {};

    if (!sourceId) return res.status(400).json({ error: 'sourceId가 필요합니다.' });
    if (!keyword) return res.status(400).json({ error: 'keyword가 필요합니다.' });

    const days = parseInt(recentDays) || 7;
    const tw = parseFloat(titleWeight) || 10.0;
    const cw = parseFloat(contentWeight) || 3.0;

    // 소스 정보 로드
    const srcResult = await query('SELECT * FROM crawl_sources WHERE id = $1', [sourceId]);
    if (srcResult.rows.length === 0) return res.status(404).json({ error: '소스를 찾을 수 없습니다.' });
    const source = srcResult.rows[0];

    // 제외 패턴 로드
    const exclResult = await query(
      'SELECT url_pattern FROM crawl_exclusions WHERE org_id IS NULL OR org_id = $1',
      [orgId]
    );
    const exclusions = exclResult.rows.map(r => r.url_pattern);

    // 게시판 HTML 가져오기
    const html = await fetchUrl(source.board_url);
    const selectors = source.css_selectors || {};

    // 게시물 목록 파싱
    let posts = parseBoard(html, selectors, source.base_url);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    // 최근 N일 필터
    posts = posts.filter(p => {
      if (!p.publishedAt) return true; // 날짜 파싱 실패 시 포함
      return new Date(p.publishedAt) >= cutoffDate;
    });

    // 제외 패턴 필터
    posts = posts.filter(p => !exclusions.some(pattern => p.url.includes(pattern)));

    // 점수 계산
    let results = posts.map(post => {
      const scores = calculateScore(post.title, '', keyword, tw, cw);
      return {
        title: post.title,
        url: post.url,
        snippet: '',
        publishedAt: post.publishedAt,
        source: 'board',
        sourceName: source.name,
        ...scores,
      };
    });

    // 점수 내림차순 정렬
    results.sort((a, b) => b.totalScore - a.totalScore);

    // crawl_results에 저장 (중복 스킵)
    let savedCount = 0;
    for (const item of results) {
      try {
        await query(
          `INSERT INTO crawl_results (source_id, source_type, title, url, snippet, published_at, relevance_score, title_score, content_score, org_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (url, org_id) DO UPDATE SET
             relevance_score = EXCLUDED.relevance_score,
             title_score = EXCLUDED.title_score,
             content_score = EXCLUDED.content_score,
             crawled_at = NOW()`,
          [sourceId, 'board', item.title, item.url, item.snippet, item.publishedAt, item.totalScore, item.titleScore, item.contentScore, orgId]
        );
        savedCount++;
      } catch (insertErr) {
        if (!insertErr.message.includes('duplicate')) {
          console.warn('[Crawl] 결과 저장 실패:', insertErr.message);
        }
      }
    }

    return res.json({
      source: source.name,
      keyword,
      recentDays: days,
      totalParsed: posts.length,
      savedCount,
      results,
    });
  } catch (err) {
    sendError(res, err, '[Crawl]');
  }
};
