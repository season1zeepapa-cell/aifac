// 법제처 국가법령정보 API 호출 헬퍼
// law.js와 law-import.js에서 공통으로 사용
const https = require('https');
const http = require('http');

/**
 * 법제처 API에 GET 요청을 보내고 응답을 반환
 * @param {string} url - 요청 URL
 * @returns {Promise<Object|string>} JSON 파싱 결과 또는 문자열
 */
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

/**
 * 법령 검색 (법령명으로)
 * @param {string} query - 검색어
 * @param {string} oc - 법제처 API 인증키
 * @returns {Promise<Object>} { totalCount, results }
 */
async function searchLaw(query, oc) {
  const encoded = encodeURIComponent(query);
  const url = `https://www.law.go.kr/DRF/lawSearch.do?OC=${oc}&target=law&type=JSON&query=${encoded}&display=5`;
  const data = await fetchLawAPI(url);

  if (data.LawSearch && data.LawSearch.law) {
    const laws = Array.isArray(data.LawSearch.law) ? data.LawSearch.law : [data.LawSearch.law];
    const results = laws.map(l => ({
      id: l['법령일련번호'] || l.lawId,
      name: l['법령명한글'] || l.lawNameKorean,
      shortName: l['법령약칭명'] || '',
      promulgationDate: l['공포일자'] || '',
      enforcementDate: l['시행일자'] || '',
      ministry: l['소관부처명'] || '',
      link: l['법령상세링크'] || '',
    }));
    return { totalCount: data.LawSearch.totalCnt || results.length, results };
  }
  return { totalCount: 0, results: [] };
}

/**
 * 법령 상세 조문 조회
 * @param {string} lawId - 법령일련번호
 * @param {string} oc - 법제처 API 인증키
 * @returns {Promise<Object>} { info, articles }
 */
async function getLawDetail(lawId, oc) {
  const url = `https://www.law.go.kr/DRF/lawService.do?OC=${oc}&target=law&MST=${lawId}&type=JSON`;
  const data = await fetchLawAPI(url);

  if (data['법령'] || data.law) {
    const law = data['법령'] || data.law;
    const info = {
      name: law['기본정보']?.['법령명_한글'] || law['법령명한글'] || '',
      promulgationDate: law['기본정보']?.['공포일자'] || '',
      enforcementDate: law['기본정보']?.['시행일자'] || '',
      ministry: law['기본정보']?.['소관부처명'] || '',
    };

    // 조문 파싱
    const joItems = law['조문']?.['조문단위'] || [];
    const joArray = Array.isArray(joItems) ? joItems : [joItems];

    const articles = joArray.map(jo => {
      // 기본 조문 내용
      let content = jo['조문내용'] || '';

      // 항(hang) 데이터 병합
      const hangData = jo['항'];
      if (hangData) {
        const hangArray = Array.isArray(hangData) ? hangData : [hangData];
        for (const hang of hangArray) {
          const hangContent = hang['항내용'] || '';
          if (hangContent) {
            content += '\n' + hangContent;
          }
          // 호(ho) 데이터도 있을 수 있음
          const hoData = hang['호'];
          if (hoData) {
            const hoArray = Array.isArray(hoData) ? hoData : [hoData];
            for (const ho of hoArray) {
              const hoContent = ho['호내용'] || '';
              if (hoContent) {
                content += '\n  ' + hoContent;
              }
            }
          }
        }
      }

      return {
        number: jo['조문번호'] || '',
        title: jo['조문제목'] || '',
        content: content.trim(),
      };
    });

    return { info, articles };
  }
  return { info: null, articles: [] };
}

module.exports = { fetchLawAPI, searchLaw, getLawDetail };
