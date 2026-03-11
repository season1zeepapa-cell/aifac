// 한국어 검색 최적화 모듈
//
// PostgreSQL의 'simple' tsvector 설정은 공백 기반 토큰 분리만 수행하므로
// 한국어 교착어(붙어쓰기) 특성에 약함.
// 이 모듈이 보완하는 것:
//
// 1. N-gram 토크나이저: "개인정보보호법" → "개인정보", "정보보호", "보호법" (2-gram~)
//    → 형태소 분석기 없이도 부분 매칭 가능
//
// 2. 법률 동의어 사전: "CCTV" → "영상정보처리기기", "개보법" → "개인정보보호법"
//    → 약어/관용적 표현을 정식 법률 용어로 확장
//
// 3. tsquery 빌더: 단어 + n-gram + 동의어를 OR/AND 조합으로 변환

// ── 법률 동의어 사전 ──
// key: 사용자가 입력할 수 있는 표현 (소문자 정규화)
// value: 확장할 검색어 배열
const SYNONYM_DICT = {
  // 약어 → 정식 명칭
  'cctv': ['영상정보처리기기', '폐쇄회로'],
  '개보법': ['개인정보보호법', '개인정보 보호법'],
  '정보보호법': ['개인정보보호법'],
  '정통망법': ['정보통신망법', '정보통신망 이용촉진'],
  '전자정부법': ['전자정부법', '전자정부'],
  '위치정보법': ['위치정보의 보호 및 이용'],
  '신용정보법': ['신용정보의 이용 및 보호'],

  // 일반 용어 → 법률 용어
  '카메라': ['영상정보처리기기', '촬영'],
  '녹화': ['영상정보', '촬영', '기록'],
  '감시': ['영상정보처리기기', '모니터링'],
  '동의': ['동의', '의사표시'],
  '처벌': ['벌칙', '과태료', '징역', '벌금'],
  '벌금': ['과태료', '벌금', '과징금'],
  '개인정보': ['개인정보', '정보주체'],
  '삭제': ['삭제', '파기', '폐기'],
  '열람': ['열람', '공개', '접근'],
  '수집': ['수집', '취득', '제공'],

  // 영문 → 한글
  'gdpr': ['개인정보보호', '정보보호 규정'],
  'dpo': ['개인정보 보호책임자', '보호책임자'],
  'pia': ['개인정보 영향평가', '영향평가'],
};

/**
 * 한국어 n-gram 생성
 * 긴 단어를 n글자씩 잘라서 부분 매칭용 토큰 생성
 *
 * 예: "개인정보보호법" (n=2,3)
 *   2-gram: 개인, 인정, 정보, 보보, 보호, 호법
 *   3-gram: 개인정, 인정보, 정보보, 보보호, 보호법
 *
 * @param {string} word - 입력 단어
 * @param {number} minN - 최소 n-gram 크기 (기본 2)
 * @param {number} maxN - 최대 n-gram 크기 (기본 3)
 * @returns {string[]} n-gram 토큰 배열 (중복 제거)
 */
function generateNgrams(word, minN = 2, maxN = 3) {
  if (!word || word.length < minN) return [];

  const ngrams = new Set();
  for (let n = minN; n <= maxN; n++) {
    for (let i = 0; i <= word.length - n; i++) {
      ngrams.add(word.substring(i, i + n));
    }
  }
  return [...ngrams];
}

/**
 * 동의어 확장
 * 입력 단어에 대한 동의어/관련어를 사전에서 찾아 반환
 *
 * @param {string} word - 입력 단어
 * @returns {string[]} 동의어 배열 (원본 미포함)
 */
function expandSynonyms(word) {
  if (!word) return [];
  const key = word.toLowerCase().trim();
  return SYNONYM_DICT[key] || [];
}

/**
 * 검색 쿼리를 확장된 tsquery 문자열로 변환
 *
 * 처리 흐름:
 *   1. 공백 분리 → 단어별 처리
 *   2. 각 단어: 원본 + n-gram + 동의어 → OR 결합
 *   3. 단어 간: AND 또는 OR 결합 (mode로 선택)
 *
 * 예: "CCTV 설치"
 *   CCTV → (CCTV:* | 영상정보처리기기:* | 폐쇄회로:*)
 *   설치 → (설치:*)
 *   최종 (AND): (CCTV:* | 영상정보처리기기:* | 폐쇄회로:*) & (설치:*)
 *
 * @param {string} queryText - 사용자 검색어
 * @param {Object} options
 * @param {string} options.mode - 'and' | 'or' (단어 간 결합, 기본 'or')
 * @param {boolean} options.useNgrams - n-gram 생성 여부 (기본 true)
 * @param {boolean} options.useSynonyms - 동의어 확장 여부 (기본 true)
 * @returns {{ tsquery: string, expandedTerms: string[] }}
 */
function buildTsquery(queryText, options = {}) {
  const {
    mode = 'or',
    useNgrams = true,
    useSynonyms = true,
  } = options;

  const words = queryText.trim().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return { tsquery: '', expandedTerms: [] };

  const allExpandedTerms = [];
  const wordQueries = [];

  for (const word of words) {
    // 이 단어에 대한 모든 검색 토큰 수집
    const tokens = new Set();
    tokens.add(word); // 원본

    // n-gram 생성 (3글자 이상 단어에만 적용)
    if (useNgrams && word.length >= 3) {
      for (const ngram of generateNgrams(word, 2, 3)) {
        tokens.add(ngram);
      }
    }

    // 동의어 확장
    if (useSynonyms) {
      const synonyms = expandSynonyms(word);
      for (const syn of synonyms) {
        tokens.add(syn);
        // 동의어가 여러 단어(공백 포함)이면 각 단어를 개별 토큰으로 추가
        if (syn.includes(' ')) {
          for (const part of syn.split(/\s+/)) {
            if (part.length >= 2) tokens.add(part);
          }
        }
        allExpandedTerms.push(syn);
      }
    }

    // 토큰들을 접두사 매칭 OR로 결합
    const tokenList = [...tokens].map(t => `${t}:*`);
    if (tokenList.length === 1) {
      wordQueries.push(tokenList[0]);
    } else {
      wordQueries.push(`(${tokenList.join(' | ')})`);
    }
  }

  // 단어 간 결합 (AND 또는 OR)
  const operator = mode === 'and' ? ' & ' : ' | ';
  const tsquery = wordQueries.join(operator);

  return { tsquery, expandedTerms: allExpandedTerms };
}

/**
 * 검색어 분석 — 디버깅/로깅용
 * 입력 검색어가 어떻게 확장되는지 보여줌
 *
 * @param {string} queryText
 * @returns {Object} 분석 결과
 */
function analyzeQuery(queryText) {
  const words = queryText.trim().split(/\s+/).filter(w => w.length > 0);
  const analysis = words.map(word => ({
    original: word,
    ngrams: word.length >= 3 ? generateNgrams(word) : [],
    synonyms: expandSynonyms(word),
  }));

  const { tsquery, expandedTerms } = buildTsquery(queryText);

  return {
    originalWords: words,
    analysis,
    tsquery,
    expandedTerms,
    totalTokens: tsquery.split(/[|&]/).length,
  };
}

module.exports = {
  generateNgrams,
  expandSynonyms,
  buildTsquery,
  analyzeQuery,
  SYNONYM_DICT,
};
