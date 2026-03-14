// 커뮤니티 요약 생성 엔진
// 각 커뮤니티의 엔티티+트리플을 LLM으로 요약하고 DB에 저장
// Global Search에서 커뮤니티 요약을 컨텍스트로 활용
// Map-Reduce 패턴: Map(커뮤니티별 요약) → Reduce(LLM 재합성)

const { callGemini } = require('./gemini');
const { generateEmbedding } = require('./embeddings');

/**
 * 단일 커뮤니티의 요약을 생성
 *
 * @param {Function} dbQuery - DB 쿼리 함수
 * @param {object} community - { id, nodes: [{ id, name, type }], size }
 * @param {number} documentId - 문서 ID
 * @param {object} [options] - { provider, model }
 * @returns {Promise<string>} 생성된 요약 텍스트
 */
async function generateCommunitySummary(dbQuery, community, documentId, options = {}) {
  const entityIds = community.nodes.map(n => n.id);
  if (entityIds.length === 0) return '';

  // 1) 이 커뮤니티 엔티티들 간의 트리플 조회
  const triplesResult = await dbQuery(
    `SELECT s.name AS subject, kt.predicate, o.name AS object, kt.confidence, kt.context
     FROM knowledge_triples kt
     JOIN entities s ON kt.subject_id = s.id
     JOIN entities o ON kt.object_id = o.id
     WHERE kt.source_document_id = $1
       AND (kt.subject_id = ANY($2) OR kt.object_id = ANY($2))
     ORDER BY kt.confidence DESC
     LIMIT 30`,
    [documentId, entityIds]
  );

  // 2) 관련 섹션 원문 일부 조회 (컨텍스트용)
  const sectionsResult = await dbQuery(
    `SELECT DISTINCT ds.raw_text
     FROM entities e
     JOIN document_sections ds ON e.section_id = ds.id
     WHERE e.id = ANY($1) AND ds.raw_text IS NOT NULL
     LIMIT 5`,
    [entityIds]
  );

  // 3) 프롬프트 조립
  const entityList = community.nodes
    .map(n => `- ${n.name} (${n.type})`)
    .join('\n');

  const tripleList = triplesResult.rows
    .map(t => `- ${t.subject} —[${t.predicate}]→ ${t.object} (신뢰도: ${t.confidence})`)
    .join('\n');

  const sectionTexts = sectionsResult.rows
    .map(s => s.raw_text.substring(0, 300))
    .join('\n---\n');

  const prompt = `다음은 법률 문서에서 추출한 하나의 "커뮤니티"(의미적으로 관련된 개체 그룹)입니다.
이 커뮤니티를 3~5문장으로 요약해주세요.

## 포함된 개체 (${community.size}개)
${entityList}

## 개체 간 관계
${tripleList || '(관계 정보 없음)'}

## 관련 원문 발췌
${sectionTexts || '(원문 없음)'}

## 요약 작성 지침
1. 이 커뮤니티의 핵심 주제를 한 문장으로 먼저 제시
2. 포함된 주요 법률 개념, 기관, 조문 간의 관계를 설명
3. 이 그룹이 다루는 법적 맥락이나 규제 영역을 명시
4. 다른 커뮤니티와 구별되는 특징을 언급
5. 한국어로 작성`;

  try {
    const summary = await callGemini(prompt, {
      model: options.model || 'gemini-2.0-flash',
      temperature: 0.3,
      maxTokens: 500,
    });
    return summary?.trim() || '';
  } catch (err) {
    console.warn('[CommunitySummary] LLM 요약 실패:', err.message);
    // 폴백: 엔티티 이름 나열
    return `이 커뮤니티는 ${community.nodes.slice(0, 5).map(n => n.name).join(', ')} 등 ${community.size}개의 개체로 구성됩니다.`;
  }
}

/**
 * 문서의 모든 커뮤니티 요약을 일괄 생성하고 DB에 저장
 *
 * @param {Function} dbQuery - DB 쿼리 함수
 * @param {number} documentId - 문서 ID
 * @param {object[]} communities - detectCommunities 결과의 communities 배열
 * @param {object} [options] - { provider, model, onProgress }
 * @returns {Promise<{ total, generated, errors }>}
 */
async function generateAllSummaries(dbQuery, documentId, communities, options = {}) {
  const { onProgress } = options;
  const results = { total: communities.length, generated: 0, errors: 0 };

  for (let i = 0; i < communities.length; i++) {
    const comm = communities[i];

    // 너무 작은 커뮤니티는 건너뜀 (노드 1개는 요약 불필요)
    if (comm.size <= 1) {
      results.total--;
      continue;
    }

    try {
      const summary = await generateCommunitySummary(dbQuery, comm, documentId, options);

      // DB 업데이트
      await dbQuery(
        `UPDATE communities SET summary = $1 WHERE document_id = $2 AND community_index = $3`,
        [summary, documentId, comm.id]
      );

      results.generated++;

      if (onProgress) {
        onProgress({
          current: i + 1,
          total: communities.length,
          communityId: comm.id,
          summary: summary.substring(0, 100) + '...',
        });
      }
    } catch (err) {
      console.error(`[CommunitySummary] 커뮤니티 ${comm.id} 요약 실패:`, err.message);
      results.errors++;
    }
  }

  return results;
}

/**
 * Global Search: 커뮤니티 요약을 활용한 전역 질의
 *
 * 1) 질문과 관련된 커뮤니티 요약을 검색
 * 2) 매칭된 커뮤니티의 엔티티/트리플을 RAG 컨텍스트에 추가
 *
 * @param {Function} dbQuery - DB 쿼리 함수
 * @param {string} question - 사용자 질문
 * @param {object} [options] - { docIds, maxCommunities }
 * @returns {Promise<{ communities: object[], contextText: string }>}
 */
async function globalSearch(dbQuery, question, options = {}) {
  const { docIds, maxCommunities = 5, useReduce = false } = options;

  // 1) 요약이 있는 커뮤니티 조회
  let sql = `SELECT c.id, c.document_id, c.community_index, c.summary, c.entity_ids, c.size, c.metadata,
                    d.title AS doc_title
             FROM communities c
             JOIN documents d ON c.document_id = d.id
             WHERE c.summary IS NOT NULL AND c.summary != ''`;
  const params = [];

  if (docIds && docIds.length > 0) {
    params.push(docIds);
    sql += ` AND c.document_id = ANY($${params.length})`;
  }

  sql += ` ORDER BY c.size DESC`;

  const commResult = await dbQuery(sql, params);
  if (commResult.rows.length === 0) {
    return { communities: [], contextText: '', reducedAnswer: null };
  }

  // 2) 키워드 매칭 점수 계산
  const questionWords = question
    .replace(/[^\w가-힣]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);

  const scored = commResult.rows.map(comm => {
    const summaryLower = (comm.summary || '').toLowerCase();
    let keywordScore = 0;

    for (const word of questionWords) {
      if (summaryLower.includes(word.toLowerCase())) {
        keywordScore += 1;
      }
    }

    // 메타데이터의 노드 이름에서도 매칭
    try {
      const meta = typeof comm.metadata === 'string' ? JSON.parse(comm.metadata) : comm.metadata;
      const nodeNames = (meta?.nodes || []).map(n => n.name).join(' ').toLowerCase();
      for (const word of questionWords) {
        if (nodeNames.includes(word.toLowerCase())) keywordScore += 0.5;
      }
    } catch {}

    return { ...comm, keywordScore, vectorScore: 0, relevanceScore: keywordScore };
  });

  // 3) 벡터 유사도 점수 추가 (임베딩 기반)
  try {
    const questionEmb = await generateEmbedding(question);

    // 키워드 매칭 상위 후보 + 대형 커뮤니티만 벡터 비교 (비용 절감)
    const candidates = scored
      .filter(c => c.keywordScore > 0 || c.size >= 3)
      .slice(0, 15);

    for (const comm of candidates) {
      try {
        const summaryEmb = await generateEmbedding(comm.summary.substring(0, 500));
        // 코사인 유사도 계산
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < questionEmb.length; i++) {
          dot += questionEmb[i] * summaryEmb[i];
          normA += questionEmb[i] ** 2;
          normB += summaryEmb[i] ** 2;
        }
        const cosine = dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
        comm.vectorScore = cosine;
        // 최종 점수: 키워드 50% + 벡터 50% (벡터 점수를 키워드 스케일로 변환)
        const maxKeyword = Math.max(...scored.map(s => s.keywordScore), 1);
        comm.relevanceScore = 0.5 * comm.keywordScore + 0.5 * (cosine * maxKeyword);
      } catch {
        // 임베딩 실패 시 키워드 점수만 사용
      }
    }
  } catch (embErr) {
    console.warn('[GlobalSearch] 벡터 검색 실패, 키워드 매칭만 사용:', embErr.message);
  }

  // 4) 관련성 점수 내림차순 정렬, 0점은 제외
  const relevant = scored
    .filter(c => c.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxCommunities);

  if (relevant.length === 0) {
    return { communities: [], contextText: '', reducedAnswer: null };
  }

  // 5) 컨텍스트 텍스트 생성 (Map 결과)
  const contextLines = relevant.map((c, i) =>
    `[커뮤니티 ${i + 1} - ${c.doc_title}] (관련도: ${c.relevanceScore.toFixed(1)})\n${c.summary}`
  );

  const contextText = `--- 커뮤니티 요약 기반 전역 컨텍스트 ---\n${contextLines.join('\n\n')}`;

  // 6) Reduce 단계: 선택된 요약들을 LLM으로 재합성 (옵션)
  let reducedAnswer = null;
  if (useReduce && relevant.length > 0) {
    try {
      const summaryBlock = relevant.map((c, i) =>
        `### 커뮤니티 ${i + 1}: ${c.doc_title} (${c.size}개 개체)\n${c.summary}`
      ).join('\n\n');

      const reducePrompt = `당신은 법률 문서 분석 전문가입니다. 아래는 문서에서 추출한 ${relevant.length}개 커뮤니티의 요약입니다.
사용자의 질문에 대해 이 요약들을 종합하여 체계적인 답변을 작성하세요.

## 사용자 질문
${question}

## 커뮤니티 요약 (Map 결과)
${summaryBlock}

## 답변 작성 지침
1. 각 커뮤니티의 핵심 내용을 통합하여 하나의 일관된 답변 생성
2. 서로 다른 커뮤니티 간의 관계나 공통점이 있으면 명시
3. 질문에 직접 관련되지 않는 커뮤니티 내용은 제외
4. 구조화된 형식 (번호 매기기, 소제목)으로 작성
5. 한국어로 작성`;

      reducedAnswer = await callGemini(reducePrompt, {
        model: 'gemini-2.0-flash',
        temperature: 0.3,
        maxTokens: 1500,
      });
      reducedAnswer = reducedAnswer?.trim() || null;
      console.log(`[GlobalSearch] Reduce 완료: ${relevant.length}개 요약 → 종합 답변 생성`);
    } catch (reduceErr) {
      console.warn('[GlobalSearch] Reduce 단계 실패:', reduceErr.message);
    }
  }

  return {
    communities: relevant.map(c => ({
      id: c.id,
      documentId: c.document_id,
      docTitle: c.doc_title,
      communityIndex: c.community_index,
      summary: c.summary,
      size: c.size,
      relevanceScore: c.relevanceScore,
      vectorScore: c.vectorScore,
    })),
    contextText,
    reducedAnswer,
  };
}

module.exports = {
  generateCommunitySummary,
  generateAllSummaries,
  globalSearch,
};
