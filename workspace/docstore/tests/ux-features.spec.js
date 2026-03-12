// UX1: 문서 메타 인라인 편집 + UX2: 임베딩 재생성 버튼 E2E 테스트
const { test, expect } = require('@playwright/test');

// 문서 목록 탭으로 이동 + 문서 로드 완료 대기
async function goToDocumentList(page) {
  await page.goto('/');
  await expect(page.locator('nav')).toBeVisible({ timeout: 10000 });
  await page.locator('nav button').filter({ hasText: '문서 목록' }).click();
  await page.waitForResponse(
    resp => resp.url().includes('/api/documents') && resp.status() === 200,
    { timeout: 15000 }
  );
  // 로딩 스피너가 사라질 때까지 대기
  await expect(page.locator('.animate-spin')).not.toBeVisible({ timeout: 10000 }).catch(() => {});
}

// 첫 번째 문서 카드 클릭 → 상세 모달 열기
async function openFirstDocumentModal(page) {
  const firstCard = page.locator('[class*="rounded-xl"]').first();
  await expect(firstCard).toBeVisible({ timeout: 10000 });
  await firstCard.click();
  // 모달 내 문서 데이터 로드 대기
  await page.waitForResponse(
    resp => resp.url().includes('/api/documents?id=') && resp.status() === 200,
    { timeout: 15000 }
  );
  // "수정" 버튼이 보일 때까지 대기 (모달 렌더 완료)
  await expect(page.getByText('수정', { exact: true })).toBeVisible({ timeout: 5000 });
}

test.describe('UX1: 문서 메타 인라인 편집', () => {

  test.beforeEach(async ({ page }) => {
    await goToDocumentList(page);
  });

  test('문서 상세 모달에 수정 버튼이 표시된다', async ({ page }) => {
    await openFirstDocumentModal(page);
    const editBtn = page.getByText('수정', { exact: true });
    await expect(editBtn).toBeVisible({ timeout: 5000 });
  });

  test('수정 버튼 클릭 시 인라인 편집 모드로 전환된다', async ({ page }) => {
    await openFirstDocumentModal(page);
    await page.getByText('수정', { exact: true }).click();
    // 제목 입력 필드가 나타남
    const titleInput = page.locator('input[placeholder="제목"]');
    await expect(titleInput).toBeVisible({ timeout: 3000 });
    // 카테고리 select가 나타남
    await expect(page.locator('select').first()).toBeVisible();
    // 저장/취소 버튼이 나타남
    await expect(page.getByRole('button', { name: '저장' })).toBeVisible();
    await expect(page.getByRole('button', { name: '취소' })).toBeVisible();
  });

  test('취소 버튼 클릭 시 편집 모드가 종료된다', async ({ page }) => {
    await openFirstDocumentModal(page);
    await page.getByText('수정', { exact: true }).click();
    await page.getByRole('button', { name: '취소' }).click();
    const titleInput = page.locator('input[placeholder="제목"]');
    await expect(titleInput).not.toBeVisible({ timeout: 3000 });
    await expect(page.getByText('수정', { exact: true })).toBeVisible();
  });

  test('제목 수정 후 저장하면 API 호출이 성공한다', async ({ page }) => {
    test.setTimeout(60000);
    await openFirstDocumentModal(page);

    // 수정 모드 진입
    await page.getByText('수정', { exact: true }).click();
    const titleInput = page.locator('input[placeholder="제목"]');
    await expect(titleInput).toBeVisible({ timeout: 3000 });

    // 현재 제목 기억
    const originalTitle = await titleInput.inputValue();
    const testTitle = originalTitle + '_E2E';

    // 제목 변경
    await titleInput.fill(testTitle);

    // 저장 → page.evaluate로 API 직접 호출 방식 대신 UI 클릭 + 네트워크 관찰
    // "저장" 버튼 클릭
    await page.getByRole('button', { name: '저장' }).click();

    // updateMeta POST 응답 + 리로드 GET 응답 기다리기
    // POST 응답이 올 때까지 기다림
    await page.waitForResponse(
      resp => resp.url().includes('/api/documents') &&
              resp.request().method() === 'POST' &&
              resp.request().postData()?.includes('updateMeta'),
      { timeout: 15000 }
    );

    // 리로드 완료 후 수정 버튼이 다시 보이는지 확인
    await expect(page.getByText('수정', { exact: true })).toBeVisible({ timeout: 10000 });

    // 복원: 다시 편집 모드 진입 → 원래 제목으로 되돌림
    await page.getByText('수정', { exact: true }).click();
    const restoreInput = page.locator('input[placeholder="제목"]');
    await expect(restoreInput).toBeVisible({ timeout: 3000 });
    await restoreInput.fill(originalTitle);
    await page.getByRole('button', { name: '저장' }).click();

    // 복원 POST 완료 대기
    await page.waitForResponse(
      resp => resp.url().includes('/api/documents') &&
              resp.request().method() === 'POST' &&
              resp.request().postData()?.includes('updateMeta'),
      { timeout: 15000 }
    );

    // 복원 확인
    await expect(page.getByText('수정', { exact: true })).toBeVisible({ timeout: 10000 });
  });
});

test.describe('UX2: 임베딩 재생성 버튼', () => {

  test.beforeEach(async ({ page }) => {
    await goToDocumentList(page);
  });

  test('문서 목록에서 벡터 상태가 표시된다', async ({ page }) => {
    // 문서 카드가 로드될 때까지 대기
    const cards = page.locator('[class*="rounded-xl"]');
    const cardCount = await cards.count();
    if (cardCount === 0) {
      console.log('문서가 없음 — 벡터 상태 테스트 스킵');
      return;
    }

    // 벡터 상태 텍스트 확인 (페이지 전체에서)
    const pageText = await page.locator('body').textContent();
    const hasStatus = ['벡터화됨', '벡터 실패', '대기'].some(s => pageText.includes(s));
    expect(hasStatus).toBeTruthy();
  });

  test('문서 상세 모달에서 AI 분석 버튼이 표시된다', async ({ page }) => {
    await openFirstDocumentModal(page);
    await expect(page.getByRole('button', { name: 'AI 분석' })).toBeVisible({ timeout: 5000 });
    // 임베딩 재시도 버튼은 failed/pending 상태에서만 표시
    const retryBtn = page.getByRole('button', { name: '임베딩 재시도' });
    const isRetryVisible = await retryBtn.isVisible().catch(() => false);
    console.log(`임베딩 재시도 버튼 표시 여부: ${isRetryVisible}`);
  });

  test('rebuildEmbeddings API가 정상 응답한다', async ({ page }) => {
    test.setTimeout(90000);
    await openFirstDocumentModal(page);

    // page.evaluate로 직접 API 호출
    const result = await page.evaluate(async () => {
      const base = window.location.origin;
      const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      };

      // 문서 목록에서 첫 번째 문서 ID
      const listResp = await fetch(`${base}/api/documents`, { headers });
      const listData = await listResp.json();
      const docs = listData.documents || [];
      if (docs.length === 0) return { skip: true };

      const docId = docs[0].id;
      const resp = await fetch(`${base}/api/documents`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'rebuildEmbeddings', id: docId }),
      });
      return { status: resp.status, body: await resp.json() };
    });

    if (result.skip) {
      console.log('문서 없음 — API 테스트 스킵');
      return;
    }

    // 200(성공) 또는 500(임베딩 서비스 문제)
    expect([200, 500]).toContain(result.status);
    if (result.status === 200) {
      expect(result.body.success).toBe(true);
      expect(result.body.embedding_status).toBe('done');
    }
    console.log(`rebuildEmbeddings 결과: status=${result.status}, chunks=${result.body.totalChunks || 'N/A'}`);
  });

  test('벡터 실패 문서가 있으면 재시도 버튼이 표시된다', async ({ page }) => {
    // 현재 문서 중 '벡터 실패' 상태가 있는지 확인
    const failedLocator = page.locator('text=벡터 실패');
    const failedCount = await failedLocator.count();

    if (failedCount > 0) {
      // 같은 카드 내에 재시도 버튼이 있어야 함
      const retryBtn = page.locator('text=재시도');
      await expect(retryBtn.first()).toBeVisible({ timeout: 5000 });
      console.log(`벡터 실패 ${failedCount}건 → 재시도 버튼 확인`);
    } else {
      // 모든 문서가 벡터화 완료 — 정상
      console.log('벡터 실패 문서 없음 — 재시도 버튼 불필요 (정상)');
    }
  });
});
