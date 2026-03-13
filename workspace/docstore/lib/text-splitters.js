// Text Splitter 엔진 모듈
// 6가지 청크 분할 전략을 제공합니다.
//
// 1) sentence     — 기존 문장 단위 분할 (기본값)
// 2) recursive    — LangChain 스타일 재귀적 문자 분할
// 3) law-article  — 법령 조/항/호 단위 분할
// 4) semantic     — 임베딩 유사도 기반 의미 분할 (SemanticChunker)
// 4b) semantic-llm — LLM 기반 의미 분할 (Gemini Flash 사용, fallback용)
// 5) markdown     — Markdown 헤딩(#) 계층 구조 기반 분할

const { callLLM } = require('./gemini');

// embeddings.js와 순환 참조 방지를 위해 lazy require 사용
// (embeddings.js → text-splitters.js → embeddings.js 순환 방지)
let _generateEmbeddings = null;
function getGenerateEmbeddings() {
  if (!_generateEmbeddings) {
    _generateEmbeddings = require('./embeddings').generateEmbeddings;
  }
  return _generateEmbeddings;
}

// ============================================================
// 1) 문장 단위 분할 (기존 chunkText와 동일)
// ============================================================
function sentenceChunk(text, chunkSize = 500, overlap = 100) {
  if (!text || text.trim().length === 0) return [];

  // 마침표, 느낌표, 물음표 기준으로 문장을 나눔
  const sentences = text.match(/[^.!?]+[.!?]?\s*/g) || [text];
  const chunks = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length <= chunkSize) {
      currentChunk += sentence;
    } else {
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
      }
      if (overlap > 0 && currentChunk.length > overlap) {
        currentChunk = currentChunk.slice(-overlap) + sentence;
      } else {
        currentChunk = sentence;
      }
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

// ============================================================
// 2) 재귀적 문자 분할 (Recursive Character Text Splitter)
//    LangChain의 RecursiveCharacterTextSplitter와 동일한 로직:
//    여러 단계의 구분자를 순서대로 시도하며,
//    가장 큰 구분자부터 시작해서 chunkSize 이내로 자르고,
//    안 되면 다음 작은 구분자로 재귀 분할합니다.
// ============================================================
function recursiveChunk(text, chunkSize = 500, overlap = 100, separators = null) {
  if (!text || text.trim().length === 0) return [];

  // 기본 구분자 계층: 문단 → 줄바꿈 → 문장 끝 → 반점/세미콜론 → 공백 → 글자
  const defaultSeparators = ['\n\n', '\n', '.', '。', '!', '?', ';', ',', ' ', ''];
  const seps = separators || defaultSeparators;

  return _recursiveSplit(text, seps, chunkSize, overlap);
}

/**
 * 재귀 분할 내부 함수
 * @param {string} text - 분할할 텍스트
 * @param {string[]} separators - 남은 구분자 배열
 * @param {number} chunkSize - 최대 청크 크기
 * @param {number} overlap - 겹침 크기
 * @returns {string[]}
 */
function _recursiveSplit(text, separators, chunkSize, overlap) {
  const finalChunks = [];

  // 이미 chunkSize 이내면 그대로 반환
  if (text.length <= chunkSize) {
    return text.trim() ? [text.trim()] : [];
  }

  // 현재 텍스트에 적용할 구분자 찾기
  let separator = '';
  let remainingSeps = [];

  for (let i = 0; i < separators.length; i++) {
    if (separators[i] === '') {
      // 빈 문자열 = 글자 단위 (마지막 수단)
      separator = '';
      remainingSeps = [];
      break;
    }
    if (text.includes(separators[i])) {
      separator = separators[i];
      remainingSeps = separators.slice(i + 1);
      break;
    }
  }

  // 구분자로 텍스트 분리
  const splits = separator === ''
    ? text.split('')  // 글자 단위
    : text.split(separator);

  // 분리된 조각들을 chunkSize 이내로 병합
  let currentChunk = '';
  const mergedChunks = [];

  for (const piece of splits) {
    const candidate = currentChunk
      ? currentChunk + separator + piece
      : piece;

    if (candidate.length <= chunkSize) {
      currentChunk = candidate;
    } else {
      // 현재까지 모은 것 저장
      if (currentChunk.trim()) {
        mergedChunks.push(currentChunk.trim());
      }

      // 이 조각이 혼자서도 chunkSize보다 크면 → 재귀로 더 분할
      if (piece.length > chunkSize && remainingSeps.length > 0) {
        const subChunks = _recursiveSplit(piece, remainingSeps, chunkSize, overlap);
        mergedChunks.push(...subChunks);
        currentChunk = '';
      } else {
        // overlap 적용
        if (overlap > 0 && currentChunk.length > overlap) {
          currentChunk = currentChunk.slice(-overlap) + separator + piece;
        } else {
          currentChunk = piece;
        }
      }
    }
  }

  if (currentChunk.trim()) {
    mergedChunks.push(currentChunk.trim());
  }

  return mergedChunks;
}

// ============================================================
// 3) 법령 조문 단위 분할 (Law Article Splitter)
//    법령 텍스트의 "제N조", "제N조의N" 패턴을 감지하여
//    조문 단위로 분할합니다.
//    각 청크 앞에 조문 제목을 붙여서 검색 정확도를 높입니다.
// ============================================================
function lawArticleChunk(text, chunkSize = 800, overlap = 0) {
  if (!text || text.trim().length === 0) return [];

  // 법령 조문 패턴: "제N조", "제N조의N", 괄호 안 조문명 포함
  // 예: "제1조(목적)", "제12조의2(정의)", "제3조 (적용범위)"
  const articlePattern = /(?=제\d+조(?:의\d+)?\s*(?:\([^)]*\))?)/g;

  // 조문 패턴으로 분리
  const articles = text.split(articlePattern).filter(a => a.trim().length > 0);

  // 조문이 감지 안 되면 (일반 텍스트) → 재귀 분할로 fallback
  if (articles.length <= 1) {
    return recursiveChunk(text, chunkSize, overlap);
  }

  const chunks = [];

  for (const article of articles) {
    const trimmed = article.trim();
    if (!trimmed) continue;

    // 조문 제목 추출 (첫 줄에서)
    const titleMatch = trimmed.match(/^(제\d+조(?:의\d+)?\s*(?:\([^)]*\))?)/);
    const articleTitle = titleMatch ? titleMatch[1].trim() : '';

    // 조문이 chunkSize보다 크면 하위 분할
    if (trimmed.length > chunkSize) {
      // 항(①②③...) 단위로 분할 시도
      const subChunks = _splitByParagraphs(trimmed, chunkSize, articleTitle);
      chunks.push(...subChunks);
    } else {
      chunks.push(trimmed);
    }
  }

  return chunks;
}

/**
 * 항(①②③) 단위로 분할
 * 조문이 chunkSize보다 클 때 내부 항 단위로 나눕니다.
 */
function _splitByParagraphs(text, chunkSize, articleTitle) {
  // 항 패턴: ① ② ③ ... 또는 1. 2. 3. ...
  const paraPattern = /(?=[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]|\n\d+\.\s)/;
  const paragraphs = text.split(paraPattern).filter(p => p.trim().length > 0);

  if (paragraphs.length <= 1) {
    // 항 분할도 안 되면 → 재귀 분할
    return recursiveChunk(text, chunkSize, Math.floor(chunkSize * 0.1));
  }

  const chunks = [];
  let currentChunk = '';

  for (const para of paragraphs) {
    // 조문 제목을 각 청크 앞에 붙여서 맥락 유지
    const prefixed = currentChunk ? para : (articleTitle ? `${articleTitle}\n${para}` : para);

    if (currentChunk.length + prefixed.length <= chunkSize) {
      currentChunk += (currentChunk ? '\n' : '') + (currentChunk ? para : prefixed);
    } else {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      // 새 청크 시작할 때 조문 제목 붙이기
      currentChunk = articleTitle ? `${articleTitle}\n${para.trim()}` : para.trim();
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

// ============================================================
// 4) 임베딩 기반 의미 분할 (Semantic Splitting)
//    LangChain SemanticChunker와 동일한 원리:
//    ① 텍스트를 문장으로 분리
//    ② 연속 문장 그룹(윈도우)별 임베딩 생성
//    ③ 인접 그룹 간 코사인 유사도 계산
//    ④ 유사도가 급격히 떨어지는 지점(breakpoint)에서 분할
//
//    비유: 책을 읽다가 "여기서 주제가 바뀌네" 하는 지점을
//    임베딩 벡터의 거리 변화로 수학적으로 감지하는 방식
// ============================================================
async function semanticChunk(text, chunkSize = 800, options = {}) {
  if (!text || text.trim().length === 0) return [];

  // 텍스트가 짧으면 분할 불필요
  if (text.length <= chunkSize) {
    return [text.trim()];
  }

  const {
    windowSize = 3,          // 문장 그룹 윈도우 크기 (3문장씩 묶어서 임베딩)
    breakpointMethod = 'percentile', // 'percentile' | 'stddev' | 'gradient'
    breakpointThreshold = 80, // percentile: 80 → 상위 20% 유사도 하락 지점에서 분할
  } = options;

  try {
    // 1단계: 문장 분리
    const sentences = _splitIntoSentences(text);
    if (sentences.length <= 2) {
      return [text.trim()];
    }

    // 2단계: 문장 그룹(윈도우) 생성 — 전후 문맥을 포함시켜 임베딩 품질 향상
    const groups = _createSentenceGroups(sentences, windowSize);

    // 3단계: 각 그룹의 임베딩 생성 (배치 호출로 효율적)
    const groupTexts = groups.map(g => g.combined);
    const embeddings = await getGenerateEmbeddings()(groupTexts);

    if (!embeddings || embeddings.length < 2) {
      console.warn('[SemanticChunk] 임베딩 생성 실패 → recursive fallback');
      return recursiveChunk(text, chunkSize, Math.floor(chunkSize * 0.2));
    }

    // 4단계: 인접 그룹 간 코사인 유사도 계산
    const similarities = [];
    for (let i = 0; i < embeddings.length - 1; i++) {
      similarities.push(_cosineSimilarity(embeddings[i], embeddings[i + 1]));
    }

    // 5단계: 유사도가 급격히 떨어지는 분할점 찾기
    const breakpoints = _findBreakpoints(similarities, breakpointMethod, breakpointThreshold);

    // 6단계: 분할점 기준으로 문장들을 청크로 묶기
    const chunks = _buildChunksFromBreakpoints(sentences, groups, breakpoints, chunkSize);

    if (chunks.length <= 1) {
      // 분할점이 없으면 → recursive fallback
      return recursiveChunk(text, chunkSize, Math.floor(chunkSize * 0.2));
    }

    console.log(`[SemanticChunk] ${sentences.length}문장 → ${chunks.length}청크 (breakpoints: ${breakpoints.length})`);
    return chunks;
  } catch (err) {
    console.error('[SemanticChunk] 임베딩 기반 분할 실패 → recursive fallback:', err.message);
    return recursiveChunk(text, chunkSize, Math.floor(chunkSize * 0.2));
  }
}

/**
 * 텍스트를 문장 단위로 분리
 * 한국어/영어 혼합 텍스트에서 문장 경계를 정확히 감지
 */
function _splitIntoSentences(text) {
  // 마침표/물음표/느낌표 + 공백 or 줄바꿈 기준으로 분리
  // 단, "제1조." 같은 조문 번호의 마침표는 분리하지 않음
  const raw = text.split(/(?<=[.!?。])\s+|(?<=\n)\s*/g);
  const sentences = [];
  for (const s of raw) {
    const trimmed = s.trim();
    if (trimmed.length > 0) {
      sentences.push(trimmed);
    }
  }
  return sentences;
}

/**
 * 문장들을 윈도우 크기만큼 묶어서 그룹 생성
 * 예: windowSize=3이면 [문장1+2+3], [문장2+3+4], [문장3+4+5]...
 * 이렇게 하면 각 그룹이 전후 문맥을 포함하므로 임베딩 품질이 향상됨
 */
function _createSentenceGroups(sentences, windowSize) {
  const groups = [];
  for (let i = 0; i < sentences.length; i++) {
    // 현재 문장 중심으로 앞뒤 windowSize/2 만큼 포함
    const start = Math.max(0, i - Math.floor(windowSize / 2));
    const end = Math.min(sentences.length, i + Math.ceil(windowSize / 2) + 1);
    const window = sentences.slice(start, end);
    groups.push({
      index: i,             // 원본 문장 인덱스
      sentence: sentences[i], // 원본 문장
      combined: window.join(' '), // 윈도우 합친 텍스트 (임베딩용)
    });
  }
  return groups;
}

/**
 * 두 벡터 간 코사인 유사도 계산
 * 1.0 = 완전히 같은 방향 (같은 주제)
 * 0.0 = 직교 (완전히 다른 주제)
 */
function _cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

/**
 * 유사도 배열에서 분할점(breakpoint) 인덱스를 찾는 함수
 *
 * 3가지 방법을 지원:
 * - percentile: 유사도 하위 N%를 분할점으로 선택 (가장 안정적)
 * - stddev: 평균 - k*표준편차 이하를 분할점으로 선택
 * - gradient: 유사도 변화율(기울기)이 큰 지점을 분할점으로 선택
 */
function _findBreakpoints(similarities, method, threshold) {
  if (similarities.length === 0) return [];

  // 유사도를 "거리(distance)"로 변환 — 거리가 클수록 주제가 다름
  const distances = similarities.map(s => 1 - s);

  switch (method) {
    case 'percentile': {
      // 상위 (100-threshold)% 거리를 분할점으로 선택
      const sorted = [...distances].sort((a, b) => a - b);
      const cutoffIdx = Math.floor(sorted.length * threshold / 100);
      const cutoffValue = sorted[cutoffIdx] || sorted[sorted.length - 1];
      return distances
        .map((d, i) => d >= cutoffValue ? i : -1)
        .filter(i => i >= 0);
    }
    case 'stddev': {
      // 평균 + threshold * 표준편차 이상의 거리를 분할점으로 선택
      const mean = distances.reduce((a, b) => a + b, 0) / distances.length;
      const variance = distances.reduce((a, d) => a + (d - mean) ** 2, 0) / distances.length;
      const stddev = Math.sqrt(variance);
      const k = threshold / 100; // threshold=80이면 k=0.8
      const cutoff = mean + k * stddev;
      return distances
        .map((d, i) => d >= cutoff ? i : -1)
        .filter(i => i >= 0);
    }
    case 'gradient': {
      // 거리의 변화율(기울기)이 큰 지점을 분할점으로 선택
      const gradients = [];
      for (let i = 1; i < distances.length; i++) {
        gradients.push({ index: i, grad: distances[i] - distances[i - 1] });
      }
      // 기울기 상위 (100-threshold)%를 분할점으로 선택
      const sortedGrads = [...gradients].sort((a, b) => a.grad - b.grad);
      const cutoffIdx = Math.floor(sortedGrads.length * threshold / 100);
      const cutoffGrad = sortedGrads[cutoffIdx]?.grad || 0;
      return gradients
        .filter(g => g.grad >= cutoffGrad)
        .map(g => g.index);
    }
    default:
      return [];
  }
}

/**
 * 분할점을 기반으로 문장들을 청크로 병합
 * 각 청크가 chunkSize를 넘으면 추가 분할
 */
function _buildChunksFromBreakpoints(sentences, groups, breakpoints, chunkSize) {
  const breakpointSet = new Set(breakpoints);
  const chunks = [];
  let currentSentences = [];

  for (let i = 0; i < sentences.length; i++) {
    currentSentences.push(sentences[i]);

    // 이 위치가 분할점이거나, 마지막 문장이면 → 청크 생성
    if (breakpointSet.has(i) || i === sentences.length - 1) {
      const chunkText = currentSentences.join(' ').trim();
      if (chunkText) {
        // chunkSize를 넘는 경우 재귀 분할로 추가 분할
        if (chunkText.length > chunkSize) {
          const subChunks = recursiveChunk(chunkText, chunkSize, Math.floor(chunkSize * 0.1));
          chunks.push(...subChunks);
        } else {
          chunks.push(chunkText);
        }
      }
      currentSentences = [];
    }
  }

  return chunks;
}

// ============================================================
// 4-b) LLM 기반 의미 분할 (구조화 프롬프트 버전)
//      JSON 출력 형식 + Few-shot 예시로 일관된 결과를 보장합니다.
//
//      [기존 방식의 문제점]
//      - "===SPLIT=== 마커를 삽입하세요" → LLM이 원문 변형, 마커 누락, 설명 덧붙임
//      - 문서 타입 구분 없음, Few-shot 예시 없음
//
//      [개선된 방식]
//      - JSON 배열로 분할점 인덱스만 출력 → 파싱 안정성 확보
//      - 문장 번호를 매긴 뒤 "어디서 끊을지"만 판단하게 함
//      - Few-shot 예시로 출력 형식 고정
//      - 문서 타입별 분할 기준 분기
// ============================================================

// 문서 타입별 분할 기준 프롬프트
const SPLIT_CRITERIA = {
  law: `- 조문(제N조)이 바뀌는 지점
- 장/절/관 등 편제 구분이 바뀌는 지점
- 벌칙/과태료 등 제재 조항이 시작되는 지점
- 부칙이 시작되는 지점`,

  regulation: `- 규정/지침의 목적·범위가 끝나고 구체적 절차가 시작되는 지점
- 절차의 단계가 바뀌는 지점 (신청 → 심사 → 결정 등)
- 서식/별표 등 부속 자료가 시작되는 지점`,

  exam: `- 문제와 해설이 바뀌는 지점
- 과목/챕터가 바뀌는 지점
- 이론 설명과 문제 풀이가 전환되는 지점`,

  default: `- 주제(topic)가 바뀌는 지점
- 논점의 전환이 일어나는 지점 (예: 원인→결과, 문제→해결, 과거→현재)
- 구체적 사례와 일반 원칙이 전환되는 지점
- 새로운 개념이 도입되는 지점`,
};

/**
 * 텍스트에서 문서 타입을 자동 감지
 * 법령/규정/기출/일반 중 하나를 반환
 */
function _detectDocType(text) {
  const sample = text.slice(0, 1000);
  if (/제\d+조(?:의\d+)?/.test(sample) && /(?:법|령|규칙)/.test(sample)) return 'law';
  if (/(?:규정|지침|고시|훈령|예규)/.test(sample)) return 'regulation';
  if (/(?:문제|정답|해설|보기|①|②|③)/.test(sample)) return 'exam';
  return 'default';
}

async function semanticLlmChunk(text, chunkSize = 800) {
  if (!text || text.trim().length === 0) return [];

  if (text.length <= chunkSize) {
    return [text.trim()];
  }

  const MAX_INPUT = 6000;
  if (text.length > MAX_INPUT) {
    const preSplits = recursiveChunk(text, MAX_INPUT, 200);
    const allChunks = [];
    for (const segment of preSplits) {
      const subChunks = await _semanticSplitWithAI(segment, chunkSize);
      allChunks.push(...subChunks);
    }
    return allChunks;
  }

  return _semanticSplitWithAI(text, chunkSize);
}

/**
 * 구조화된 프롬프트로 LLM에게 분할점만 판단하게 하는 함수
 *
 * [동작 원리]
 * 1. 텍스트를 문장 단위로 분리하고 각 문장에 번호를 매김
 * 2. LLM에게 "몇 번 문장 뒤에서 끊을지" 번호 배열만 출력하게 함
 * 3. 원문은 LLM이 건드리지 않음 → 원문 변형 방지
 * 4. JSON 배열 출력 → 파싱 안정성 확보
 */
async function _semanticSplitWithAI(text, chunkSize) {
  // 1단계: 문장 분리 + 번호 매기기
  const sentences = _splitIntoSentences(text);

  // 문장이 너무 적으면 분할 불필요
  if (sentences.length <= 3) {
    return [text.trim()];
  }

  // 2단계: 문서 타입 감지
  const docType = _detectDocType(text);
  const criteria = SPLIT_CRITERIA[docType];

  // 3단계: 번호가 매겨진 문장 목록 생성
  const numberedSentences = sentences
    .map((s, i) => `[${i + 1}] ${s}`)
    .join('\n');

  // 4단계: 목표 청크 수 계산 (가이드라인)
  const estimatedChunks = Math.max(2, Math.ceil(text.length / chunkSize));

  // 5단계: 구조화된 프롬프트 생성
  const prompt = `## 역할
텍스트 분할 전문가. 번호가 매겨진 문장 목록을 읽고, 의미적으로 주제가 바뀌는 지점의 문장 번호를 찾아 JSON 배열로 출력합니다.

## 입력 형식
각 문장에 [번호]가 붙어있는 목록입니다.

## 출력 형식
반드시 아래 JSON 형식만 출력하세요. 설명, 코드블록 마커(\`\`\`), 기타 텍스트는 절대 포함하지 마세요.

{"breakpoints": [분할점_문장번호1, 분할점_문장번호2, ...], "reason": ["분할점1_이유", "분할점2_이유", ...]}

## 분할 규칙
1. 분할점 = "이 문장 바로 뒤에서 끊는다"는 의미의 문장 번호
2. 각 청크는 약 ${chunkSize}자 이내 (목표 청크 수: 약 ${estimatedChunks}개)
3. 최소 1개, 최대 ${Math.min(sentences.length - 1, estimatedChunks + 2)}개의 분할점
4. 첫 문장(1)과 마지막 문장(${sentences.length})은 분할점이 될 수 없음

## 이 문서의 분할 기준 (문서 타입: ${docType})
${criteria}

## Few-shot 예시

입력:
[1] 개인정보 보호법은 개인정보의 처리에 관한 사항을 정한다.
[2] 이 법은 정보주체의 자유와 권리를 보호한다.
[3] 개인정보란 살아 있는 개인에 관한 정보를 말한다.
[4] 처리란 수집, 생성, 연계, 기록을 말한다.
[5] 개인정보처리자는 개인정보를 안전하게 관리해야 한다.
[6] 위반 시 과태료가 부과된다.
[7] 과태료는 5천만원 이하로 한다.

출력:
{"breakpoints": [4, 5], "reason": ["정의 조항(용어 정의)이 끝나고 의무 조항이 시작됨", "의무 조항이 끝나고 제재(과태료) 조항이 시작됨"]}

## 분석할 문장 목록 (총 ${sentences.length}문장)
${numberedSentences}`;

  try {
    const result = await callLLM(prompt, {
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      temperature: 0,   // 0으로 설정하여 결정적 출력 보장
      maxTokens: 1000,   // 분할점 JSON만 출력하므로 토큰 절약
    });

    // 6단계: JSON 파싱 (여러 가지 형태에 대응)
    const parsed = _parseBreakpointJson(result, sentences.length);

    if (!parsed || parsed.length === 0) {
      console.warn('[SemanticLLM] 분할점 파싱 실패 → recursive fallback');
      return recursiveChunk(text, chunkSize, Math.floor(chunkSize * 0.2));
    }

    // 7단계: 분할점 기준으로 원본 문장들을 청크로 병합
    const chunks = [];
    let startIdx = 0;

    for (const bp of parsed) {
      // bp는 1-based 문장 번호 → 0-based 인덱스로 변환
      const endIdx = bp; // bp번째 문장까지 포함
      const chunkSentences = sentences.slice(startIdx, endIdx);
      if (chunkSentences.length > 0) {
        const chunkText = chunkSentences.join(' ').trim();
        if (chunkText) chunks.push(chunkText);
      }
      startIdx = endIdx;
    }

    // 마지막 청크 (마지막 분할점 이후)
    if (startIdx < sentences.length) {
      const remaining = sentences.slice(startIdx).join(' ').trim();
      if (remaining) chunks.push(remaining);
    }

    // chunkSize 초과하는 청크가 있으면 재귀 분할로 추가 분할
    const finalChunks = [];
    for (const chunk of chunks) {
      if (chunk.length > chunkSize * 1.5) {
        finalChunks.push(...recursiveChunk(chunk, chunkSize, Math.floor(chunkSize * 0.1)));
      } else {
        finalChunks.push(chunk);
      }
    }

    console.log(`[SemanticLLM] ${sentences.length}문장 → ${finalChunks.length}청크 (분할점: ${parsed.join(',')})`);
    return finalChunks;
  } catch (err) {
    console.error('[SemanticLLM] AI 분할 실패 → recursive fallback:', err.message);
    return recursiveChunk(text, chunkSize, Math.floor(chunkSize * 0.2));
  }
}

/**
 * LLM 출력에서 분할점 JSON을 안전하게 파싱
 *
 * LLM이 다양한 형태로 출력할 수 있으므로 여러 패턴에 대응:
 * - 정상: {"breakpoints": [4, 7], "reason": [...]}
 * - 코드블록: ```json {"breakpoints": [4, 7]} ```
 * - 배열만: [4, 7]
 * - 텍스트 섞임: "분할점은 {"breakpoints": [4, 7]}"
 */
function _parseBreakpointJson(rawOutput, sentenceCount) {
  try {
    // 1차: 코드블록 제거
    let cleaned = rawOutput
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();

    // 2차: JSON 객체 추출 시도
    const jsonMatch = cleaned.match(/\{[\s\S]*"breakpoints"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/);
    if (jsonMatch) {
      const obj = JSON.parse(jsonMatch[0]);
      if (Array.isArray(obj.breakpoints)) {
        return _validateBreakpoints(obj.breakpoints, sentenceCount);
      }
    }

    // 3차: 순수 배열 추출 시도
    const arrMatch = cleaned.match(/\[\s*\d+[\s,\d]*\]/);
    if (arrMatch) {
      const arr = JSON.parse(arrMatch[0]);
      return _validateBreakpoints(arr, sentenceCount);
    }

    // 4차: 숫자만 추출
    const numbers = cleaned.match(/\d+/g);
    if (numbers && numbers.length > 0) {
      return _validateBreakpoints(numbers.map(Number), sentenceCount);
    }

    return null;
  } catch (e) {
    console.error('[SemanticLLM] JSON 파싱 에러:', e.message, '원문:', rawOutput.slice(0, 200));
    return null;
  }
}

/**
 * 분할점 배열 유효성 검증 및 정리
 * - 범위 밖 값 제거 (1 이하, 문장수 이상)
 * - 중복 제거
 * - 오름차순 정렬
 */
function _validateBreakpoints(breakpoints, sentenceCount) {
  const valid = [...new Set(breakpoints)]
    .map(n => parseInt(n, 10))
    .filter(n => !isNaN(n) && n > 1 && n < sentenceCount)
    .sort((a, b) => a - b);
  return valid.length > 0 ? valid : null;
}

// ============================================================
// 5) Markdown 헤딩 기반 분할 (MarkdownHeaderTextSplitter)
//    #, ##, ### 등 헤딩 계층을 파싱하여 분할하고,
//    각 청크에 상위 헤딩 메타데이터를 부착합니다.
//    → Enriched 임베딩에서 [장][절][조항] 메타데이터로 활용됨
// ============================================================
function markdownHeaderChunk(text, chunkSize = 600, overlap = 50) {
  if (!text || text.trim().length === 0) return [];

  // 헤딩 패턴: # ~ ####
  const lines = text.split('\n');
  const sections = [];
  let currentHeaders = {}; // { 1: 'h1 텍스트', 2: 'h2 텍스트', ... }
  let currentContent = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);

    if (headingMatch) {
      // 이전 섹션 저장
      if (currentContent.length > 0) {
        const contentText = currentContent.join('\n').trim();
        if (contentText) {
          sections.push({
            text: contentText,
            metadata: { ...currentHeaders },
          });
        }
        currentContent = [];
      }

      // 헤딩 레벨 업데이트
      const level = headingMatch[1].length;
      const headerText = headingMatch[2].trim();
      currentHeaders[level] = headerText;

      // 하위 레벨 헤딩 초기화 (상위 헤딩이 바뀌면 하위도 리셋)
      for (let l = level + 1; l <= 4; l++) {
        delete currentHeaders[l];
      }
    } else {
      currentContent.push(line);
    }
  }

  // 마지막 섹션 저장
  if (currentContent.length > 0) {
    const contentText = currentContent.join('\n').trim();
    if (contentText) {
      sections.push({
        text: contentText,
        metadata: { ...currentHeaders },
      });
    }
  }

  // 헤딩이 감지되지 않으면 → 재귀 분할로 fallback
  if (sections.length <= 1 && Object.keys(sections[0]?.metadata || {}).length === 0) {
    return recursiveChunk(text, chunkSize, overlap);
  }

  // 각 섹션을 chunkSize 이내로 분할 (큰 섹션은 재귀 분할)
  const chunks = [];
  for (const section of sections) {
    // 헤딩 컨텍스트를 접두어로 생성
    const headerPrefix = Object.keys(section.metadata)
      .sort((a, b) => a - b)
      .map(level => section.metadata[level])
      .join(' > ');
    const prefix = headerPrefix ? `[${headerPrefix}]\n` : '';

    if (section.text.length + prefix.length <= chunkSize) {
      chunks.push(prefix + section.text);
    } else {
      // 큰 섹션은 재귀 분할 후 각 청크에 헤딩 접두어 부착
      const subChunks = recursiveChunk(section.text, chunkSize - prefix.length, overlap);
      for (const sub of subChunks) {
        chunks.push(prefix + sub);
      }
    }
  }

  return chunks;
}

// ============================================================
// 전략 디스패처: 전략 이름에 따라 적절한 분할 함수를 호출
// ============================================================

/**
 * 전략에 따라 텍스트를 청크로 분할
 *
 * @param {string} text - 분할할 텍스트
 * @param {string} strategy - 분할 전략 ('sentence'|'recursive'|'law-article'|'semantic')
 * @param {object} options - 옵션
 * @param {number} options.chunkSize - 청크 최대 크기 (기본 500)
 * @param {number} options.overlap - 겹침 크기 (기본 100)
 * @returns {Promise<string[]>} 청크 배열
 */
async function smartChunk(text, strategy = 'sentence', options = {}) {
  const { chunkSize = 500, overlap = 100 } = options;

  switch (strategy) {
    case 'recursive':
      return recursiveChunk(text, chunkSize, overlap);

    case 'law-article':
      return lawArticleChunk(text, chunkSize || 800, overlap);

    case 'semantic':
      return semanticChunk(text, chunkSize || 800, options);

    case 'semantic-llm':
      return semanticLlmChunk(text, chunkSize || 800);

    case 'markdown':
      return markdownHeaderChunk(text, chunkSize || 600, overlap);

    case 'sentence':
    default:
      return sentenceChunk(text, chunkSize, overlap);
  }
}

// ============================================================
// 전략 메타데이터 (프론트엔드에서 사용할 설명 정보)
// ============================================================
const STRATEGIES = {
  sentence: {
    name: '문장 단위',
    description: '마침표/느낌표/물음표 기준으로 문장을 묶어 분할합니다.',
    icon: 'T',
    aiRequired: false,
  },
  recursive: {
    name: '재귀적 분할',
    description: '문단→줄→문장→단어 순서로 계층적으로 분할합니다. 가장 범용적입니다.',
    icon: 'R',
    aiRequired: false,
  },
  'law-article': {
    name: '법령 조문 단위',
    description: '제N조/항/호 단위로 분할합니다. 법령 문서에 최적화되어 있습니다.',
    icon: 'L',
    aiRequired: false,
  },
  semantic: {
    name: '의미 분할 (임베딩)',
    description: '임베딩 유사도로 주제 변화를 수학적으로 감지하여 분할합니다. 가장 정확합니다.',
    icon: 'SE',
    aiRequired: true,
  },
  'semantic-llm': {
    name: 'AI 의미 분할',
    description: 'LLM이 주제 변화를 직접 판단하여 분할합니다. 비용이 더 높습니다.',
    icon: 'AI',
    aiRequired: true,
  },
  markdown: {
    name: 'Markdown 헤딩',
    description: '#/##/### 헤딩 계층 구조를 유지하며 분할합니다. Markdown 문서에 최적화되어 있습니다.',
    icon: 'MD',
    aiRequired: false,
  },
};

module.exports = {
  sentenceChunk,
  recursiveChunk,
  lawArticleChunk,
  semanticChunk,
  semanticLlmChunk,
  markdownHeaderChunk,
  smartChunk,
  STRATEGIES,
};
