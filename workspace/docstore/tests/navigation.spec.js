// 탭 네비게이션 E2E 테스트
// 인증: global-setup에서 저장된 storageState 자동 사용
const { test, expect } = require('@playwright/test');

test.describe('탭 네비게이션', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // 인증 상태가 로드되어 자동 로그인됨 → nav 대기
    await expect(page.locator('nav')).toBeVisible({ timeout: 15000 });
  });

  test('하단 네비게이션에 6개 탭이 표시된다', async ({ page }) => {
    const nav = page.locator('nav');
    await expect(nav.locator('button').filter({ hasText: '등록' })).toBeVisible();
    await expect(nav.locator('button').filter({ hasText: '문서' })).toBeVisible();
    await expect(nav.locator('button').filter({ hasText: '검색' })).toBeVisible();
    await expect(nav.locator('button').filter({ hasText: '채팅' })).toBeVisible();
    await expect(nav.locator('button').filter({ hasText: '설정' })).toBeVisible();
    await expect(nav.locator('button').filter({ hasText: '튜닝' })).toBeVisible();
  });

  test('문서 탭으로 전환된다', async ({ page }) => {
    await page.locator('nav button').filter({ hasText: '문서' }).click();
    await page.waitForResponse(
      resp => resp.url().includes('/api/documents'),
      { timeout: 15000 }
    );
  });

  test('검색 탭으로 전환된다', async ({ page }) => {
    await page.locator('nav button').filter({ hasText: '검색' }).click();
    await expect(page.getByPlaceholder('검색어를 입력하세요...')).toBeVisible();
  });

  test('채팅 탭으로 전환된다', async ({ page }) => {
    await page.locator('nav button').filter({ hasText: '채팅' }).click();
    await expect(page.getByText(/Gemini/).first()).toBeVisible({ timeout: 10000 });
  });

  test('설정 탭으로 전환된다', async ({ page }) => {
    await page.locator('nav button').filter({ hasText: '설정' }).click();
    // 설정 탭 내 서브탭 확인
    await expect(page.getByRole('button', { name: 'API 키 관리' })).toBeVisible({ timeout: 10000 });
  });

  test('튜닝 탭으로 전환된다', async ({ page }) => {
    await page.locator('nav button').filter({ hasText: '튜닝' }).click();
    // 튜닝 탭 내 서브탭 확인
    await expect(page.getByRole('button', { name: '대시보드' })).toBeVisible({ timeout: 15000 });
  });
});
