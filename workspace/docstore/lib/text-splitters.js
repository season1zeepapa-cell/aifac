// Text Splitter 엔진 모듈
// 4가지 청크 분할 전략을 제공합니다.
//
// 1) sentence   — 기존 문장 단위 분할 (기본값)
// 2) recursive  — LangChain 스타일 재귀적 문자 분할
// 3) law-article — 법령 조/항/호 단위 분할
// 4) semantic   — AI 기반 의미 단위 분할 (Gemini Flash 사용)

const { callLLM } = require('./gemini');

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
// 4) 의미 기반 AI 분할 (Semantic Chunking)
//    Gemini Flash를 사용하여 텍스트의 의미적 경계를 파악하고
//    주제가 바뀌는 지점에서 분할합니다.
//    ※ 업로드 전에 명시적으로 선택한 경우에만 실행됩니다.
// ============================================================
async function semanticChunk(text, chunkSize = 800) {
  if (!text || text.trim().length === 0) return [];

  // 텍스트가 짧으면 분할 불필요
  if (text.length <= chunkSize) {
    return [text.trim()];
  }

  // 매우 긴 텍스트는 먼저 대략적으로 나눈 뒤 각 부분을 AI로 분할
  const MAX_INPUT = 6000; // AI에 보낼 최대 텍스트 길이
  if (text.length > MAX_INPUT) {
    // 큰 텍스트를 MAX_INPUT 크기로 1차 분할 → 각각 AI 분할
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
 * AI를 사용한 의미 단위 분할 내부 함수
 * Gemini Flash에게 텍스트를 보내고, 의미 경계 위치를 받아서 분할합니다.
 */
async function _semanticSplitWithAI(text, chunkSize) {
  const prompt = `당신은 텍스트 분할 전문가입니다. 아래 텍스트를 의미적으로 자연스러운 단위로 분할해주세요.

## 규칙
1. 각 청크는 하나의 주제나 논점을 담아야 합니다
2. 각 청크는 약 ${chunkSize}자 이내로 유지하세요
3. 문장 중간에서 끊지 마세요
4. 분할 위치를 "===SPLIT===" 마커로 표시하세요
5. 원문을 절대 수정하지 마세요, 분할 마커만 삽입하세요

## 텍스트
${text}

## 출력
분할 마커(===SPLIT===)가 삽입된 원문을 그대로 출력하세요. 다른 설명은 붙이지 마세요.`;

  try {
    const result = await callLLM(prompt, {
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      temperature: 0.1,
      maxTokens: text.length + 500,
    });

    // AI 응답에서 분할 마커로 나누기
    const chunks = result
      .split('===SPLIT===')
      .map(c => c.trim())
      .filter(c => c.length > 0);

    // AI가 마커를 안 넣었거나 결과가 이상하면 → 재귀 분할로 fallback
    if (chunks.length <= 1) {
      console.warn('[SemanticChunk] AI 분할 결과가 단일 청크 → recursive fallback');
      return recursiveChunk(text, chunkSize, Math.floor(chunkSize * 0.2));
    }

    return chunks;
  } catch (err) {
    console.error('[SemanticChunk] AI 분할 실패 → recursive fallback:', err.message);
    // AI 호출 실패 시 재귀 분할로 안전하게 fallback
    return recursiveChunk(text, chunkSize, Math.floor(chunkSize * 0.2));
  }
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
      return semanticChunk(text, chunkSize || 800);

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
    name: 'AI 의미 분할',
    description: 'AI가 주제 변화를 감지하여 의미 단위로 분할합니다. 시간이 더 걸립니다.',
    icon: 'AI',
    aiRequired: true,
  },
};

module.exports = {
  sentenceChunk,
  recursiveChunk,
  lawArticleChunk,
  semanticChunk,
  smartChunk,
  STRATEGIES,
};
