// Phase 0: HTML ↔ DB 데이터 검증 스크립트
// HTML 원본에서 파싱한 결과와 DB 저장 결과를 비교하여 불일치 항목을 찾는다.
require('dotenv').config();
const fs = require('fs');
const { query } = require('./api/db');

// ── HTML 파싱 (마이그레이션과 동일 로직 + scenario/box 추가 추출) ──
function parseHtmlQuestions(html) {
  const questions = [];
  const cardRegex = /<div class="card" id="q(\d+)">([\s\S]*?)(?=<div class="card" id="q\d+">|<\/main>)/g;
  let match;

  while ((match = cardRegex.exec(html)) !== null) {
    const num = parseInt(match[1], 10);
    const cardHtml = match[2];

    // 시험 그룹
    let examId;
    if (num <= 110) examId = 1;
    else if (num <= 150) examId = 2;
    else examId = 3;

    // 원본 문제번호
    const qnMatch = cardHtml.match(/<span class="(?:q-num|qn)">(\d+)\./);
    const originalNumber = qnMatch ? qnMatch[1] : String(num);

    // 문제 본문 (question-body 안)
    const bodyMatch = cardHtml.match(/<div class="question-body">([\s\S]*?)<\/div>/);
    let body = '';
    if (bodyMatch) {
      body = bodyMatch[1]
        .replace(/<span class="(?:q-num|qn)">\d+\.<\/span>\s*/, '')
        .replace(/\n\s+/g, ' ')
        .trim();
    }

    // scenario 영역 (question-body 밖, choices 앞)
    const scenarioMatch = cardHtml.match(/<div class="scenario">([\s\S]*?)<\/div>\s*<ul class="choices"/);
    const hasScenario = !!scenarioMatch;
    let scenarioHtml = scenarioMatch ? scenarioMatch[1].trim() : '';

    // box 영역 (question-body 안에 포함된 경우)
    const hasBox = /<div class="box">/.test(cardHtml.match(/<div class="question-body">([\s\S]*?)<\/div>/)?.[0] || '');

    // 정답
    const answerMatch = cardHtml.match(/data-answer="(\d+)"/);
    const answer = answerMatch ? parseInt(answerMatch[1], 10) : 0;

    // 선택지
    const choices = [];
    const choiceRegex = /<li data-num="(\d+)"><span class="c-num">[①②③④]<\/span>\s*([\s\S]*?)<\/li>/g;
    let cMatch;
    while ((cMatch = choiceRegex.exec(cardHtml)) !== null) {
      choices.push({
        num: parseInt(cMatch[1], 10),
        text: cMatch[2].replace(/\n\s+/g, ' ').trim()
      });
    }

    // 해설 (explanation 전체)
    const expMatch = cardHtml.match(/<div class="explanation"[^>]*>([\s\S]*?)$/);
    let explanation = '';
    let hasExpBody = false;
    if (expMatch) {
      explanation = expMatch[1].trim();
      hasExpBody = /<div class="exp-body">/.test(explanation);
      // 텍스트만 추출해서 길이 체크
      const textOnly = explanation.replace(/<[^>]*>/g, '').trim();
      if (textOnly.length < 10) {
        explanation = '';
        hasExpBody = false;
      }
    }

    questions.push({
      questionNumber: num,
      examId,
      originalNumber,
      body,
      choices,
      answer,
      hasScenario,
      scenarioHtml,
      hasBox,
      hasExpBody,
      explanationLength: explanation.length,
    });
  }
  return questions;
}

// ── 텍스트 정규화 (비교용) ──
function normalize(str) {
  if (!str) return '';
  return str
    .replace(/<[^>]*>/g, '')   // HTML 태그 제거
    .replace(/\s+/g, ' ')      // 공백 정리
    .trim()
    .slice(0, 100);            // 앞 100자만 비교
}

async function verify() {
  console.log('=== Phase 0: HTML ↔ DB 데이터 검증 ===\n');

  // 1) HTML 파싱
  console.log('1. HTML 파싱 중...');
  const html = fs.readFileSync('./index.html', 'utf-8');
  const htmlQuestions = parseHtmlQuestions(html);
  console.log(`   HTML에서 ${htmlQuestions.length}개 문항 파싱 완료\n`);

  // 2) DB 조회
  console.log('2. DB 조회 중...');
  const dbResult = await query('SELECT * FROM questions ORDER BY question_number');
  const dbQuestions = dbResult.rows;
  console.log(`   DB에서 ${dbQuestions.length}개 문항 조회 완료\n`);

  // 3) 개수 비교
  if (htmlQuestions.length !== dbQuestions.length) {
    console.log(`!! 문항 개수 불일치: HTML=${htmlQuestions.length}, DB=${dbQuestions.length}`);
  }

  // 4) 항목별 비교
  const issues = [];
  const stats = {
    total: htmlQuestions.length,
    bodyMatch: 0,
    bodyMismatch: 0,
    answerMatch: 0,
    answerMismatch: 0,
    choicesMatch: 0,
    choicesMismatch: 0,
    expHasInHtml: 0,
    expHasInDb: 0,
    expMissing: 0,
    scenarioCards: 0,
    scenarioMissingInDb: 0,
    boxCards: 0,
  };

  for (const hq of htmlQuestions) {
    const dq = dbQuestions.find(d => d.question_number === hq.questionNumber);
    if (!dq) {
      issues.push({ q: hq.questionNumber, type: 'MISSING', msg: 'DB에 문항 없음' });
      continue;
    }

    // body 비교
    const hBody = normalize(hq.body);
    const dBody = normalize(dq.body);
    if (hBody === dBody) {
      stats.bodyMatch++;
    } else {
      stats.bodyMismatch++;
      issues.push({
        q: hq.questionNumber,
        type: 'BODY',
        msg: `본문 불일치`,
        html: hBody.slice(0, 60),
        db: dBody.slice(0, 60),
      });
    }

    // answer 비교
    if (hq.answer === dq.answer) {
      stats.answerMatch++;
    } else {
      stats.answerMismatch++;
      issues.push({
        q: hq.questionNumber,
        type: 'ANSWER',
        msg: `정답 불일치: HTML=${hq.answer}, DB=${dq.answer}`,
      });
    }

    // choices 개수 비교
    const dbChoices = typeof dq.choices === 'string' ? JSON.parse(dq.choices) : dq.choices;
    if (hq.choices.length === dbChoices.length) {
      stats.choicesMatch++;
    } else {
      stats.choicesMismatch++;
      issues.push({
        q: hq.questionNumber,
        type: 'CHOICES',
        msg: `선택지 개수: HTML=${hq.choices.length}, DB=${dbChoices.length}`,
      });
    }

    // explanation 비교
    if (hq.hasExpBody) stats.expHasInHtml++;
    if (dq.explanation && dq.explanation.trim().length > 10) {
      stats.expHasInDb++;
    } else if (hq.hasExpBody) {
      stats.expMissing++;
      issues.push({
        q: hq.questionNumber,
        type: 'EXP_MISSING',
        msg: `해설 누락: HTML에는 있으나 DB에 없음 (HTML 길이: ${hq.explanationLength})`,
      });
    }

    // scenario 확인
    if (hq.hasScenario) {
      stats.scenarioCards++;
      // DB body에 scenario 내용이 포함되어 있는지 확인
      const scenarioText = normalize(hq.scenarioHtml);
      const dbBodyFull = normalize(dq.body);
      if (!dbBodyFull.includes(scenarioText.slice(0, 30))) {
        stats.scenarioMissingInDb++;
        issues.push({
          q: hq.questionNumber,
          type: 'SCENARIO',
          msg: `시나리오 영역이 DB body에 미포함`,
          scenario: scenarioText.slice(0, 80),
        });
      }
    }

    // box 확인
    if (hq.hasBox) stats.boxCards++;
  }

  // 5) 결과 출력
  console.log('=== 검증 결과 요약 ===\n');
  console.log(`총 문항: ${stats.total}`);
  console.log(`\n[본문 (body)]`);
  console.log(`  일치: ${stats.bodyMatch} / 불일치: ${stats.bodyMismatch}`);
  console.log(`\n[정답 (answer)]`);
  console.log(`  일치: ${stats.answerMatch} / 불일치: ${stats.answerMismatch}`);
  console.log(`\n[선택지 (choices)]`);
  console.log(`  일치: ${stats.choicesMatch} / 불일치: ${stats.choicesMismatch}`);
  console.log(`\n[해설 (explanation)]`);
  console.log(`  HTML에 해설 있음: ${stats.expHasInHtml}`);
  console.log(`  DB에 해설 있음:   ${stats.expHasInDb}`);
  console.log(`  DB에 해설 누락:   ${stats.expMissing}`);
  console.log(`\n[특수 구조]`);
  console.log(`  scenario 카드: ${stats.scenarioCards}개`);
  console.log(`  scenario DB 미포함: ${stats.scenarioMissingInDb}개`);
  console.log(`  box 포함 카드: ${stats.boxCards}개`);

  if (issues.length > 0) {
    console.log(`\n=== 불일치 상세 (${issues.length}건) ===\n`);
    issues.forEach(issue => {
      console.log(`  q${String(issue.q).padStart(3, '0')} [${issue.type}] ${issue.msg}`);
      if (issue.html) console.log(`    HTML: "${issue.html}"`);
      if (issue.db) console.log(`    DB:   "${issue.db}"`);
      if (issue.scenario) console.log(`    시나리오: "${issue.scenario}"`);
    });
  } else {
    console.log('\n모든 항목 일치! DB 데이터가 HTML 원본과 동일합니다.');
  }

  console.log('\n=== 검증 완료 ===');
  process.exit(0);
}

verify().catch(err => { console.error('검증 오류:', err); process.exit(1); });
