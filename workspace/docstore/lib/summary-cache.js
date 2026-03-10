// 요약 캐시 무효화 유틸
// 문서나 섹션이 변경될 때 호출하여 오래된 요약을 제거

/**
 * 문서의 모든 요약 캐시를 무효화
 * - documents.summary → NULL
 * - document_sections.summary → NULL
 * - document_sections.metadata.summary → 제거
 * @param {Function} dbQuery - DB 쿼리 함수
 * @param {number} documentId - 문서 ID
 */
async function invalidateSummaryCache(dbQuery, documentId) {
  // 문서 전체 요약 초기화
  await dbQuery('UPDATE documents SET summary = NULL WHERE id = $1', [documentId]);
  // 섹션 summary 컬럼 초기화
  await dbQuery('UPDATE document_sections SET summary = NULL WHERE document_id = $1', [documentId]);
  // 섹션 metadata 내 summary 키 제거
  await dbQuery(
    `UPDATE document_sections
     SET metadata = metadata - 'summary'
     WHERE document_id = $1 AND metadata ? 'summary'`,
    [documentId]
  );
  console.log(`[SummaryCache] 무효화 완료: 문서 ${documentId}`);
}

/**
 * 특정 섹션의 요약 캐시만 무효화
 * @param {Function} dbQuery
 * @param {number} sectionId
 */
async function invalidateSectionSummary(dbQuery, sectionId) {
  await dbQuery('UPDATE document_sections SET summary = NULL WHERE id = $1', [sectionId]);
  await dbQuery(
    `UPDATE document_sections
     SET metadata = metadata - 'summary'
     WHERE id = $1 AND metadata ? 'summary'`,
    [sectionId]
  );
}

module.exports = { invalidateSummaryCache, invalidateSectionSummary };
