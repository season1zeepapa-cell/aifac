// 지식 그래프 트리플스토어 엔진
// 엔티티 추출 (NER) + 관계 추출 + 트리플 빌드/조회
//
// 5가지 엔티티 타입: law, article, organization, concept, duty
// 14가지 관계 술어: 준용, 적용, 예외, 의거, 위반, 정의, 위임, 관할, 소속, 근거, 제한, 부과, 보호, 고지

const { CROSS_LAW_PATTERN, normalizeLawName } = (() => {
  // cross-reference.js에서 패턴/함수 재활용
  const CROSS_LAW_PATTERN = /([가-힣]{2,20}(?:\s*[가-힣])*법)\s*(제\d+조(?:의\d+)?(?:제\d+항)?(?:제\d+호)?)/g;
  function normalizeLawName(name) {
    return name.replace(/\s+/g, '').replace(/에관한/g, '');
  }
  return { CROSS_LAW_PATTERN, normalizeLawName };
})();

// ── 엔티티 추출 패턴 ──────────────────────────────────

// 조문 패턴: 제N조(의N)(제N항)
const ARTICLE_PATTERN = /제(\d+)조(?:의(\d+))?(?:제(\d+)항)?/g;

// 기관/조직 패턴 — 접미사를 직접 포함하여 매칭
// 단독 접미사(부/청/원/처/실)는 앞에 3자 이상 요구하여 오탐 방지
const ORG_PATTERN = /[가-힣]{2,8}(?:보호)?위원회|[가-힣]{3,10}(?:부|청|원|처|실)|[가-힣]{2,10}(?:센터|기관|협회|진흥원)/g;

// 의무/권리 패턴
const DUTY_PATTERN = /[가-힣]{1,10}(?:의무|권리|책임|권한|자격)/g;

// 법률 핵심 개념 사전 — korean-tokenizer.js SYNONYM_DICT 참조하여 확장
const CONCEPT_DICT = [
  '개인정보', '정보주체', '동의', '민감정보', '고유식별정보',
  '개인정보처리자', '개인정보파일', '영상정보처리기기',
  '정보통신망', '전자문서', '전자서명', '암호화',
  '가명정보', '익명정보', '비식별화', '가명처리',
  '접근권한', '접근통제', '개인정보보호책임자',
  '영향평가', '개인정보영향평가', '유출', '침해',
  '파기', '보유기간', '제3자제공', '위탁', '수탁자',
  '이전', '국외이전', '열람', '정정', '삭제', '처리정지',
  '손해배상', '과징금', '과태료', '벌칙',
  '동의철회', '프로파일링', '자동화된결정',
  '안전성확보조치', '내부관리계획', '접속기록',
];

// ── 관계(Predicate) 패턴 ─────────────────────────────

const PREDICATE_PATTERNS = [
  // 기존 5개
  { regex: /준용/g, predicate: '준용' },
  { regex: /적용/g, predicate: '적용' },
  { regex: /예외/g, predicate: '예외' },
  { regex: /의거/g, predicate: '의거' },
  { regex: /위반/g, predicate: '위반' },
  // 신규 9개
  { regex: /정의/g, predicate: '정의' },
  { regex: /위임/g, predicate: '위임' },
  { regex: /관할/g, predicate: '관할' },
  { regex: /소속/g, predicate: '소속' },
  { regex: /근거/g, predicate: '근거' },
  { regex: /제한/g, predicate: '제한' },
  { regex: /부과/g, predicate: '부과' },
  { regex: /보호/g, predicate: '보호' },
  { regex: /고지/g, predicate: '고지' },
];

// ── 조사 패턴 (주어/목적어 판별용) ──────────────────

const SUBJ_PARTICLES = /(?:은|는|이|가)(?:\s|$)/;
const OBJ_PARTICLES = /(?:을|를|에게|에)(?:\s|$)/;

/**
 * 텍스트에서 엔티티를 추출
 * @param {string} text - 원문 텍스트
 * @param {string} selfLawName - 자기 법령명 (법령 엔티티 생성용)
 * @returns {{ name: string, type: string, offset: number }[]}
 */
function extractEntities(text, selfLawName) {
  if (!text || text.length === 0) return [];

  const entities = [];
  const seen = new Set(); // 중복 방지: "타입:정규화된이름"

  // 유틸: 엔티티 추가 (중복 병합)
  function addEntity(name, type, offset) {
    const normalized = name.replace(/\s+/g, ' ').trim();
    if (!normalized || normalized.length < 2) return;
    const key = `${type}:${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    entities.push({ name: normalized, type, offset });
  }

  // 1) 법령명 추출 — CROSS_LAW_PATTERN 재활용
  const lawRegex = new RegExp(CROSS_LAW_PATTERN.source, 'g');
  let match;
  while ((match = lawRegex.exec(text)) !== null) {
    const lawName = match[1].replace(/\s+/g, ' ').trim();
    addEntity(lawName, 'law', match.index);
  }
  // 자기 법령명도 엔티티로 등록
  if (selfLawName) {
    addEntity(selfLawName, 'law', 0);
  }

  // 2) 조문번호 추출
  const artRegex = new RegExp(ARTICLE_PATTERN.source, 'g');
  while ((match = artRegex.exec(text)) !== null) {
    addEntity(match[0], 'article', match.index);
  }

  // 3) 기관/조직 추출 (concept 사전의 더 긴 단어 부분 문자열이면 건너뜀)
  const orgRegex = new RegExp(ORG_PATTERN.source, 'g');
  while ((match = orgRegex.exec(text)) !== null) {
    const orgName = match[0];
    // "개인정보처리자" 속의 "개인정보처" 같은 오탐 방지
    // orgName보다 긴 concept이 같은 위치에서 시작하는 경우만 건너뜀
    const textFromHere = text.substring(match.index);
    const isPartOfLonger = CONCEPT_DICT.some(c =>
      c.length > orgName.length && textFromHere.startsWith(c)
    );
    if (!isPartOfLonger) {
      addEntity(orgName, 'organization', match.index);
    }
  }

  // 4) 개념 사전 매칭
  for (const concept of CONCEPT_DICT) {
    const idx = text.indexOf(concept);
    if (idx !== -1) {
      addEntity(concept, 'concept', idx);
    }
  }

  // 5) 의무/권리 추출
  const dutyRegex = new RegExp(DUTY_PATTERN.source, 'g');
  while ((match = dutyRegex.exec(text)) !== null) {
    addEntity(match[0], 'duty', match.index);
  }

  return entities;
}

/**
 * 텍스트에서 트리플(Subject → Predicate → Object)을 추출
 * @param {string} text - 원문 텍스트
 * @param {{ name: string, type: string, offset: number }[]} entities - 추출된 엔티티
 * @returns {{ subject: string, subjectType: string, predicate: string, object: string, objectType: string, confidence: number, context: string }[]}
 */
function extractTriples(text, entities) {
  if (!text || entities.length < 2) return [];

  const triples = [];
  const seen = new Set();

  // 문장 단위 분할 (마침표, 줄바꿈 기준)
  const sentences = text.split(/[.\n]+/).filter(s => s.trim().length > 5);

  for (const sentence of sentences) {
    const trimmed = sentence.trim();

    // 이 문장에 출현하는 엔티티 수집
    const present = entities.filter(e => trimmed.includes(e.name));
    if (present.length < 2) continue;

    // 이 문장에서 매칭되는 관계 패턴 찾기
    const matchedPredicates = [];
    for (const pp of PREDICATE_PATTERNS) {
      const regex = new RegExp(pp.regex.source, 'g');
      if (regex.test(trimmed)) {
        matchedPredicates.push(pp.predicate);
      }
    }
    if (matchedPredicates.length === 0) continue;

    // 엔티티 쌍에 대해 트리플 생성
    for (let i = 0; i < present.length; i++) {
      for (let j = 0; j < present.length; j++) {
        if (i === j) continue;

        const e1 = present[i];
        const e2 = present[j];

        // 주어/목적어 판별: 조사 패턴 보정
        const e1Idx = trimmed.indexOf(e1.name);
        const e2Idx = trimmed.indexOf(e2.name);
        const afterE1 = trimmed.substring(e1Idx + e1.name.length, e1Idx + e1.name.length + 3);
        const afterE2 = trimmed.substring(e2Idx + e2.name.length, e2Idx + e2.name.length + 3);

        let subject, object, confidence;
        const e1IsSubj = SUBJ_PARTICLES.test(afterE1);
        const e2IsObj = OBJ_PARTICLES.test(afterE2);

        if (e1IsSubj && e2IsObj) {
          // 조사로 확실히 판별
          subject = e1;
          object = e2;
          confidence = 1.0;
        } else if (e1Idx < e2Idx) {
          // 출현 순서 기반 (앞=주어, 뒤=목적어)
          subject = e1;
          object = e2;
          confidence = 0.7;
        } else {
          continue; // 역순은 건너뜀 (i < j 조합에서 처리됨)
        }

        for (const predicate of matchedPredicates) {
          const key = `${subject.name}|${predicate}|${object.name}`;
          if (seen.has(key)) continue;
          seen.add(key);

          // 컨텍스트: 문장을 100자로 제한
          const context = trimmed.length > 100
            ? trimmed.substring(0, 100) + '...'
            : trimmed;

          triples.push({
            subject: subject.name,
            subjectType: subject.type,
            predicate,
            object: object.name,
            objectType: object.type,
            confidence,
            context,
          });
        }
      }
    }
  }

  return triples;
}

/**
 * 문서의 지식 그래프 구축 (엔티티 + 트리플 DB 저장)
 * buildExplicitCrossRefs 패턴 따름
 * @param {Function} dbQuery - DB 쿼리 함수
 * @param {number} documentId - 문서 ID
 * @param {object} [options] - { useLLM: boolean, llmModel: string }
 * @returns {{ entities: { total, byType, bySource }, triples: { total, byPredicate, bySource } }}
 */
async function buildKnowledgeGraph(dbQuery, documentId, options = {}) {
  const { useLLM = false, llmModel } = options;
  // 1) 문서 정보 조회
  const docRow = await dbQuery('SELECT title, file_type FROM documents WHERE id = $1', [documentId]);
  if (docRow.rows.length === 0) throw new Error('문서를 찾을 수 없습니다.');
  const docTitle = docRow.rows[0].title;

  // 2) 전체 섹션 조회
  const sections = await dbQuery(
    'SELECT id, raw_text, metadata FROM document_sections WHERE document_id = $1 ORDER BY section_index',
    [documentId]
  );

  // 3) 기존 엔티티/트리플 삭제 (재구축)
  await dbQuery(
    'DELETE FROM knowledge_triples WHERE source_document_id = $1',
    [documentId]
  );
  await dbQuery(
    'DELETE FROM entities WHERE document_id = $1',
    [documentId]
  );

  // 통계 수집
  const stats = {
    entities: { total: 0, byType: {}, bySource: { regex: 0, llm: 0 } },
    triples: { total: 0, byPredicate: {}, bySource: { regex: 0, llm: 0 } },
  };

  // LLM NER 모듈 (필요 시 로드)
  let hybridExtractEntities, extractTriplesWithLLM;
  if (useLLM) {
    try {
      const llmNer = require('./llm-ner');
      hybridExtractEntities = llmNer.hybridExtractEntities;
      extractTriplesWithLLM = llmNer.extractTriplesWithLLM;
      console.log('[KnowledgeGraph] LLM NER 활성화');
    } catch (err) {
      console.warn('[KnowledgeGraph] LLM NER 모듈 로드 실패, 정규식만 사용:', err.message);
    }
  }

  // 4) 모든 섹션에서 엔티티/트리플 추출 (메모리에서)
  // key: "type:name" → { name, type, sectionId, offset, source }
  const uniqueEntities = new Map();
  const allTriples = []; // { subject, subjectType, object, objectType, predicate, confidence, sectionId, context }

  for (const section of sections.rows) {
    if (!section.raw_text) continue;

    // 1단계: 정규식 NER (항상 실행)
    let entities;
    if (useLLM && hybridExtractEntities) {
      // 하이브리드 모드: 정규식 + LLM 2단계
      entities = await hybridExtractEntities(section.raw_text, docTitle, {
        useLLM: true,
        model: llmModel,
      });
    } else {
      // 정규식 전용 모드
      entities = extractEntities(section.raw_text, docTitle)
        .map(e => ({ ...e, source: 'regex' }));
    }

    for (const ent of entities) {
      const key = `${ent.type}:${ent.name}`;
      if (!uniqueEntities.has(key)) {
        uniqueEntities.set(key, {
          name: ent.name, type: ent.type, sectionId: section.id,
          offset: ent.offset, source: ent.source || 'regex',
        });
      }
    }

    // 트리플 추출 — 정규식
    const regexTriples = extractTriples(section.raw_text, entities);
    for (const triple of regexTriples) {
      allTriples.push({ ...triple, sectionId: section.id, source: 'regex' });
    }

    // 트리플 추출 — LLM 보완 (엔티티가 3개 이상일 때만)
    if (useLLM && extractTriplesWithLLM && entities.length >= 3) {
      try {
        const llmTriples = await extractTriplesWithLLM(
          section.raw_text, entities, regexTriples, { model: llmModel }
        );
        for (const triple of llmTriples) {
          allTriples.push({ ...triple, sectionId: section.id, source: 'llm' });
        }
      } catch (err) {
        console.warn('[KnowledgeGraph] LLM 트리플 추출 실패 (섹션 건너뜀):', err.message);
      }
    }
  }

  // 5) 엔티티 배치 INSERT (10개씩 묶어서)
  const entityIdMap = new Map();
  const entArr = [...uniqueEntities.entries()];
  const BATCH = 10;
  for (let i = 0; i < entArr.length; i += BATCH) {
    const batch = entArr.slice(i, i + BATCH);
    // 배치 VALUES 생성
    const values = [];
    const params = [];
    batch.forEach(([key, ent], idx) => {
      const base = idx * 5;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
      params.push(ent.name, ent.type, documentId, ent.sectionId, JSON.stringify({ offset: ent.offset, source: ent.source || 'regex' }));
    });
    const result = await dbQuery(
      `INSERT INTO entities (name, entity_type, document_id, section_id, metadata)
       VALUES ${values.join(', ')}
       ON CONFLICT (name, entity_type, document_id) DO UPDATE SET section_id = EXCLUDED.section_id
       RETURNING id, name, entity_type`,
      params
    );
    for (const row of result.rows) {
      entityIdMap.set(`${row.entity_type}:${row.name}`, row.id);
    }
  }

  // 통계: 엔티티 (타입별 + 출처별)
  stats.entities.total = uniqueEntities.size;
  for (const [, ent] of uniqueEntities) {
    stats.entities.byType[ent.type] = (stats.entities.byType[ent.type] || 0) + 1;
    const src = ent.source || 'regex';
    stats.entities.bySource[src] = (stats.entities.bySource[src] || 0) + 1;
  }

  // 6) 트리플 배치 INSERT (10개씩)
  // 중복 제거 (subject+predicate+object)
  const tripleDedup = new Map();
  for (const t of allTriples) {
    const subjectId = entityIdMap.get(`${t.subjectType}:${t.subject}`);
    const objectId = entityIdMap.get(`${t.objectType}:${t.object}`);
    if (!subjectId || !objectId) continue;
    const key = `${subjectId}|${t.predicate}|${objectId}`;
    if (!tripleDedup.has(key) || t.confidence > tripleDedup.get(key).confidence) {
      tripleDedup.set(key, { subjectId, predicate: t.predicate, objectId, confidence: t.confidence, sectionId: t.sectionId, context: t.context, source: t.source || 'regex' });
    }
  }

  const tripleArr = [...tripleDedup.values()];
  for (let i = 0; i < tripleArr.length; i += BATCH) {
    const batch = tripleArr.slice(i, i + BATCH);
    const values = [];
    const params = [];
    batch.forEach((t, idx) => {
      const base = idx * 7;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`);
      params.push(t.subjectId, t.predicate, t.objectId, t.confidence, documentId, t.sectionId, t.context);
    });
    await dbQuery(
      `INSERT INTO knowledge_triples (subject_id, predicate, object_id, confidence, source_document_id, source_section_id, context)
       VALUES ${values.join(', ')}
       ON CONFLICT (subject_id, predicate, object_id) DO UPDATE
       SET confidence = GREATEST(knowledge_triples.confidence, EXCLUDED.confidence), context = EXCLUDED.context`,
      params
    );
  }

  // 통계: 트리플 (술어별 + 출처별)
  stats.triples.total = tripleDedup.size;
  for (const [, t] of tripleDedup) {
    stats.triples.byPredicate[t.predicate] = (stats.triples.byPredicate[t.predicate] || 0) + 1;
    const src = t.source || 'regex';
    stats.triples.bySource[src] = (stats.triples.bySource[src] || 0) + 1;
  }

  return stats;
}

/**
 * 지식 그래프 조회 (노드+링크 형태)
 * @param {Function} dbQuery - DB 쿼리 함수
 * @param {Object} options - { documentId, entityId, search }
 * @returns {{ nodes: [...], links: [...], stats: {...} }}
 */
async function getEntityGraph(dbQuery, options = {}) {
  const { documentId, entityId, search } = options;

  let triplesResult;

  if (entityId) {
    // 특정 엔티티 중심 그래프
    triplesResult = await dbQuery(
      `SELECT kt.id, kt.predicate, kt.confidence, kt.context,
              s.id AS subject_id, s.name AS subject_name, s.entity_type AS subject_type,
              o.id AS object_id, o.name AS object_name, o.entity_type AS object_type
       FROM knowledge_triples kt
       JOIN entities s ON kt.subject_id = s.id
       JOIN entities o ON kt.object_id = o.id
       WHERE kt.subject_id = $1 OR kt.object_id = $1
       ORDER BY kt.confidence DESC`,
      [parseInt(entityId, 10)]
    );
  } else if (search) {
    // 엔티티 검색
    triplesResult = await dbQuery(
      `SELECT kt.id, kt.predicate, kt.confidence, kt.context,
              s.id AS subject_id, s.name AS subject_name, s.entity_type AS subject_type,
              o.id AS object_id, o.name AS object_name, o.entity_type AS object_type
       FROM knowledge_triples kt
       JOIN entities s ON kt.subject_id = s.id
       JOIN entities o ON kt.object_id = o.id
       WHERE s.name ILIKE '%' || $1 || '%' OR o.name ILIKE '%' || $1 || '%'
       ORDER BY kt.confidence DESC
       LIMIT 200`,
      [search]
    );
  } else if (documentId) {
    // 문서별 트리플 그래프
    triplesResult = await dbQuery(
      `SELECT kt.id, kt.predicate, kt.confidence, kt.context,
              s.id AS subject_id, s.name AS subject_name, s.entity_type AS subject_type,
              o.id AS object_id, o.name AS object_name, o.entity_type AS object_type
       FROM knowledge_triples kt
       JOIN entities s ON kt.subject_id = s.id
       JOIN entities o ON kt.object_id = o.id
       WHERE kt.source_document_id = $1
       ORDER BY kt.confidence DESC`,
      [parseInt(documentId, 10)]
    );
  } else {
    return { nodes: [], links: [], stats: { entities: 0, triples: 0 } };
  }

  // 노드/링크 변환
  const nodeMap = new Map();
  const links = [];

  for (const row of triplesResult.rows) {
    // 주어 노드
    if (!nodeMap.has(row.subject_id)) {
      nodeMap.set(row.subject_id, {
        id: row.subject_id,
        name: row.subject_name,
        type: row.subject_type,
        linkCount: 0,
      });
    }
    nodeMap.get(row.subject_id).linkCount++;

    // 목적어 노드
    if (!nodeMap.has(row.object_id)) {
      nodeMap.set(row.object_id, {
        id: row.object_id,
        name: row.object_name,
        type: row.object_type,
        linkCount: 0,
      });
    }
    nodeMap.get(row.object_id).linkCount++;

    // 링크
    links.push({
      id: row.id,
      source: row.subject_id,
      target: row.object_id,
      predicate: row.predicate,
      confidence: row.confidence,
      context: row.context,
    });
  }

  const nodes = [...nodeMap.values()];

  // 엔티티 목록 (문서별)
  let entitiesList = [];
  if (documentId) {
    const entResult = await dbQuery(
      `SELECT id, name, entity_type, metadata FROM entities WHERE document_id = $1 ORDER BY entity_type, name`,
      [parseInt(documentId, 10)]
    );
    entitiesList = entResult.rows;
  }

  // 통계
  const stats = {
    entities: nodes.length,
    triples: links.length,
    byType: {},
    byPredicate: {},
  };
  for (const n of nodes) {
    stats.byType[n.type] = (stats.byType[n.type] || 0) + 1;
  }
  for (const l of links) {
    stats.byPredicate[l.predicate] = (stats.byPredicate[l.predicate] || 0) + 1;
  }

  return { nodes, links, entities: entitiesList, stats };
}

// ============================================================
// RAG용 트리플 조회 — 질문 텍스트에서 엔티티를 추출하고,
// 해당 엔티티와 관련된 트리플을 DB에서 조회하여
// LLM 프롬프트에 삽입할 수 있는 텍스트로 포맷팅
// ============================================================

/**
 * 질문에서 엔티티를 추출하고, 관련 트리플을 DB에서 조회
 *
 * @param {Function} dbQuery - DB 쿼리 함수
 * @param {string} question - 사용자 질문
 * @param {object} [options]
 * @param {number[]} [options.docIds] - 검색 범위 문서 ID 배열
 * @param {number} [options.maxTriples=20] - 최대 트리플 수
 * @param {number} [options.minConfidence=0.5] - 최소 신뢰도
 * @returns {Promise<{triples: object[], entities: string[], contextText: string}>}
 */
async function findTriplesForRAG(dbQuery, question, options = {}) {
  const { docIds, maxTriples = 20, minConfidence = 0.5 } = options;

  // 1단계: 질문에서 엔티티 추출
  const questionEntities = extractEntities(question);
  if (questionEntities.length === 0) {
    return { triples: [], entities: [], contextText: '' };
  }

  // 엔티티 이름 목록 (중복 제거)
  const entityNames = [...new Set(questionEntities.map(e => e.name))];

  // 2단계: DB에서 해당 엔티티가 포함된 트리플 조회
  //   주어 또는 목적어 이름이 질문의 엔티티와 일치하는 트리플을 찾음
  //   docIds가 지정되면 해당 문서 범위로 제한
  let triplesResult;

  // 엔티티 이름으로 ILIKE 조건 생성 (여러 엔티티를 OR로 연결)
  const likeClauses = entityNames.map((_, i) =>
    `s.name ILIKE '%' || $${i + 1} || '%' OR o.name ILIKE '%' || $${i + 1} || '%'`
  );
  const whereClause = `(${likeClauses.join(' OR ')})`;
  const params = [...entityNames];

  let sql = `
    SELECT kt.predicate, kt.confidence, kt.context,
           s.name AS subject_name, s.entity_type AS subject_type,
           o.name AS object_name, o.entity_type AS object_type
    FROM knowledge_triples kt
    JOIN entities s ON kt.subject_id = s.id
    JOIN entities o ON kt.object_id = o.id
    WHERE ${whereClause}
      AND kt.confidence >= $${params.length + 1}`;
  params.push(minConfidence);

  // 문서 범위 필터
  if (docIds && docIds.length > 0) {
    sql += ` AND kt.source_document_id = ANY($${params.length + 1})`;
    params.push(docIds);
  }

  sql += ` ORDER BY kt.confidence DESC LIMIT $${params.length + 1}`;
  params.push(maxTriples);

  try {
    triplesResult = await dbQuery(sql, params);
  } catch (err) {
    // knowledge_triples 테이블이 없는 경우 등 에러 시 빈 결과 반환
    console.warn('[KG-RAG] 트리플 조회 실패:', err.message);
    return { triples: [], entities: entityNames, contextText: '' };
  }

  const triples = triplesResult.rows || [];

  if (triples.length === 0) {
    return { triples: [], entities: entityNames, contextText: '' };
  }

  // 3단계: 프롬프트 삽입용 텍스트 포맷팅
  //   "주어 —[관계]→ 목적어" 형식으로, LLM이 관계를 파악할 수 있게 구조화
  const contextText = _formatTriplesForPrompt(triples);

  return { triples, entities: entityNames, contextText };
}

/**
 * 트리플 배열을 프롬프트 삽입용 텍스트로 변환
 *
 * 출력 예시:
 *   --- 지식 그래프 관계 정보 ---
 *   • 개인정보보호위원회 —[관할]→ 개인정보 보호법 (신뢰도: 1.0)
 *   • 개인정보 보호법 —[정의]→ 개인정보 (신뢰도: 0.9)
 *   • 정보주체 —[보호]→ 열람권 (신뢰도: 0.8)
 */
function _formatTriplesForPrompt(triples) {
  // 중복 트리플 제거 (주어+관계+목적어가 동일한 것)
  const seen = new Set();
  const unique = [];
  for (const t of triples) {
    const key = `${t.subject_name}|${t.predicate}|${t.object_name}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(t);
    }
  }

  const lines = unique.map(t =>
    `• ${t.subject_name} —[${t.predicate}]→ ${t.object_name} (신뢰도: ${t.confidence})`
  );

  return `--- 지식 그래프 관계 정보 ---\n${lines.join('\n')}`;
}

module.exports = {
  extractEntities,
  extractTriples,
  buildKnowledgeGraph,
  getEntityGraph,
  findTriplesForRAG,
  CONCEPT_DICT,
  PREDICATE_PATTERNS,
};
