// 기존 DB BYTEA(original_file) 데이터를 Supabase Storage로 이전
//
// 사용법:
//   node scripts/migrate-to-storage.js          (전체 이전)
//   node scripts/migrate-to-storage.js --doc-id=5  (특정 문서만)
//   node scripts/migrate-to-storage.js --cleanup    (이전 완료된 문서의 BYTEA 정리)
//
// 필요 환경변수: DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY
require('dotenv').config();
const { query } = require('../lib/db');
const { uploadFile, isStorageAvailable } = require('../lib/storage');

async function main() {
  if (!isStorageAvailable()) {
    console.error('SUPABASE_URL과 SUPABASE_SERVICE_KEY 환경변수를 설정해주세요.');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const docIdArg = args.find(a => a.startsWith('--doc-id='));
  const cleanup = args.includes('--cleanup');

  // --cleanup 모드: storage_path가 있는 문서의 BYTEA 비우기
  if (cleanup) {
    console.log('=== BYTEA 정리 모드 ===');
    const result = await query(
      `UPDATE documents SET original_file = NULL
       WHERE storage_path IS NOT NULL AND original_file IS NOT NULL
       RETURNING id, title`
    );
    console.log(`${result.rowCount}개 문서의 BYTEA 데이터 정리 완료`);
    for (const row of result.rows) {
      console.log(`  - [${row.id}] ${row.title}`);
    }
    process.exit(0);
  }

  // BYTEA 데이터가 있지만 storage_path가 없는 문서 조회
  let sql = `
    SELECT id, title, original_filename, original_mimetype, original_file, file_size
    FROM documents
    WHERE original_file IS NOT NULL AND storage_path IS NULL
  `;
  const params = [];

  if (docIdArg) {
    const docId = parseInt(docIdArg.split('=')[1]);
    sql += ' AND id = $1';
    params.push(docId);
  }

  sql += ' ORDER BY id';

  const docs = await query(sql, params);
  console.log(`이전 대상: ${docs.rowCount}개 문서`);

  let success = 0;
  let failed = 0;

  for (const doc of docs.rows) {
    try {
      const filename = doc.original_filename || `document_${doc.id}`;
      const mimetype = doc.original_mimetype || 'application/octet-stream';
      const fileBuffer = doc.original_file;

      console.log(`[${doc.id}] "${doc.title}" 이전 중... (${fileBuffer.length} bytes)`);

      // Storage 업로드
      const storagePath = await uploadFile(fileBuffer, doc.id, filename, mimetype);

      // DB에 storage_path 저장
      await query(
        'UPDATE documents SET storage_path = $1 WHERE id = $2',
        [storagePath, doc.id]
      );

      console.log(`  → 완료: ${storagePath}`);
      success++;
    } catch (err) {
      console.error(`  → 실패: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n=== 이전 완료: 성공 ${success}, 실패 ${failed} ===`);
  if (success > 0) {
    console.log('BYTEA 정리는 --cleanup 옵션으로 별도 실행하세요:');
    console.log('  node scripts/migrate-to-storage.js --cleanup');
  }
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
