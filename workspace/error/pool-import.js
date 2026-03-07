// pool/ 폴더의 기출문제 이미지를 DB로 자동 등록하는 파이프라인
// 사용법: node pool-import.js --exam-id=4 [--dry-run]
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { query } = require('./api/db');

const POOL_DIR = path.join(__dirname, 'pool');

// ── 설정 ──
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const examIdArg = args.find(a => a.startsWith('--exam-id='));
const EXAM_ID = examIdArg ? parseInt(examIdArg.split('=')[1]) : null;

if (!EXAM_ID) {
  console.error('사용법: node pool-import.js --exam-id=4 [--dry-run]');
  process.exit(1);
}

// ── Gemini Vision으로 문제 텍스트 추출 ──
async function extractQuestion(imagePath) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const imageData = fs.readFileSync(imagePath);
  const base64 = imageData.toString('base64');
  const mimeType = imagePath.endsWith('.jpg') || imagePath.endsWith('.jpeg')
    ? 'image/jpeg' : 'image/png';

  const prompt = `이 이미지는 영상정보관리사 자격증 기출문제입니다.
다음 JSON 형식으로 정확히 추출해주세요. JSON만 출력하고 다른 텍스트는 절대 포함하지 마세요.

{
  "original_number": "원래 문제 번호 (숫자만)",
  "body": "문제 본문 (HTML 태그 없이 순수 텍스트)",
  "choices": [
    {"num": 1, "text": "1번 선택지"},
    {"num": 2, "text": "2번 선택지"},
    {"num": 3, "text": "3번 선택지"},
    {"num": 4, "text": "4번 선택지"}
  ],
  "answer": "정답 번호 (숫자만, 모르면 0)"
}

주의사항:
- 문제 번호는 이미지에 보이는 원래 번호를 그대로 사용
- 선택지 번호 동그라미(①②③④)는 제거하고 텍스트만 추출
- 법률명의 「」 괄호는 그대로 유지
- 정답이 이미지에 표시되어 있으면 해당 번호 기입, 없으면 0`;

  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { mimeType, data: base64 } }
  ]);

  const text = result.response.text();
  // JSON 블록 추출 (```json ... ``` 또는 순수 JSON)
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) throw new Error('JSON 추출 실패:\n' + text);

  return JSON.parse(jsonMatch[1]);
}

// ── Gemini로 해설 생성 ──
async function generateExplanation(questionData) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const choicesText = questionData.choices
    .map(c => `${c.num}. ${c.text}`).join('\n');

  const prompt = `영상정보관리사 자격증 시험 문제의 해설을 작성해주세요.

문제: ${questionData.body}
선택지:
${choicesText}
정답: ${questionData.answer}번

다음 HTML 형식으로 해설을 작성해주세요:

<div class="exp-result"></div>
<div class="exp-body">
    <p class="exp-answer">정답: <strong>정답번호 선택지내용</strong></p>
    <div class="exp-section">
        <div class="exp-section-title">해설</div>
        <p>상세한 해설 내용</p>
    </div>
    <div class="exp-section">
        <div class="exp-section-title">오답 분석</div>
        <ul class="exp-list">
            <li><strong>번호 (O/X)</strong> - 설명</li>
        </ul>
    </div>
    <div class="exp-tip"><strong>핵심 암기</strong>: 핵심 키워드</div>
</div>

주의: HTML만 출력하세요. 마크다운이나 \`\`\` 블록 없이 순수 HTML만 반환하세요.`;

  const result = await model.generateContent([{ text: prompt }]);
  let html = result.response.text();

  // ```html ... ``` 블록 제거
  const htmlMatch = html.match(/```html\s*([\s\S]*?)```/);
  if (htmlMatch) html = htmlMatch[1];

  return html.trim();
}

// ── 메인 파이프라인 ──
async function processImage(imagePath, questionNumber) {
  const fileName = path.basename(imagePath);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${questionNumber}] 처리 중: ${fileName}`);
  console.log('='.repeat(60));

  // 1단계: 비전 AI로 텍스트 추출
  console.log('\n1. 이미지에서 문제 추출 중...');
  const qData = await extractQuestion(imagePath);
  console.log(`   원래 문제번호: ${qData.original_number}`);
  console.log(`   본문: ${qData.body.substring(0, 80)}...`);
  console.log(`   선택지: ${qData.choices.length}개`);
  console.log(`   정답: ${qData.answer}번`);

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] DB 저장 건너뜀');
    console.log(JSON.stringify(qData, null, 2));
    return { qData, questionNumber };
  }

  // 2단계: DB에 문제 저장
  console.log('\n2. DB에 문제 저장 중...');
  const imgFileName = `q${String(questionNumber).padStart(3, '0')}.png`;
  const insertResult = await query(
    `INSERT INTO questions (exam_id, question_number, original_number, body, choices, answer, image_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [EXAM_ID, questionNumber, String(qData.original_number), qData.body,
     JSON.stringify(qData.choices), String(qData.answer), imgFileName]
  );
  const questionId = insertResult.rows[0].id;
  console.log(`   저장 완료 (id=${questionId})`);

  // 3단계: 해설 생성
  console.log('\n3. AI 해설 생성 중...');
  const explanation = await generateExplanation(qData);
  console.log(`   해설 길이: ${explanation.length}자`);

  // 4단계: 해설을 questions 테이블에 저장
  console.log('\n4. 해설 DB 저장 중...');
  await query(
    'UPDATE questions SET explanation = $1, updated_at = NOW() WHERE id = $2',
    [explanation, questionId]
  );
  console.log('   해설 저장 완료');

  // 5단계: 이미지 파일 이름 변경 + 이동
  console.log('\n5. 이미지 파일 이동 중...');
  const destPath = path.join(__dirname, imgFileName);
  fs.copyFileSync(imagePath, destPath);
  fs.unlinkSync(imagePath);
  console.log(`   ${fileName} → ${imgFileName}`);

  console.log(`\n[완료] 문제 #${questionNumber} (id=${questionId}) 등록 성공`);
  return { qData, questionId, questionNumber, imgFileName };
}

// ── 실행 ──
async function main() {
  // pool 폴더의 이미지 파일 목록 (이름 순 정렬)
  const files = fs.readdirSync(POOL_DIR)
    .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .sort();

  if (files.length === 0) {
    console.log('pool/ 폴더에 이미지가 없습니다.');
    process.exit(0);
  }

  console.log(`\npool/ 폴더에 ${files.length}개 이미지 발견`);
  console.log(`시험 ID: ${EXAM_ID}`);
  console.log(`모드: ${DRY_RUN ? 'DRY-RUN (미리보기)' : '실제 등록'}`);

  // 현재 마지막 문제 번호 조회
  const lastQ = await query('SELECT MAX(question_number) as max_num FROM questions');
  let nextNum = (lastQ.rows[0].max_num || 0) + 1;
  console.log(`다음 문제 번호: ${nextNum}부터`);

  const results = [];
  for (const file of files) {
    const filePath = path.join(POOL_DIR, file);
    try {
      const result = await processImage(filePath, nextNum);
      results.push(result);
      nextNum++;
    } catch (err) {
      console.error(`\n[오류] ${file}: ${err.message}`);
      console.error(err.stack);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`총 ${results.length}/${files.length}개 처리 완료`);
  if (DRY_RUN) console.log('(DRY-RUN 모드 - 실제 저장되지 않았습니다)');
  process.exit(0);
}

main().catch(err => {
  console.error('치명적 오류:', err);
  process.exit(1);
});
