// 사이트 게시판 크롤링 실행 API
// POST /api/crawl { sourceId, keywords[], maxResults, recentDays, titleWeight, contentWeight }
// → 등록된 사이트 게시판에서 게시물 수집 → 사이트중요도 + 멀티키워드 점수 합산 → 상위 N건 저장
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
// 한국 정부기관 사이트는 GPKI 인증서를 사용하므로 SSL 검증 스킵 필요
function fetchUrl(url, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
      },
      timeout: 15000,
      rejectUnauthorized: false, // 정부기관 GPKI 인증서 허용
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
// 한국 정부기관 게시판의 다양한 패턴을 지원
function parseBoard(html, selectors, baseUrl) {
  const results = [];

  // tbody 영역 추출 (게시판 본문만 파싱)
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const targetHtml = tbodyMatch ? tbodyMatch[1] : html;

  // TR 단위로 분리
  const trs = targetHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const tr of trs) {
    let title = '';
    let href = '';
    let dateStr = '';

    // 제목 추출: <span class="ellipsis">제목</span> 또는 <a> 태그 텍스트
    const ellipsisMatch = tr.match(/<span[^>]*class="[^"]*ellipsis[^"]*"[^>]*>([^<]+)</i);
    if (ellipsisMatch) {
      title = stripHtml(ellipsisMatch[1]);
    } else {
      // a 태그에서 제목 추출 (href="#"이나 javascript: 제외)
      const aMatch = tr.match(/<a[^>]*>[\s\S]*?<\/a>/i);
      if (aMatch) title = stripHtml(aMatch[0]);
    }

    if (!title || title.length < 3) continue;

    // URL 추출 방법 1: onclick="$bbs.view('id', 'viewPath', ...)" (정부 게시판 공통)
    const onclickMatch = tr.match(/onclick="[^"]*(?:\$bbs\.view|fn_detail|goView|goDetail|viewArticle)\s*\(\s*'(\d+)'\s*,\s*'([^']*)'/i);
    if (onclickMatch) {
      const articleId = onclickMatch[1];
      const viewPath = onclickMatch[2];
      // viewPath에 ? 포함 여부에 따라 구분자 선택
      const separator = viewPath.includes('?') ? '&' : '?';
      href = `${viewPath}${separator}nttSn=${articleId}`;
    }

    // URL 추출 방법 2: 표준 href (javascript:, # 제외)
    if (!href) {
      const hrefMatch = tr.match(/<a[^>]*href="([^"]*)"[^>]*>/i);
      if (hrefMatch && hrefMatch[1] !== '#' && !hrefMatch[1].startsWith('javascript:')) {
        href = hrefMatch[1];
      }
    }

    if (!href) continue;

    // 날짜 추출: YYYY-MM-DD 또는 YYYY.MM.DD 패턴
    const dateMatch = tr.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    if (dateMatch) dateStr = dateMatch[0];

    // 절대 URL 변환
    let fullUrl;
    try {
      fullUrl = new URL(href, baseUrl).href;
    } catch {
      fullUrl = baseUrl + (href.startsWith('/') ? '' : '/') + href;
    }

    results.push({
      title,
      url: fullUrl,
      dateStr,
      publishedAt: parseDateStr(dateStr),
    });
  }

  // tbody가 없거나 결과가 없으면 기존 패턴으로 폴백
  if (results.length === 0) {
    const fallbackPatterns = [
      // 패턴 1: <a href="실제URL">제목</a> (일반 링크)
      /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    ];
    for (const pattern of fallbackPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const h = match[1];
        const t = stripHtml(match[2]);
        if (!t || t.length < 5 || h === '#' || h.startsWith('javascript:')) continue;
        // 게시물 링크 패턴 (postSeq, nttSn, boardSeq 등)
        if (!/(?:postSeq|nttSn|boardSeq|articleId|bbsId|seq=|view)/i.test(h)) continue;
        let fullUrl;
        try { fullUrl = new URL(h, baseUrl).href; } catch { fullUrl = baseUrl + h; }
        results.push({ title: t, url: fullUrl, dateStr: '', publishedAt: null });
      }
      if (results.length > 0) break;
    }
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

  let step = 'init';
  try {
    const { sourceId, keyword, keywords, maxResults, recentDays, titleWeight, contentWeight } = req.body || {};

    if (!sourceId) return res.status(400).json({ error: 'sourceId가 필요합니다.' });
    // 멀티 키워드 지원 (하위 호환: 단일 keyword도 허용)
    const kwList = keywords || (keyword ? [keyword] : []);
    if (kwList.length === 0) return res.status(400).json({ error: 'keywords가 필요합니다.' });

    const topN = Math.min(parseInt(maxResults) || 20, 100);
    const days = parseInt(recentDays) || 7;
    const tw = parseFloat(titleWeight) || 10.0;
    const cw = parseFloat(contentWeight) || 3.0;

    // importance 컬럼 없으면 추가
    step = 'alter-table';
    try {
      await query('ALTER TABLE crawl_sources ADD COLUMN IF NOT EXISTS importance NUMERIC(5,2) DEFAULT 1.0');
    } catch (_) { /* 이미 존재하면 무시 */ }

    // 소스 정보 로드 (중요도 포함)
    step = 'load-source';
    const srcResult = await query('SELECT * FROM crawl_sources WHERE id = $1', [sourceId]);
    if (srcResult.rows.length === 0) return res.status(404).json({ error: '소스를 찾을 수 없습니다.' });
    const source = srcResult.rows[0];
    const siteImportance = parseFloat(source.importance) || 1.0;

    // 제외 패턴 로드
    step = 'load-exclusions';
    const exclResult = await query(
      'SELECT url_pattern FROM crawl_exclusions WHERE org_id IS NULL OR org_id = $1',
      [orgId]
    );
    const exclusions = exclResult.rows.map(r => r.url_pattern);

    // 게시판 HTML 가져오기
    step = `fetch-url:${source.board_url}`;
    const html = await fetchUrl(source.board_url);
    const selectors = source.css_selectors || {};

    // 게시물 목록 파싱
    step = 'parse-board';
    let posts = parseBoard(html, selectors, source.base_url);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    // 최근 N일 필터
    posts = posts.filter(p => {
      if (!p.publishedAt) return true;
      return new Date(p.publishedAt) >= cutoffDate;
    });

    // 제외 패턴 필터
    posts = posts.filter(p => !exclusions.some(pattern => p.url.includes(pattern)));

    // 멀티 키워드 점수 합산 + 사이트 중요도 가산
    step = 'score-calc';
    let results = posts.map(post => {
      let totalTitleScore = 0;
      let totalContentScore = 0;

      for (const kw of kwList) {
        const scores = calculateScore(post.title, '', kw, tw, cw);
        totalTitleScore += scores.titleScore;
        totalContentScore += scores.contentScore;
      }

      // 사이트 중요도를 가산 (기본 1.0, 높을수록 우선순위 올라감)
      const totalScore = (totalTitleScore + totalContentScore) * siteImportance;

      return {
        title: post.title,
        url: post.url,
        snippet: '',
        publishedAt: post.publishedAt,
        source: 'board',
        sourceName: source.name,
        titleScore: Math.round(totalTitleScore * 100) / 100,
        contentScore: Math.round(totalContentScore * 100) / 100,
        totalScore: Math.round(totalScore * 100) / 100,
        siteImportance,
      };
    });

    // 스코어 상위 N건 필터
    results.sort((a, b) => b.totalScore - a.totalScore);
    results = results.slice(0, topN);

    // crawl_results에 저장 (중복 스킵)
    step = 'save-results';
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
      keywords: kwList,
      topN,
      recentDays: days,
      totalParsed: posts.length,
      savedCount,
      results,
    });
  } catch (err) {
    console.error(`[Crawl] 에러 (step=${step}):`, err);
    return res.status(500).json({
      error: `[${step}] ${err.message}`,
      step,
    });
  }
};
