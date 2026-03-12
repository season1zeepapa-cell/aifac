// 네이버 뉴스 검색 API 프록시
// POST /api/naver-news { keyword, maxResults, titleWeight, contentWeight }
// → 네이버 검색 API 호출 → 점수 계산 → 결과 반환 + crawl_results 임시 저장
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
    const { keyword, keywordId, maxResults, titleWeight, contentWeight, recentDays } = req.body || {};
    if (!keyword) return res.status(400).json({ error: 'keyword가 필요합니다.' });

    const display = Math.min(parseInt(maxResults) || 20, 100);
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
      // 제외 패턴 없이 계속 진행
    }

    // 네이버 검색 API 호출
    const naverData = await naverSearch(keyword, display);
    if (naverData.errorCode) {
      return res.status(502).json({ error: `네이버 API 에러: ${naverData.errorMessage}` });
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    // 결과 가공 + 점수 계산 + 필터링
    let results = (naverData.items || [])
      .map(item => {
        const cleanTitle = stripHtml(item.title);
        const cleanDesc = stripHtml(item.description);
        const pubDate = new Date(item.pubDate);
        const scores = calculateScore(item, keyword, tw, cw);

        return {
          title: cleanTitle,
          url: item.originallink || item.link,
          snippet: cleanDesc,
          publishedAt: pubDate.toISOString(),
          source: 'naver_news',
          ...scores,
        };
      })
      // 최근 N일 필터
      .filter(item => new Date(item.publishedAt) >= cutoffDate)
      // 제외 패턴 필터
      .filter(item => !exclusions.some(pattern => item.url.includes(pattern)))
      // 점수 내림차순 정렬
      .sort((a, b) => b.totalScore - a.totalScore);

    // 기존 URL 중복 체크
    if (results.length > 0) {
      const urls = results.map(r => r.url);
      const existingDocs = await query(
        `SELECT url FROM crawl_results WHERE url = ANY($1)`,
        [urls]
      );
      const existingUrls = new Set(existingDocs.rows.map(r => r.url));

      // crawl_results에 새 결과 저장 (중복 스킵)
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
            ['naver_news', keywordId || null, item.title, item.url, item.snippet, item.publishedAt, item.totalScore, item.titleScore, item.contentScore, orgId]
          );
        } catch (insertErr) {
          console.warn('[NaverNews] 결과 저장 실패:', insertErr.message);
        }
      }
    }

    return res.json({
      keyword,
      totalResults: naverData.total || 0,
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
