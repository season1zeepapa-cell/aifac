// 전역 설정: 한 번만 로그인하고 인증 상태를 저장
// 이후 모든 테스트에서 저장된 인증 상태를 재사용 (rate limit 방어)
const { chromium } = require('@playwright/test');
const path = require('path');

const AUTH_FILE = path.join(__dirname, '.auth', 'storage-state.json');

module.exports = async function globalSetup(config) {
  const testId = process.env.TEST_ID;
  const testPw = process.env.TEST_PW;

  if (!testId || !testPw) {
    console.log('[global-setup] TEST_ID/TEST_PW 없음 → 인증 스킵');
    return;
  }

  const baseURL = config.projects[0].use?.baseURL || 'https://docstore-eight.vercel.app';

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // 로그인 수행
  await page.goto(baseURL);
  await page.getByPlaceholder('아이디를 입력하세요').fill(testId);
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(testPw);
  await page.getByRole('button', { name: '로그인' }).click();

  // 로그인 성공 대기 (nav 표시)
  await page.waitForSelector('nav', { timeout: 15000 });

  // localStorage에 저장된 인증 토큰 포함하여 상태 저장
  const fs = require('fs');
  const authDir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  await page.context().storageState({ path: AUTH_FILE });
  console.log('[global-setup] 인증 상태 저장 완료');

  await browser.close();
};

module.exports.AUTH_FILE = AUTH_FILE;
