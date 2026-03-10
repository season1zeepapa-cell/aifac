// 비식별화 처리 모듈
// 등록된 키워드를 텍스트에서 마스킹 처리
const { query } = require('./db');

const DEFAULT_REPLACEMENT = '***';

/**
 * DB에서 비식별화 키워드 목록 조회
 * @returns {Promise<Array<{id, keyword, replacement}>>}
 */
async function getDeidentifyWords() {
  const result = await query(
    'SELECT id, keyword, replacement FROM deidentify_words ORDER BY length(keyword) DESC, id'
  );
  return result.rows;
}

/**
 * 텍스트에서 비식별화 키워드를 치환
 * - 긴 키워드부터 먼저 치환 (부분 매칭 방지)
 * - 대소문자 구분 없이 매칭
 * @param {string} text - 원본 텍스트
 * @param {Array<{keyword, replacement}>} words - 키워드 목록
 * @returns {{ text: string, replacedCount: number }}
 */
function applyDeidentify(text, words) {
  if (!text || !words || words.length === 0) return { text, replacedCount: 0 };

  let result = text;
  let replacedCount = 0;

  for (const { keyword, replacement } of words) {
    if (!keyword) continue;
    // 특수문자 이스케이프
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    const matches = result.match(regex);
    if (matches) {
      replacedCount += matches.length;
      result = result.replace(regex, replacement || DEFAULT_REPLACEMENT);
    }
  }

  return { text: result, replacedCount };
}

/**
 * 섹션 배열의 텍스트를 비식별화 처리
 * @param {Array<{text, ...}>} sections - 섹션 배열
 * @param {Array<{keyword, replacement}>} words - 키워드 목록
 * @returns {{ sections: Array, totalReplaced: number }}
 */
function deidentifySections(sections, words) {
  if (!words || words.length === 0) return { sections, totalReplaced: 0 };

  let totalReplaced = 0;
  const processed = sections.map(section => {
    const { text: cleanText, replacedCount } = applyDeidentify(section.text, words);
    totalReplaced += replacedCount;
    return { ...section, text: cleanText };
  });

  return { sections: processed, totalReplaced };
}

module.exports = { getDeidentifyWords, applyDeidentify, deidentifySections, DEFAULT_REPLACEMENT };
