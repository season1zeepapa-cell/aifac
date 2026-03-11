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
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');
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
 * @param {string} target - 검색 대상: 'law'(법령), 'admrul'(행정규칙), 'ordin'(자치법규)
 * @returns {Promise<Object>} { totalCount, results, target }
 */
async function searchLaw(query, oc, target = 'law') {
  const encoded = encodeURIComponent(query);
  const validTargets = ['law', 'admrul', 'ordin'];
  const t = validTargets.includes(target) ? target : 'law';
  const url = `https://www.law.go.kr/DRF/lawSearch.do?OC=${oc}&target=${t}&type=JSON&query=${encoded}&display=20`;
  const data = await fetchLawAPI(url);

  // 각 target별 응답 키가 다름
  const rootKey = t === 'admrul' ? 'AdmRulSearch' : t === 'ordin' ? 'OrdinSearch' : 'LawSearch';
  const itemKey = t === 'admrul' ? 'admrul' : t === 'ordin' ? 'ordin' : 'law';

  const root = data[rootKey];
  if (root && root[itemKey]) {
    const items = Array.isArray(root[itemKey]) ? root[itemKey] : [root[itemKey]];
    const results = items.map(l => ({
      id: l['법령일련번호'] || l['행정규칙일련번호'] || l['자치법규일련번호'] || l.lawId || '',
      name: l['법령명한글'] || l['행정규칙명'] || l['자치법규명'] || '',
      shortName: l['법령약칭명'] || '',
      promulgationDate: l['공포일자'] || l['발령일자'] || '',
      enforcementDate: l['시행일자'] || '',
      ministry: l['소관부처명'] || l['소관부처'] || '',
      link: l['법령상세링크'] || l['행정규칙상세링크'] || l['자치법규상세링크'] || '',
      lawType: t === 'admrul' ? (l['행정규칙종류'] || '행정규칙') : t === 'ordin' ? '자치법규' : '',
    }));
    return { totalCount: root.totalCnt || results.length, results, target: t };
  }
  return { totalCount: 0, results: [], target: t };
}

/**
 * 법령 상세 조문 조회
 * @param {string} lawId - 법령일련번호 또는 행정규칙/자치법규 일련번호
 * @param {string} oc - 법제처 API 인증키
 * @param {string} target - 'law' | 'admrul' | 'ordin'
 * @returns {Promise<Object>} { info, articles }
 */
async function getLawDetail(lawId, oc, target = 'law') {
  const validTargets = ['law', 'admrul', 'ordin'];
  const t = validTargets.includes(target) ? target : 'law';
  const url = `https://www.law.go.kr/DRF/lawService.do?OC=${oc}&target=${t}&MST=${lawId}&type=JSON`;
  const data = await fetchLawAPI(url);

  // 응답 루트 키 감지: 법령 / 행정규칙 / 자치법규
  const law = data['법령'] || data.law || data['행정규칙'] || data['자치법규'];
  if (law) {
    const basicInfo = law['기본정보'] || {};
    const info = {
      name: basicInfo['법령명_한글'] || basicInfo['행정규칙명'] || basicInfo['자치법규명'] || law['법령명한글'] || '',
      promulgationDate: basicInfo['공포일자'] || basicInfo['발령일자'] || '',
      enforcementDate: basicInfo['시행일자'] || '',
      ministry: basicInfo['소관부처명'] || basicInfo['소관부처'] || '',
    };

    // 조문 파싱 + 계층 라벨링 (편/장/절/관)
    const joItems = law['조문']?.['조문단위'] || [];
    const joArray = Array.isArray(joItems) ? joItems : [joItems];

    // 현재 계층 위치 추적 (편 > 장 > 절 > 관)
    let currentPart = '';    // 편
    let currentChapter = ''; // 장
    let currentSection = ''; // 절
    let currentSubsection = ''; // 관

    const articles = [];

    for (const jo of joArray) {
      const rawContent = (jo['조문내용'] || '').trim();
      const hasTitle = !!jo['조문제목'];

      // 조문제목이 없는 항목은 계층 구분자 (편/장/절/관)
      if (!hasTitle && rawContent) {
        // "제N편 ...", "제N장 ...", "제N절 ...", "제N관 ..." 패턴 감지
        if (/제\d+편/.test(rawContent)) {
          currentPart = rawContent.replace(/\s+/g, ' ').trim();
          currentChapter = '';
          currentSection = '';
          currentSubsection = '';
        } else if (/제\d+장/.test(rawContent)) {
          currentChapter = rawContent.replace(/\s+/g, ' ').trim();
          currentSection = '';
          currentSubsection = '';
        } else if (/제\d+절/.test(rawContent)) {
          currentSection = rawContent.replace(/\s+/g, ' ').trim();
          currentSubsection = '';
        } else if (/제\d+관/.test(rawContent)) {
          currentSubsection = rawContent.replace(/\s+/g, ' ').trim();
        }
        // 계층 구분자는 조문이 아니므로 건너뜀
        continue;
      }

      // 실제 조문 파싱
      let content = rawContent;

      // 항(hang) 데이터 병합
      const hangData = jo['항'];
      if (hangData) {
        const hangArray = Array.isArray(hangData) ? hangData : [hangData];
        for (const hang of hangArray) {
          const hangContent = hang['항내용'] || '';
          if (hangContent) {
            content += '\n' + hangContent;
          }
          // 호(ho) 데이터
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

      // 라벨 조합: "제1장 총칙 > 제1조(목적)"
      const articleName = `제${jo['조문번호']}조` + (jo['조문가지번호'] ? `의${jo['조문가지번호']}` : '') + (jo['조문제목'] ? `(${jo['조문제목']})` : '');
      const pathParts = [currentPart, currentChapter, currentSection, currentSubsection].filter(Boolean);
      const label = pathParts.length > 0 ? `${pathParts.join(' > ')} > ${articleName}` : articleName;

      articles.push({
        number: jo['조문번호'] || '',
        branchNumber: jo['조문가지번호'] || '',
        title: jo['조문제목'] || '',
        content: content.trim(),
        // 계층 라벨 정보
        part: currentPart,
        chapter: currentChapter,
        section: currentSection,
        subsection: currentSubsection,
        label,
      });
    }

    // 행정규칙/자치법규에서 조문이 없는 경우 — 본문 텍스트를 섹션으로 분할
    if (articles.length === 0) {
      const bodyText = law['본문'] || law['내용'] || '';
      if (bodyText) {
        // 본문을 단락별로 분할 (빈 줄 기준) — 각 단락을 하나의 article로
        const paragraphs = bodyText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
        if (paragraphs.length > 0) {
          paragraphs.forEach((para, idx) => {
            articles.push({
              number: String(idx + 1),
              branchNumber: '',
              title: '',
              content: para,
              part: '', chapter: '', section: '', subsection: '',
              label: `본문 ${idx + 1}`,
            });
          });
        } else {
          // 분할이 안 되면 전체를 하나의 섹션으로
          articles.push({
            number: '1',
            branchNumber: '',
            title: info.name,
            content: bodyText.trim(),
            part: '', chapter: '', section: '', subsection: '',
            label: '본문',
          });
        }
      }
    }

    return { info, articles };
  }
  return { info: null, articles: [] };
}

module.exports = { fetchLawAPI, searchLaw, getLawDetail };
