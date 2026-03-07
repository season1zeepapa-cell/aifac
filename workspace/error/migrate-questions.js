// 190문항 HTML → DB 마이그레이션 스크립트
require('dotenv').config();
const fs = require('fs');
const { query } = require('./api/db');

// 간단한 HTML 파서 (외부 라이브러리 없이)
function parseQuestions(html) {
  const questions = [];

  // 각 카드를 정규식으로 추출
  const cardRegex = /<div class="card" id="q(\d+)">([\s\S]*?)(?=<div class="card" id="q\d+">|<\/main>)/g;
  let match;

  while ((match = cardRegex.exec(html)) !== null) {
    const num = parseInt(match[1], 10);
    const cardHtml = match[2];

    // 시험 그룹 결정
    let examId;
    if (num <= 110) examId = 1;      // 오답 풀이
    else if (num <= 150) examId = 2;  // 2025.11.30 시험
    else examId = 3;                  // 2025.09.21 시험

    // 원본 문제번호 추출 (q-num 또는 qn)
    const qnMatch = cardHtml.match(/<span class="(?:q-num|qn)">(\d+)\./);
    const originalNumber = qnMatch ? qnMatch[1] : String(num);

    // 문제 본문 추출
    const bodyMatch = cardHtml.match(/<div class="question-body">([\s\S]*?)<\/div>/);
    let body = '';
    if (bodyMatch) {
      body = bodyMatch[1]
        .replace(/<span class="(?:q-num|qn)">\d+\.<\/span>\s*/, '') // 문제번호 제거
        .replace(/\n\s+/g, ' ')  // 줄바꿈 정리
        .trim();
    }

    // 선택지 추출
    const answerMatch = cardHtml.match(/data-answer="(\d+)"/);
    const answer = answerMatch ? parseInt(answerMatch[1], 10) : 0;

    const choices = [];
    const choiceRegex = /<li data-num="(\d+)"><span class="c-num">[①②③④]<\/span>\s*([\s\S]*?)<\/li>/g;
    let cMatch;
    while ((cMatch = choiceRegex.exec(cardHtml)) !== null) {
      choices.push({
        num: parseInt(cMatch[1], 10),
        text: cMatch[2].replace(/\n\s+/g, ' ').trim()
      });
    }

    // 해설 추출 (explanation 전체 HTML)
    const expMatch = cardHtml.match(/<div class="explanation"[^>]*>([\s\S]*?)(?=<div class="screenshot-wrap"|<div class="ai-controls"|$)/);
    let explanation = '';
    if (expMatch) {
      explanation = expMatch[1].trim();
      // 빈 해설 체크
      if (explanation.replace(/<[^>]*>/g, '').trim().length < 10) {
        explanation = '';
      }
    }

    // 이미지 파일명
    const imageUrl = `q${String(num).padStart(3, '0')}.png`;

    questions.push({
      questionNumber: num,
      examId,
      originalNumber,
      body,
      choices,
      answer,
      explanation,
      imageUrl,
    });
  }

  return questions;
}

async function migrate() {
  console.log('HTML 파일 읽는 중...');
  const html = fs.readFileSync('./index.html', 'utf-8');

  console.log('문항 파싱 중...');
  const questions = parseQuestions(html);
  console.log(`파싱 완료: ${questions.length}개 문항`);

  if (questions.length === 0) {
    console.error('파싱 결과가 비어있습니다!');
    process.exit(1);
  }

  // 기존 데이터 삭제 (재실행 대비)
  await query('DELETE FROM questions');
  console.log('기존 questions 데이터 삭제');

  // 일괄 INSERT
  let inserted = 0;
  for (const q of questions) {
    await query(
      `INSERT INTO questions (exam_id, subject_id, question_number, original_number, body, choices, answer, explanation, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        q.examId,
        null, // subject_id는 나중에 관리자가 지정
        q.questionNumber,
        q.originalNumber,
        q.body,
        JSON.stringify(q.choices),
        q.answer,
        q.explanation || null,
        q.imageUrl,
      ]
    );
    inserted++;
  }

  console.log(`DB INSERT 완료: ${inserted}개`);

  // 검증
  const count = await query('SELECT COUNT(*) as cnt FROM questions');
  console.log(`DB 검증: ${count.rows[0].cnt}개 문항 저장됨`);

  // 샘플 확인
  const sample = await query('SELECT question_number, original_number, answer, jsonb_array_length(choices) as choice_count FROM questions ORDER BY question_number LIMIT 5');
  console.log('샘플 데이터:');
  console.table(sample.rows);

  const examCounts = await query('SELECT e.title, COUNT(q.id) as cnt FROM questions q JOIN exams e ON q.exam_id = e.id GROUP BY e.title ORDER BY e.sort_order');
  console.log('시험별 문항수:');
  console.table(examCounts.rows);

  process.exit(0);
}

migrate().catch(err => { console.error(err); process.exit(1); });
