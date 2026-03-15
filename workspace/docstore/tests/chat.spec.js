// AI 채팅 탭 E2E 테스트
// 인증: global-setup에서 저장된 storageState 자동 사용
// 주의: 실제 AI API 호출은 비용 발생 → UI 확인 위주로 테스트
const { test, expect } = require('@playwright/test');

test.describe('AI 채팅', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('nav')).toBeVisible({ timeout: 15000 });
    // AI 채팅 탭으로 이동 (실제 라벨: 'AI 채팅')
    await page.locator('nav button').filter({ hasText: '채팅' }).click();
    // 채팅 UI 로드 대기
    await expect(page.getByPlaceholder('질문을 입력하세요...')).toBeVisible({ timeout: 10000 });
  });

  test('채팅 UI 요소가 모두 표시된다', async ({ page }) => {
    // 질문 입력창 확인
    await expect(page.getByPlaceholder('질문을 입력하세요...')).toBeVisible();

    // 하단 상태바에 프로바이더 정보 확인
    await expect(page.getByText(/Gemini/).first()).toBeVisible();

    // 설정 / 새 대화 버튼 확인 (main 영역으로 범위 한정 — nav '설정' 탭과 충돌 방지)
    await expect(page.locator('main').getByText('설정')).toBeVisible();
    await expect(page.locator('main').getByText('새 대화')).toBeVisible();
  });

  test('하단 상태바에 모델 버전이 표시된다', async ({ page }) => {
    const statusText = await page.getByText(/gemini-/).first().textContent();
    expect(statusText).toMatch(/gemini-/);
  });

  test('설정 버튼으로 프로바이더를 변경할 수 있다', async ({ page }) => {
    // main 영역 내의 설정 버튼 클릭 (nav '설정' 탭과 구분)
    await page.locator('main').getByText('설정').click();
    await expect(page.getByText(/OpenAI|GPT/).first()).toBeVisible({ timeout: 5000 });
  });

  test('예시 질문 버튼들이 표시된다', async ({ page }) => {
    await expect(page.getByText(/CCTV 설치 기준/).first()).toBeVisible();
  });

  test('문서 범위 정보가 상태바에 표시된다', async ({ page }) => {
    await expect(page.getByText(/전체 문서|문서 선택/).first()).toBeVisible();
  });

  // AI API 실제 호출 테스트 (비용 발생 - 기본 스킵)
  test.skip('질문을 전송하면 AI 답변이 표시된다', async ({ page }) => {
    await page.getByPlaceholder('질문을 입력하세요...').fill('이 문서의 주요 내용을 요약해주세요');
    await page.locator('button').filter({ has: page.locator('svg') }).last().click();
    await page.waitForResponse(
      resp => resp.url().includes('/api/rag'),
      { timeout: 60000 }
    );
  });
});
