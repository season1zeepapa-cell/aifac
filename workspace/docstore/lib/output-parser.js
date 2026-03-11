// RAG 출력 파서 — LLM 응답을 구조화된 객체로 변환
//
// 2단계 파싱 전략:
//   1차: JSON 파싱 시도 (LLM이 JSON으로 답변한 경우)
//   2차: 마크다운 폴백 파서 (### 헤딩 기준으로 섹션 분리)
//
// 근거 번호 검증으로 환각(hallucination) 방지

/**
 * LLM 출력을 파싱하고 구조화된 객체로 반환
 * @param {string} llmOutput - LLM 응답 텍스트 (JSON 또는 마크다운)
 * @param {Array} sources - 검색된 근거 자료 배열 (근거 번호 검증용)
 * @returns {object} 구조화된 답변 객체
 */
function parseRAGOutput(llmOutput, sources = []) {
  if (!llmOutput || typeof llmOutput !== 'string') {
    return createEmptyResult(llmOutput);
  }

  // 1차: JSON 파싱 시도
  const jsonResult = tryParseJSON(llmOutput, sources);
  if (jsonResult) return jsonResult;

  // 2차: 마크다운 폴백 파서
  return parseMarkdownAnswer(llmOutput, sources);
}

/**
 * JSON 파싱 시도 — LLM이 JSON으로 답변한 경우
 * ```json ... ``` 코드블록 감싸기도 처리
 */
function tryParseJSON(text, sources) {
  try {
    // ```json ... ``` 또는 ``` ... ``` 코드블록 제거
    let jsonStr = text.trim();
    const codeBlockMatch = jsonStr.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    // JSON 파싱 — 실패하면 null 반환
    const parsed = JSON.parse(jsonStr);

    // 최소 필드 존재 확인 (conclusion 또는 결론)
    if (!parsed.conclusion && !parsed['결론']) return null;

    return validateAndNormalize(parsed, sources, text);
  } catch {
    return null;
  }
}

/**
 * JSON 파싱 결과를 정규화하고 근거 번호 검증
 */
function validateAndNormalize(parsed, sources, raw) {
  const result = {
    conclusion: parsed.conclusion || parsed['결론'] || '',
    evidenceChain: [],
    crossReferences: [],
    caveats: parsed.caveats || parsed['주의사항'] || '',
    raw,
    format: 'json',
    parsed: true,
    warnings: [],
  };

  // 근거 체인 검증
  const chain = parsed.evidenceChain || parsed['근거체인'] || [];
  for (const step of chain) {
    const idx = step.sourceIndex || step.step;
    if (typeof idx === 'number' && (idx < 1 || idx > sources.length)) {
      result.warnings.push(`[근거 ${idx}]은 존재하지 않는 근거 번호입니다 (총 ${sources.length}건)`);
      // 잘못된 근거도 포함하되 verified: false 표시
      result.evidenceChain.push({ ...step, verified: false });
    } else {
      result.evidenceChain.push({
        ...step,
        verified: true,
        sourceTitle: idx && sources[idx - 1]
          ? (sources[idx - 1].label || sources[idx - 1].documentTitle)
          : step.sourceLabel,
      });
    }
  }

  // 교차 참조
  const refs = parsed.crossReferences || parsed['교차참조'] || [];
  result.crossReferences = refs.map(ref => ({
    from: ref.from || ref['출발'],
    to: ref.to || ref['도착'],
    relation: ref.relation || ref['관계'] || '관련',
  }));

  return result;
}

/**
 * 마크다운 폴백 파서 — ### 헤딩 기준으로 섹션 분리
 * 현재 프롬프트가 "### 결론", "### 근거 체인" 형식을 사용하므로
 * 정규식으로 각 섹션을 추출
 */
function parseMarkdownAnswer(markdown, sources) {
  const result = {
    conclusion: '',
    evidenceChain: [],
    crossReferences: [],
    caveats: '',
    raw: markdown,
    format: 'markdown',
    parsed: false,
    warnings: [],
  };

  // ### 또는 ## 수준의 헤딩으로 섹션 분리
  // "### 결론\n내용" → { heading: "결론", content: "내용" }
  const sectionRegex = /^#{2,3}\s+(.+)$/gm;
  const headings = [];
  let match;

  while ((match = sectionRegex.exec(markdown)) !== null) {
    headings.push({
      heading: match[1].trim(),
      startIndex: match.index,
      contentStart: match.index + match[0].length,
    });
  }

  if (headings.length === 0) {
    // 헤딩이 없으면 전체를 결론으로 취급
    result.conclusion = markdown.trim();
    return result;
  }

  // 각 헤딩의 내용 범위 결정
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].contentStart;
    const end = i + 1 < headings.length ? headings[i + 1].startIndex : markdown.length;
    const content = markdown.substring(start, end).trim();
    const heading = headings[i].heading;

    if (/결론/.test(heading)) {
      result.conclusion = content;
      result.parsed = true;
    } else if (/근거\s*체인/.test(heading)) {
      result.evidenceChain = parseEvidenceSteps(content, sources);
      result.parsed = true;
    } else if (/교차\s*참조/.test(heading)) {
      result.crossReferences = parseCrossRefs(content);
    } else if (/주의/.test(heading)) {
      result.caveats = content;
    }
  }

  // 결론이 비어있으면 첫 번째 헤딩 이전 텍스트를 결론으로 사용
  if (!result.conclusion && headings.length > 0) {
    const preHeading = markdown.substring(0, headings[0].startIndex).trim();
    if (preHeading) {
      result.conclusion = preHeading;
      result.parsed = true;
    }
  }

  // 파싱이 하나도 안 됐으면 전체를 결론으로
  if (!result.parsed) {
    result.conclusion = markdown.trim();
  }

  return result;
}

/**
 * 근거 체인 텍스트에서 단계별 항목 추출
 * 패턴: "- **[근거 N] 조문명**: 인용 → 설명" 또는 번호 목록
 */
function parseEvidenceSteps(text, sources = []) {
  if (!text) return [];

  const steps = [];
  // "- **[근거 N]" 또는 "**[근거 N]" 패턴 매칭
  const stepRegex = /(?:^[-*]\s*|\n[-*]\s*)\*{0,2}\[근거\s*(\d+)\]\s*([^*:\n]*?)\*{0,2}\s*[:：]\s*([\s\S]*?)(?=(?:\n[-*]\s*\*{0,2}\[근거|$))/g;
  let m;

  while ((m = stepRegex.exec(text)) !== null) {
    const sourceIndex = parseInt(m[1], 10);
    const sourceLabel = m[2].trim();
    const body = m[3].trim();

    // "인용 → 설명" 패턴으로 분리 시도
    const arrowSplit = body.split(/\s*[→→]\s*/);
    const quote = arrowSplit[0] || '';
    const reasoning = arrowSplit.slice(1).join(' → ') || '';

    // 근거 번호 검증
    const verified = sourceIndex >= 1 && sourceIndex <= sources.length;
    if (!verified && sources.length > 0) {
      // 검증 실패해도 결과에는 포함 (경고만 추가)
    }

    steps.push({
      step: steps.length + 1,
      sourceIndex,
      sourceLabel: sourceLabel || (verified ? (sources[sourceIndex - 1]?.label || '') : ''),
      quote: quote.replace(/["""]/g, '').trim(),
      reasoning: reasoning.trim(),
      verified,
      raw: m[0].trim(),
    });
  }

  // 패턴 매칭 실패 시 — 줄 단위로 분리해서 기본 파싱
  if (steps.length === 0) {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    let stepNum = 0;
    for (const line of lines) {
      const cleaned = line.replace(/^[-*]\s*/, '').trim();
      if (!cleaned) continue;
      // 연결어("→ 따라서" 등)만 있는 줄은 이전 단계에 합침
      if (/^[→→]\s*(따라서|이에|그러므로)/.test(cleaned) && steps.length > 0) {
        steps[steps.length - 1].reasoning += ' ' + cleaned;
        continue;
      }
      stepNum++;
      steps.push({
        step: stepNum,
        sourceIndex: null,
        sourceLabel: '',
        quote: '',
        reasoning: cleaned,
        verified: false,
        raw: cleaned,
      });
    }
  }

  return steps;
}

/**
 * 교차 참조 텍스트에서 관계 항목 추출
 * 패턴: "조문A → (관계) → 조문B" 또는 "조문A ↔ 조문B"
 */
function parseCrossRefs(text) {
  if (!text) return [];

  const refs = [];
  const lines = text.split('\n').filter(l => l.trim().length > 0);

  for (const line of lines) {
    const cleaned = line.replace(/^[-*]\s*/, '').trim();

    // "A → (관계) → B" 패턴
    const arrowMatch = cleaned.match(/(.+?)\s*[→→]\s*\((.+?)\)\s*[→→]\s*(.+)/);
    if (arrowMatch) {
      refs.push({
        from: arrowMatch[1].trim(),
        to: arrowMatch[3].trim(),
        relation: arrowMatch[2].trim(),
      });
      continue;
    }

    // "A ↔ B (관계)" 패턴
    const biMatch = cleaned.match(/(.+?)\s*↔\s*(.+?)(?:\s*\((.+?)\))?$/);
    if (biMatch) {
      refs.push({
        from: biMatch[1].trim(),
        to: biMatch[2].trim(),
        relation: biMatch[3]?.trim() || '관련',
      });
      continue;
    }

    // "A → B" 단순 패턴
    const simpleMatch = cleaned.match(/(.+?)\s*[→→]\s*(.+)/);
    if (simpleMatch) {
      refs.push({
        from: simpleMatch[1].trim(),
        to: simpleMatch[2].trim(),
        relation: '참조',
      });
    }
  }

  return refs;
}

/**
 * 빈 결과 객체 생성
 */
function createEmptyResult(raw) {
  return {
    conclusion: '',
    evidenceChain: [],
    crossReferences: [],
    caveats: '',
    raw: raw || '',
    format: 'empty',
    parsed: false,
    warnings: ['LLM 출력이 비어있거나 유효하지 않습니다.'],
  };
}

module.exports = { parseRAGOutput, parseMarkdownAnswer, parseEvidenceSteps, parseCrossRefs };
