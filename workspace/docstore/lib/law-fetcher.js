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
  // 공백 제거 후 검색 (법제처 API는 공백 없이 검색해야 정확한 결과)
  const encoded = encodeURIComponent(query.replace(/\s+/g, ''));
  const validTargets = ['law', 'admrul', 'ordin'];
  const t = validTargets.includes(target) ? target : 'law';
  const url = `https://www.law.go.kr/DRF/lawSearch.do?OC=${oc}&target=${t}&type=JSON&query=${encoded}&display=20`;
  const data = await fetchLawAPI(url);

  // 각 target별 응답 키가 다름
  const rootKey = t === 'admrul' ? 'AdmRulSearch' : t === 'ordin' ? 'OrdinSearch' : 'LawSearch';
  // 자치법규(OrdinSearch)도 아이템 키가 'law'임 (API 사양)
  const itemKey = t === 'admrul' ? 'admrul' : 'law';

  const root = data[rootKey];
  if (root && root[itemKey]) {
    const items = Array.isArray(root[itemKey]) ? root[itemKey] : [root[itemKey]];
    const results = items.map(l => ({
      id: l['법령일련번호'] || l['행정규칙일련번호'] || l['자치법규일련번호'] || l.lawId || '',
      name: l['법령명한글'] || l['행정규칙명'] || l['자치법규명'] || '',
      shortName: l['법령약칭명'] || '',
      promulgationDate: l['공포일자'] || l['발령일자'] || '',
      enforcementDate: l['시행일자'] || '',
      ministry: l['소관부처명'] || l['소관부처'] || l['지자체기관명'] || '',
      link: l['법령상세링크'] || l['행정규칙상세링크'] || l['자치법규상세링크'] || '',
      lawType: t === 'admrul' ? (l['행정규칙종류'] || '행정규칙') : t === 'ordin' ? (l['자치법규종류'] || '자치법규') : '',
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

  // 행정규칙만 MST 대신 ID 파라미터 사용 (법령/자치법규는 MST)
  const idParam = t === 'admrul' ? `ID=${lawId}` : `MST=${lawId}`;
  const url = `https://www.law.go.kr/DRF/lawService.do?OC=${oc}&target=${t}&${idParam}&type=JSON`;
  const data = await fetchLawAPI(url);

  // ── 행정규칙 전용 파싱 (응답: AdmRulService) ──
  if (t === 'admrul' && data.AdmRulService) {
    const svc = data.AdmRulService;
    const bi = svc['행정규칙기본정보'] || {};
    const info = {
      name: bi['행정규칙명'] || '',
      promulgationDate: bi['발령일자'] || '',
      enforcementDate: bi['시행일자'] || '',
      ministry: bi['소관부처명'] || '',
    };

    // 조문내용: 숫자 키 객체 → 문자열 배열
    const joRaw = svc['조문내용'] || {};
    const textItems = Object.keys(joRaw)
      .filter(k => /^\d+$/.test(k))
      .sort((a, b) => +a - +b)
      .map(k => joRaw[k])
      .filter(v => typeof v === 'string' && v.trim());

    return { info, articles: parseAdmRulArticles(textItems) };
  }

  // ── 자치법규 파싱 (응답: LawService, 기본정보: 자치법규기본정보, 조문: 조문.조) ──
  if (t === 'ordin' && data.LawService) {
    const svc = data.LawService;
    const bi = svc['자치법규기본정보'] || {};
    const info = {
      name: bi['자치법규명'] || '',
      promulgationDate: bi['공포일자'] || '',
      enforcementDate: bi['시행일자'] || '',
      ministry: bi['지자체기관명'] || '',
    };

    // 자치법규 조문: 조문.조 배열 (각 항목: 조문번호, 조제목, 조내용)
    const joData = svc['조문']?.['조'] || svc['조문']?.['조문단위'] || [];
    const joArray = Array.isArray(joData) ? joData : (joData ? [joData] : []);
    return { info, articles: parseOrdinArticles(joArray) };
  }

  // ── 법령 파싱 (응답: 법령) ──
  const law = data['법령'] || data.law;
  if (law) {
    const basicInfo = law['기본정보'] || {};
    const info = {
      name: basicInfo['법령명_한글'] || law['법령명한글'] || '',
      promulgationDate: basicInfo['공포일자'] || '',
      enforcementDate: basicInfo['시행일자'] || '',
      ministry: basicInfo['소관부처명'] || '',
    };

    const joItems = law['조문']?.['조문단위'] || [];
    return { info, articles: parseLawArticles(joItems) };
  }

  return { info: null, articles: [] };
}

/**
 * 법령 조문단위 (구조화된 객체 배열) 파싱
 * @param {Array|Object} joItems - 조문단위 데이터
 * @returns {Array} articles
 */
function parseLawArticles(joItems) {
  const joArray = Array.isArray(joItems) ? joItems : [joItems];

  let currentPart = '';
  let currentChapter = '';
  let currentSection = '';
  let currentSubsection = '';
  const articles = [];

  for (const jo of joArray) {
    const rawContent = (jo['조문내용'] || '').trim();
    const hasTitle = !!jo['조문제목'];

    if (!hasTitle && rawContent) {
      if (/제\d+편/.test(rawContent)) {
        currentPart = rawContent.replace(/\s+/g, ' ').trim();
        currentChapter = ''; currentSection = ''; currentSubsection = '';
      } else if (/제\d+장/.test(rawContent)) {
        currentChapter = rawContent.replace(/\s+/g, ' ').trim();
        currentSection = ''; currentSubsection = '';
      } else if (/제\d+절/.test(rawContent)) {
        currentSection = rawContent.replace(/\s+/g, ' ').trim();
        currentSubsection = '';
      } else if (/제\d+관/.test(rawContent)) {
        currentSubsection = rawContent.replace(/\s+/g, ' ').trim();
      }
      continue;
    }

    let content = rawContent;
    const hangData = jo['항'];
    if (hangData) {
      const hangArray = Array.isArray(hangData) ? hangData : [hangData];
      for (const hang of hangArray) {
        if (hang['항내용']) content += '\n' + hang['항내용'];
        const hoData = hang['호'];
        if (hoData) {
          const hoArray = Array.isArray(hoData) ? hoData : [hoData];
          for (const ho of hoArray) {
            if (ho['호내용']) content += '\n  ' + ho['호내용'];
          }
        }
      }
    }

    const articleName = `제${jo['조문번호']}조` + (jo['조문가지번호'] ? `의${jo['조문가지번호']}` : '') + (jo['조문제목'] ? `(${jo['조문제목']})` : '');
    const pathParts = [currentPart, currentChapter, currentSection, currentSubsection].filter(Boolean);
    const label = pathParts.length > 0 ? `${pathParts.join(' > ')} > ${articleName}` : articleName;

    articles.push({
      number: jo['조문번호'] || '',
      branchNumber: jo['조문가지번호'] || '',
      title: jo['조문제목'] || '',
      content: content.trim(),
      part: currentPart, chapter: currentChapter,
      section: currentSection, subsection: currentSubsection,
      label,
    });
  }
  return articles;
}

/**
 * 자치법규 조문 파싱 (조문.조 배열)
 * 각 항목: { 조문번호, 조제목, 조내용, 조문여부 }
 * @param {Array} joArray
 * @returns {Array} articles
 */
function parseOrdinArticles(joArray) {
  const articles = [];

  for (const jo of joArray) {
    const content = (jo['조내용'] || '').trim();
    if (!content) continue;

    // 조문번호: 배열이면 첫 번째 값 사용, "000100" → "1"
    const rawNum = Array.isArray(jo['조문번호']) ? jo['조문번호'][0] : (jo['조문번호'] || '');
    const num = String(parseInt(rawNum, 10) / 100) || rawNum;
    const title = jo['조제목'] || '';

    const articleName = `제${num}조` + (title ? `(${title})` : '');

    articles.push({
      number: num,
      branchNumber: '',
      title,
      content,
      part: '', chapter: '', section: '', subsection: '',
      label: articleName,
    });
  }
  return articles;
}

/**
 * 행정규칙/자치법규 조문 텍스트 배열 파싱
 * 각 항목이 "제N장 ...", "제N조(제목) 내용..." 형식의 문자열
 * @param {string[]} textItems - 조문 텍스트 배열
 * @returns {Array} articles
 */
function parseAdmRulArticles(textItems) {
  let currentPart = '';
  let currentChapter = '';
  let currentSection = '';
  const articles = [];

  for (const text of textItems) {
    const trimmed = text.trim();
    if (!trimmed) continue;

    // 계층 구분자 감지: "제N장 ...", "제N절 ..." 등
    if (/^제\d+장\s/.test(trimmed) && !trimmed.includes('조(') && !trimmed.includes('조 ')) {
      currentChapter = trimmed; currentSection = ''; continue;
    }
    if (/^제\d+절\s/.test(trimmed)) {
      currentSection = trimmed; continue;
    }
    if (/^제\d+편\s/.test(trimmed)) {
      currentPart = trimmed; currentChapter = ''; currentSection = ''; continue;
    }

    // 조문 파싱: "제N조(제목) 내용..." 또는 "제N조의N(제목) 내용..."
    const artMatch = trimmed.match(/^제(\d+)조(?:의(\d+))?\(([^)]+)\)\s*([\s\S]*)/);
    if (artMatch) {
      const [, num, branch, title, content] = artMatch;
      const articleName = `제${num}조` + (branch ? `의${branch}` : '') + `(${title})`;
      const pathParts = [currentPart, currentChapter, currentSection].filter(Boolean);
      const label = pathParts.length > 0 ? `${pathParts.join(' > ')} > ${articleName}` : articleName;

      articles.push({
        number: num,
        branchNumber: branch || '',
        title,
        content: content.trim() || trimmed,
        part: currentPart, chapter: currentChapter,
        section: currentSection, subsection: '',
        label,
      });
      continue;
    }

    // "제N조 내용..." (제목 없는 조문)
    const simpleMatch = trimmed.match(/^제(\d+)조(?:의(\d+))?\s+([\s\S]*)/);
    if (simpleMatch) {
      const [, num, branch, content] = simpleMatch;
      const articleName = `제${num}조` + (branch ? `의${branch}` : '');
      const pathParts = [currentPart, currentChapter, currentSection].filter(Boolean);
      const label = pathParts.length > 0 ? `${pathParts.join(' > ')} > ${articleName}` : articleName;

      articles.push({
        number: num,
        branchNumber: branch || '',
        title: '',
        content: content.trim(),
        part: currentPart, chapter: currentChapter,
        section: currentSection, subsection: '',
        label,
      });
      continue;
    }

    // 조문 패턴이 아닌 텍스트 — 이전 조문에 병합하거나 새 항목으로 추가
    if (articles.length > 0) {
      articles[articles.length - 1].content += '\n' + trimmed;
    } else {
      articles.push({
        number: String(articles.length + 1),
        branchNumber: '',
        title: '',
        content: trimmed,
        part: '', chapter: '', section: '', subsection: '',
        label: `본문 ${articles.length + 1}`,
      });
    }
  }
  return articles;
}

module.exports = { fetchLawAPI, searchLaw, getLawDetail };
