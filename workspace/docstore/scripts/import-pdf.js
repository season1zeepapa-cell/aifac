// PDF 파일을 로컬에서 DB로 임포트하는 CLI 스크립트
//
// 사용법:
//   node scripts/import-pdf.js <PDF파일경로> [옵션]
//
// 옵션:
//   --title "문서 제목"          문서 제목 (기본: 파일명)
//   --category "카테고리"        카테고리 (법령/기출/규정/기타, 기본: 기타)
//   --section-type "타입"        추출 단위 (page/full/custom, 기본: page)
//   --delimiter "패턴"           사용자 정의 구분자 (정규식, section-type이 custom일 때)
//
// 예시:
//   node scripts/import-pdf.js ./법령.pdf --title "개인정보보호법" --category "법령"
//   node scripts/import-pdf.js ./기출.pdf --category "기출" --section-type custom --delimiter "문제\\s*\\d+"
//   node scripts/import-pdf.js ./규정.pdf --section-type full
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { extractFromPdf } = require('../lib/pdf-extractor');
const { query, getPool } = require('../api/db');

// 명령줄 인자 파싱
function parseArgs() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`
사용법: node scripts/import-pdf.js <PDF파일경로> [옵션]

옵션:
  --title "문서 제목"          문서 제목 (기본: 파일명)
  --category "카테고리"        카테고리 (법령/기출/규정/기타, 기본: 기타)
  --section-type "타입"        추출 단위 (page/full/custom, 기본: page)
  --delimiter "패턴"           사용자 정의 구분자 (정규식)

예시:
  node scripts/import-pdf.js ./법령.pdf --title "개인정보보호법" --category "법령"
  node scripts/import-pdf.js ./기출.pdf --section-type custom --delimiter "문제\\\\s*\\\\d+"
`);
    process.exit(0);
  }

  const filePath = args[0];
  const options = {
    title: null,
    category: '기타',
    sectionType: 'page',
    customDelimiter: null,
  };

  for (let i = 1; i < args.length; i += 2) {
    switch (args[i]) {
      case '--title':
        options.title = args[i + 1];
        break;
      case '--category':
        options.category = args[i + 1];
        break;
      case '--section-type':
        options.sectionType = args[i + 1];
        break;
      case '--delimiter':
        options.customDelimiter = args[i + 1];
        break;
    }
  }

  // 제목이 없으면 파일명 사용
  if (!options.title) {
    options.title = path.basename(filePath, path.extname(filePath));
  }

  return { filePath, options };
}

async function main() {
  const { filePath, options } = parseArgs();

  // 파일 존재 확인
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`파일을 찾을 수 없습니다: ${absolutePath}`);
    process.exit(1);
  }

  console.log('='.repeat(50));
  console.log('DocStore PDF 임포트');
  console.log('='.repeat(50));
  console.log(`파일: ${absolutePath}`);
  console.log(`제목: ${options.title}`);
  console.log(`카테고리: ${options.category}`);
  console.log(`추출 단위: ${options.sectionType}`);
  if (options.customDelimiter) {
    console.log(`구분자: ${options.customDelimiter}`);
  }
  console.log('='.repeat(50));
  console.log();

  try {
    // 1. PDF 파일 읽기
    console.log('1. PDF 파일 읽는 중...');
    const pdfBuffer = fs.readFileSync(absolutePath);
    console.log(`   파일 크기: ${(pdfBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    console.log();

    // 2. 텍스트 추출
    console.log('2. 텍스트 추출 중...');
    const extracted = await extractFromPdf(pdfBuffer, {
      sectionType: options.sectionType,
      customDelimiter: options.customDelimiter,
    });
    console.log(`   총 페이지: ${extracted.totalPages}`);
    console.log(`   추출된 섹션: ${extracted.sections.length}개`);
    console.log();

    // 3. DB에 저장
    console.log('3. DB에 저장 중...');
    const docResult = await query(
      `INSERT INTO documents (title, file_type, category, metadata)
       VALUES ($1, 'pdf', $2, $3)
       RETURNING id`,
      [
        options.title,
        options.category,
        JSON.stringify({
          totalPages: extracted.totalPages,
          sectionType: extracted.sectionType,
          sectionCount: extracted.sections.length,
          filePath: absolutePath,
        }),
      ]
    );
    const documentId = docResult.rows[0].id;
    console.log(`   문서 ID: ${documentId}`);

    // 섹션 저장
    for (const section of extracted.sections) {
      await query(
        `INSERT INTO document_sections (document_id, section_type, section_index, raw_text)
         VALUES ($1, $2, $3, $4)`,
        [documentId, section.sectionType, section.sectionIndex, section.text]
      );
    }
    console.log(`   ${extracted.sections.length}개 섹션 저장 완료`);
    console.log();

    // 4. 결과 미리보기
    console.log('4. 추출 결과 미리보기 (각 섹션 첫 100자):');
    console.log('-'.repeat(50));
    extracted.sections.forEach((section, i) => {
      const preview = section.text.substring(0, 100).replace(/\n/g, ' ');
      console.log(`   [${i + 1}] ${preview}...`);
    });

    console.log();
    console.log('='.repeat(50));
    console.log(`임포트 완료! 문서 ID: ${documentId}`);
    console.log('='.repeat(50));
  } catch (err) {
    console.error('임포트 실패:', err.message);
    process.exit(1);
  } finally {
    const pool = getPool();
    await pool.end();
  }
}

main();
