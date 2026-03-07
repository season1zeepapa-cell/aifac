// Phase 0: DB 데이터 보정 스크립트
// 검증에서 발견된 2건의 불일치를 수정한다.
// 1) q009: scenario 영역을 body에 합침
// 2) q041: qb 클래스로 인해 body 추출 누락 수정
require('dotenv').config();
const fs = require('fs');
const { query } = require('./api/db');

async function fix() {
  console.log('=== DB 데이터 보정 시작 ===\n');
  const html = fs.readFileSync('./index.html', 'utf-8');

  // ── 수정 1: q009 — scenario를 body에 합침 ──
  console.log('[q009] scenario 보정...');
  const q009CardMatch = html.match(/<div class="card" id="q009">([\s\S]*?)(?=<div class="card" id="q010">)/);
  if (q009CardMatch) {
    const cardHtml = q009CardMatch[1];

    // 기존 body 추출
    const bodyMatch = cardHtml.match(/<div class="question-body">([\s\S]*?)<\/div>/);
    let body = bodyMatch ? bodyMatch[1]
      .replace(/<span class="(?:q-num|qn)">\d+\.<\/span>\s*/, '')
      .replace(/\n\s+/g, ' ')
      .trim() : '';

    // scenario 추출
    const scenarioMatch = cardHtml.match(/<div class="scenario">([\s\S]*?)<\/div>\s*<ul class="choices"/);
    if (scenarioMatch) {
      const scenarioHtml = scenarioMatch[1].trim();
      // body 뒤에 scenario HTML을 붙인다
      body = body + '\n\n<div class="scenario">' + scenarioHtml + '</div>';
    }

    await query('UPDATE questions SET body = $1, updated_at = NOW() WHERE question_number = $2', [body, 9]);
    console.log('  body에 scenario 합침 완료');

    // 검증
    const check = await query('SELECT body FROM questions WHERE question_number = 9');
    const hasScenario = check.rows[0].body.includes('scenario');
    console.log(`  검증: scenario 포함 여부 = ${hasScenario}`);
  }

  // ── 수정 2: q041 — qb 클래스 본문 재추출 ──
  console.log('\n[q041] qb 클래스 body 보정...');
  const q041CardMatch = html.match(/<div class="card" id="q041">([\s\S]*?)(?=<div class="card" id="q042">)/);
  if (q041CardMatch) {
    const cardHtml = q041CardMatch[1];

    // qb 클래스에서 body 추출
    const qbMatch = cardHtml.match(/<div class="qb">([\s\S]*?)<\/div>/);
    let body = '';
    if (qbMatch) {
      body = qbMatch[1]
        .replace(/<span class="(?:q-num|qn)">\d+\.<\/span>\s*/, '')
        .replace(/\n\s+/g, ' ')
        .trim();
    }

    if (body) {
      await query('UPDATE questions SET body = $1, updated_at = NOW() WHERE question_number = $2', [body, 41]);
      console.log(`  body 업데이트 완료: "${body.slice(0, 60)}..."`);
    }

    // 검증
    const check = await query('SELECT body FROM questions WHERE question_number = 41');
    console.log(`  검증: DB body = "${check.rows[0].body.slice(0, 60)}..."`);
  }

  console.log('\n=== 보정 완료 ===');
  process.exit(0);
}

fix().catch(err => { console.error('보정 오류:', err); process.exit(1); });
