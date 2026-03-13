// 전역 설정: API 직접 호출로 로그인 후 인증 상태 저장
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

  // 1) API 직접 호출로 토큰 획득 (UI 로그인 대신)
  let token, loginData;
  try {
    const res = await fetch(`${baseURL}/api/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': baseURL,
      },
      body: JSON.stringify({ id: testId, password: testPw }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.log(`[global-setup] 로그인 API 실패: HTTP ${res.status} - ${text}`);
      return;
    }
    loginData = await res.json();
    token = loginData.token;
    console.log('[global-setup] API 로그인 성공:', loginData.name);
  } catch (err) {
    console.log('[global-setup] 로그인 API 호출 에러:', err.message);
    return;
  }

  // 2) 브라우저 열어서 localStorage에 토큰 주입 → storageState 저장
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // localStorage에 인증 정보 저장
  await page.evaluate(({ token, loginData }) => {
    localStorage.setItem('docstore_token', token);
    localStorage.setItem('docstore_user', JSON.stringify({
      name: loginData.name,
      admin: loginData.admin,
      orgId: loginData.orgId,
      orgName: loginData.orgName,
    }));
  }, { token, loginData });

  // 페이지 새로고침 → 로그인된 상태로 진입
  await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('nav', { timeout: 15000 }).catch(() => {
    console.log('[global-setup] nav 표시 대기 실패 - 토큰 주입 후에도 로그인 안 됨');
  });

  // storageState 저장
  const fs = require('fs');
  const authDir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  await page.context().storageState({ path: AUTH_FILE });
  console.log('[global-setup] 인증 상태 저장 완료');

  await browser.close();
};

module.exports.AUTH_FILE = AUTH_FILE;
