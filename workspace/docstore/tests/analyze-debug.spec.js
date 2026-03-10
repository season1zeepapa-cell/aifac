// AI 분석 디버깅 테스트 — 실제 API 호출하여 에러 원인 파악
const { test, expect } = require('@playwright/test');

test.setTimeout(180000); // 3분 타임아웃

test('AI 분석 버튼 동작 확인', async ({ page }) => {
  // 콘솔 로그 캡처
  const consoleLogs = [];
  page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));

  // 네트워크 요청/응답 캡처
  const networkErrors = [];
  page.on('requestfailed', req => {
    networkErrors.push(`FAILED: ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });

  await page.goto('/');
  await expect(page.locator('nav')).toBeVisible({ timeout: 10000 });

  // 문서 목록 탭으로 이동
  await page.locator('nav button').filter({ hasText: '문서 목록' }).click();
  await page.waitForResponse(
    resp => resp.url().includes('/api/documents'),
    { timeout: 10000 }
  );

  // 첫 번째 문서 카드 클릭 (펼치기)
  const firstCard = page.locator('[class*="rounded-xl"]').first();
  await firstCard.click();

  // 카드가 펼쳐질 때까지 대기
  await page.waitForTimeout(1000);

  // AI 분석 버튼 찾기
  const analyzeBtn = page.getByRole('button', { name: /AI 분석/ });

  // 버튼이 있는지 확인
  const btnVisible = await analyzeBtn.isVisible().catch(() => false);
  console.log('AI 분석 버튼 표시:', btnVisible);

  if (!btnVisible) {
    // 스크린샷 찍고 종료
    await page.screenshot({ path: 'test-results/analyze-no-button.png', fullPage: true });
    console.log('AI 분석 버튼을 찾을 수 없음');
    return;
  }

  // 네트워크 응답 모니터링 (버튼 클릭 전에 설정)
  const responsePromise = page.waitForResponse(
    resp => resp.url().includes('/api/documents') && resp.request().method() === 'POST',
    { timeout: 150000 }
  );

  // AI 분석 버튼 클릭
  await analyzeBtn.click();
  console.log('AI 분석 버튼 클릭 완료');

  // alert 다이얼로그 캡처
  let alertMessage = null;
  page.on('dialog', async dialog => {
    alertMessage = dialog.message();
    console.log('Alert:', alertMessage);
    await dialog.accept();
  });

  try {
    // API 응답 대기 (최대 2.5분)
    const response = await responsePromise;
    const status = response.status();
    let body;
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }

    console.log('=== AI 분석 API 응답 ===');
    console.log('Status:', status);
    console.log('Body:', JSON.stringify(body, null, 2));

    if (status !== 200) {
      console.log('에러 응답:', JSON.stringify(body));
    }
  } catch (err) {
    console.log('API 응답 대기 실패:', err.message);
  }

  // 잠시 대기 후 최종 상태 스크린샷
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'test-results/analyze-final.png', fullPage: true });

  // 수집된 로그 출력
  if (alertMessage) console.log('Alert 메시지:', alertMessage);
  if (networkErrors.length) console.log('네트워크 에러:', networkErrors);
  console.log('콘솔 로그:', consoleLogs.filter(l => l.includes('error') || l.includes('Error') || l.includes('fail')));
});
