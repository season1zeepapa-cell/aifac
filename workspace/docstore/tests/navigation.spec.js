// 탭 네비게이션 E2E 테스트
// 인증: global-setup에서 저장된 storageState 자동 사용
const { test, expect } = require('@playwright/test');

test.describe('탭 네비게이션', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // 인증 상태가 로드되어 자동 로그인됨 → nav 대기
    await expect(page.locator('nav')).toBeVisible({ timeout: 10000 });
  });

  test('하단 네비게이션에 5개 탭이 표시된다', async ({ page }) => {
    const nav = page.locator('nav');
    await expect(nav.locator('button').filter({ hasText: '등록' })).toBeVisible();
    await expect(nav.locator('button').filter({ hasText: '문서 목록' })).toBeVisible();
    await expect(nav.locator('button').filter({ hasText: '검색' })).toBeVisible();
    await expect(nav.locator('button').filter({ hasText: 'AI 채팅' })).toBeVisible();
    await expect(nav.locator('button').filter({ hasText: '관리' })).toBeVisible();
  });

  test('문서 목록 탭으로 전환된다', async ({ page }) => {
    await page.locator('nav button').filter({ hasText: '문서 목록' }).click();
    await page.waitForResponse(
      resp => resp.url().includes('/api/documents'),
      { timeout: 10000 }
    );
  });

  test('검색 탭으로 전환된다', async ({ page }) => {
    await page.locator('nav button').filter({ hasText: '검색' }).click();
    await expect(page.getByPlaceholder('검색어를 입력하세요...')).toBeVisible();
  });

  test('AI 채팅 탭으로 전환된다', async ({ page }) => {
    await page.locator('nav button').filter({ hasText: 'AI 채팅' }).click();
    await expect(page.getByText(/Gemini/).first()).toBeVisible();
  });

  test('관리 탭으로 전환된다', async ({ page }) => {
    await page.locator('nav button').filter({ hasText: '관리' }).click();
    await page.waitForResponse(
      resp => resp.url().includes('/api/api-usage'),
      { timeout: 15000 }
    );
  });
});
