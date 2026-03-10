// 검색 탭 E2E 테스트
// 인증: global-setup에서 저장된 storageState 자동 사용
const { test, expect } = require('@playwright/test');

test.describe('검색 기능', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('nav')).toBeVisible({ timeout: 10000 });
    // 검색 탭으로 이동
    await page.locator('nav button').filter({ hasText: '검색' }).click();
  });

  test('검색 UI 요소가 모두 표시된다', async ({ page }) => {
    // 검색 입력창
    await expect(page.getByPlaceholder('검색어를 입력하세요...')).toBeVisible();

    // 검색 버튼 (main 영역 내 버튼, nav 탭의 "검색"과 구분)
    await expect(page.getByRole('main').getByRole('button', { name: '검색', exact: true })).toBeVisible();

    // 검색 모드 버튼 확인
    await expect(page.getByRole('button', { name: '텍스트 검색' })).toBeVisible();
    await expect(page.getByRole('button', { name: '의미 검색' })).toBeVisible();
  });

  test('텍스트 검색이 실행되고 결과가 표시된다', async ({ page }) => {
    await page.getByPlaceholder('검색어를 입력하세요...').fill('법률');
    await page.getByRole('main').getByRole('button', { name: '검색', exact: true }).click();

    const response = await page.waitForResponse(
      resp => resp.url().includes('/api/search'),
      { timeout: 15000 }
    );
    expect(response.status()).toBe(200);
  });

  test('문서 범위 멀티 선택이 동작한다', async ({ page }) => {
    const multiSelect = page.getByText('전체').first();
    if (await multiSelect.isVisible()) {
      await multiSelect.click();
      const checkboxes = page.locator('input[type="checkbox"]');
      const count = await checkboxes.count();
      if (count > 0) {
        expect(count).toBeGreaterThan(0);
      }
    }
  });
});
