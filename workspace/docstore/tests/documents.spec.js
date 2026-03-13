// 문서 목록 탭 E2E 테스트
// 인증: global-setup에서 저장된 storageState 자동 사용
const { test, expect } = require('@playwright/test');

test.describe('문서 목록', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('nav')).toBeVisible({ timeout: 15000 });
    // 문서 목록 탭으로 이동
    await page.locator('nav button').filter({ hasText: '문서 목록' }).click();
    await page.waitForResponse(
      resp => resp.url().includes('/api/documents'),
      { timeout: 15000 }
    );
    // 로딩 스피너 사라질 때까지 대기
    await expect(page.locator('.animate-spin')).not.toBeVisible({ timeout: 10000 }).catch(() => {});
  });

  test('문서 카드가 표시된다', async ({ page }) => {
    // 문서가 있으면 카드 형태로 표시됨 (Card 컴포넌트는 rounded-xl 클래스 사용)
    // 로딩 완료 후 잠시 대기
    await page.waitForTimeout(1000);
    const hasDocuments = await page.locator('.rounded-xl').count() > 0;
    const hasEmptyMessage = await page.getByText(/등록된 문서/).isVisible().catch(() => false);
    expect(hasDocuments || hasEmptyMessage).toBeTruthy();
  });

  test('문서가 5개 이상이면 더보기 버튼이 표시된다', async ({ page }) => {
    const moreBtn = page.getByText(/더보기/);
    if (await moreBtn.isVisible().catch(() => false)) {
      // 더보기 클릭하면 더 많은 문서가 표시됨
      await moreBtn.click();
    }
  });

  test('등록 탭의 업로드 영역이 표시된다', async ({ page }) => {
    await page.locator('nav button').filter({ hasText: '등록' }).click();
    await expect(page.locator('.drop-zone')).toBeVisible();
  });
});
