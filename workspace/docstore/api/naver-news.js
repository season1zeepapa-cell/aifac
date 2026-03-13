// 네이버 뉴스 검색 API 프록시
// POST /api/naver-news { keywords[], maxResults, titleWeight, contentWeight }
// → 멀티 키워드별 네이버 검색 → 점수 합산 → 스코어 상위 N건 반환 + crawl_results 저장
const { query } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { setCors } = require('../lib/cors');

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

// HTML 엔티티 및 태그 제거
function stripHtml(str) {
  if (!str) return '';
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .trim();
}

// 네이버 검색 API 호출 (fetch 기반)
async function naverSearch(keyword, display = 20) {
  const params = new URLSearchParams({
    query: keyword,
    display: Math.min(display, 100).toString(),
    sort: 'date',
  });
  const url = `https://openapi.naver.com/v1/search/news.json?${params}`;
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Naver-Client-Id': NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`네이버 API 응답 에러 (${resp.status}): ${text}`);
  }
  return resp.json();
}

// 키워드 매칭 점수 계산
function calculateScore(item, keyword, titleWeight = 10, contentWeight = 3) {
  const title = stripHtml(item.title).toLowerCase();
  const desc = stripHtml(item.description).toLowerCase();
  const kw = keyword.toLowerCase();
  const kwWords = kw.split(/\s+/).filter(w => w.length > 0);

  let titleScore = 0;
  let contentScore = 0;

  for (const word of kwWords) {
    // 제목에서 매칭 횟수
    const titleMatches = (title.match(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    titleScore += titleMatches * titleWeight;

    // 내용에서 매칭 횟수
    const contentMatches = (desc.match(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
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

  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    return res.status(500).json({ error: '네이버 API 키가 설정되지 않았습니다.' });
  }

  try {
    const { keyword, keywords, keywordId, keywordIds, maxResults, titleWeight, contentWeight, recentDays } = req.body || {};
    // 멀티 키워드 지원 (하위 호환: 단일 keyword도 허용)
    const kwList = keywords || (keyword ? [keyword] : []);
    const kwIdList = keywordIds || (keywordId ? [keywordId] : []);
    if (kwList.length === 0) return res.status(400).json({ error: 'keywords가 필요합니다.' });

    const topN = Math.min(parseInt(maxResults) || 20, 100);
    const tw = parseFloat(titleWeight) || 10.0;
    const cw = parseFloat(contentWeight) || 3.0;
    const days = parseInt(recentDays) || 7;

    // 제외 패턴 로드
    let exclusions = [];
    try {
      const exclResult = await query(
        'SELECT url_pattern FROM crawl_exclusions WHERE org_id IS NULL OR org_id = $1',
        [orgId]
      );
      exclusions = exclResult.rows.map(r => r.url_pattern);
    } catch (dbErr) {
      console.error('[NaverNews] 제외 패턴 로드 실패:', dbErr.message);
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    // 멀티 키워드별로 네이버 API 호출 → URL별 점수 합산
    const urlMap = new Map(); // url → { item, totalTitle, totalContent }

    for (const kw of kwList) {
      // 각 키워드별 100건 최대 요청
      const naverData = await naverSearch(kw, 100);
      if (naverData.errorCode) continue;

      for (const item of (naverData.items || [])) {
        const cleanTitle = stripHtml(item.title);
        const cleanDesc = stripHtml(item.description);
        const pubDate = new Date(item.pubDate);
        const url = item.originallink || item.link;

        // 날짜 필터
        if (pubDate < cutoffDate) continue;
        // 제외 패턴 필터
        if (exclusions.some(pattern => url.includes(pattern))) continue;

        const scores = calculateScore(item, kw, tw, cw);

        if (urlMap.has(url)) {
          // 이미 다른 키워드에서 발견 → 점수 합산
          const existing = urlMap.get(url);
          existing.titleScore += scores.titleScore;
          existing.contentScore += scores.contentScore;
          existing.totalScore += scores.totalScore;
        } else {
          urlMap.set(url, {
            title: cleanTitle,
            url,
            snippet: cleanDesc,
            publishedAt: pubDate.toISOString(),
            source: 'naver_news',
            titleScore: scores.titleScore,
            contentScore: scores.contentScore,
            totalScore: scores.totalScore,
          });
        }
      }
    }

    // 스코어 상위 N건 필터
    let results = [...urlMap.values()]
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, topN);

    // 기존 URL 중복 체크 + 저장
    if (results.length > 0) {
      const urls = results.map(r => r.url);
      const existingDocs = await query(
        `SELECT url FROM crawl_results WHERE url = ANY($1)`,
        [urls]
      );
      const existingUrls = new Set(existingDocs.rows.map(r => r.url));

      for (const item of results) {
        if (existingUrls.has(item.url)) {
          item.isDuplicate = true;
          continue;
        }
        try {
          await query(
            `INSERT INTO crawl_results (source_type, keyword_id, title, url, snippet, published_at, relevance_score, title_score, content_score, org_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (url, org_id) DO UPDATE SET
               relevance_score = EXCLUDED.relevance_score,
               title_score = EXCLUDED.title_score,
               content_score = EXCLUDED.content_score,
               crawled_at = NOW()`,
            ['naver_news', kwIdList[0] || null, item.title, item.url, item.snippet, item.publishedAt, item.totalScore, item.titleScore, item.contentScore, orgId]
          );
        } catch (insertErr) {
          console.warn('[NaverNews] 결과 저장 실패:', insertErr.message);
        }
      }
    }

    return res.json({
      keywords: kwList,
      topN,
      displayCount: results.length,
      recentDays: days,
      results,
    });
  } catch (err) {
    console.error('[NaverNews] 에러:', err);
    const msg = err.message || '네이버 뉴스 검색 실패';
    return res.status(500).json({ error: `네이버 API 검색 실패: ${msg}` });
  }
};
