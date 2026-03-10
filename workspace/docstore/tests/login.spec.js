// 로그인 기능 E2E 테스트
// 이 테스트는 storageState 없이 실행됨 (playwright.config.js의 setup 프로젝트)
const { test, expect } = require('@playwright/test');

test.describe('로그인 화면', () => {

  test.beforeEach(async ({ page }) => {
    // 인증 상태 초기화 (로그아웃 상태에서 시작)
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('docstore_token');
      localStorage.removeItem('docstore_user');
    });
    await page.reload();
  });

  test('로그인 페이지가 정상 로드된다', async ({ page }) => {
    // DocStore 타이틀 확인
    await expect(page.getByText('DocStore')).toBeVisible();

    // 로그인 폼 요소 확인
    await expect(page.getByPlaceholder('아이디를 입력하세요')).toBeVisible();
    await expect(page.getByPlaceholder('비밀번호를 입력하세요')).toBeVisible();
    await expect(page.getByRole('button', { name: '로그인' })).toBeVisible();
  });

  test('빈 입력으로 로그인 시 에러 메시지가 표시된다', async ({ page }) => {
    // 아무것도 입력하지 않고 로그인 버튼 클릭
    await page.getByRole('button', { name: '로그인' }).click();

    // 에러 메시지 표시 확인
    await expect(page.locator('.bg-red-50')).toContainText('아이디와 비밀번호를 입력해주세요');
  });

  test('잘못된 계정으로 로그인 시 에러가 표시된다', async ({ page }) => {
    // 잘못된 계정 입력
    await page.getByPlaceholder('아이디를 입력하세요').fill('wrong_user');
    await page.getByPlaceholder('비밀번호를 입력하세요').fill('wrong_pass');
    await page.getByRole('button', { name: '로그인' }).click();

    // 서버 응답 대기 후 에러 메시지 확인
    await expect(page.locator('.bg-red-50')).toBeVisible({ timeout: 10000 });
  });

  test('정상 로그인 시 메인 화면으로 이동한다', async ({ page }) => {
    const testId = process.env.TEST_ID;
    const testPw = process.env.TEST_PW;
    if (!testId || !testPw) {
      test.skip(true, 'TEST_ID, TEST_PW 환경변수가 필요합니다');
      return;
    }

    // 로그인
    await page.getByPlaceholder('아이디를 입력하세요').fill(testId);
    await page.getByPlaceholder('비밀번호를 입력하세요').fill(testPw);
    await page.getByRole('button', { name: '로그인' }).click();

    // 하단 네비게이션이 나타나면 로그인 성공
    await expect(page.locator('nav')).toBeVisible({ timeout: 10000 });
  });
});
