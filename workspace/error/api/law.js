// Vercel 서버리스 함수 - 국가법령정보 API 프록시
const https = require('https');
const http = require('http');

// 법령 API 요청 헬퍼
function fetchLawAPI(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    }).on('error', reject);
  });
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  const OC = (process.env.LAW_API_OC || '').trim();
  if (!OC) return res.status(500).json({ error: 'LAW_API_OC가 설정되지 않았습니다.' });

  const { action, query, lawId } = req.body;

  try {
    // 1) 법령 검색
    if (action === 'search') {
      if (!query) return res.status(400).json({ error: '검색어(query)가 필요합니다.' });
      const encoded = encodeURIComponent(query);
      const url = `https://www.law.go.kr/DRF/lawSearch.do?OC=${OC}&target=law&type=JSON&query=${encoded}&display=5`;
      const data = await fetchLawAPI(url);
      // 응답 정규화
      if (data.LawSearch && data.LawSearch.law) {
        const laws = Array.isArray(data.LawSearch.law) ? data.LawSearch.law : [data.LawSearch.law];
        const results = laws.map(l => ({
          id: l['법령일련번호'] || l.lawId,
          name: l['법령명한글'] || l.lawNameKorean,
          shortName: l['법령약칭명'] || '',
          promulgationDate: l['공포일자'] || '',
          enforcementDate: l['시행일자'] || '',
          ministry: l['소관부처명'] || '',
          link: l['법령상세링크'] || ''
        }));
        return res.json({ totalCount: data.LawSearch.totalCnt || results.length, results });
      }
      return res.json({ totalCount: 0, results: [], raw: data });
    }

    // 2) 법령 본문(조문) 조회
    if (action === 'detail') {
      if (!lawId) return res.status(400).json({ error: '법령ID(lawId)가 필요합니다.' });
      const url = `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=law&MST=${lawId}&type=JSON`;
      const data = await fetchLawAPI(url);
      // 조문 추출
      if (data['법령'] || data.law) {
        const law = data['법령'] || data.law;
        const info = {
          name: law['기본정보']?.['법령명_한글'] || law['법령명한글'] || '',
          promulgationDate: law['기본정보']?.['공포일자'] || '',
          enforcementDate: law['기본정보']?.['시행일자'] || '',
          ministry: law['기본정보']?.['소관부처명'] || ''
        };
        // 조문 파싱
        let articles = [];
        const joItems = law['조문']?.['조문단위'] || [];
        const joArray = Array.isArray(joItems) ? joItems : [joItems];
        articles = joArray.map(jo => ({
          number: jo['조문번호'] || '',
          title: jo['조문제목'] || '',
          content: jo['조문내용'] || '',
          hang: jo['항'] || null
        }));
        return res.json({ info, articles });
      }
      return res.json({ info: null, articles: [], raw: data });
    }

    return res.status(400).json({ error: 'action은 search 또는 detail이어야 합니다.' });
  } catch (err) {
    console.error('법령 API 에러:', err);
    res.status(500).json({ error: err.message });
  }
};
