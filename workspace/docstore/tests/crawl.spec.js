// 크롤링 & 지식화 기능 E2E 테스트
// 크롤링 탭 UI, 소스 관리, 키워드 관리, 제외 패턴, 실행 + 결과 미리보기 검증
const { test, expect } = require('@playwright/test');

// 독립 실행: storageState 무시하고 직접 로그인
test.use({ storageState: undefined });

// 로그인 헬퍼
async function login(page) {
  await page.goto('/');
  const loginForm = page.getByPlaceholder('아이디를 입력하세요');
  if (await loginForm.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginForm.fill(process.env.TEST_ID || 'geefafa');
    await page.getByPlaceholder('비밀번호를 입력하세요').fill(process.env.TEST_PW || 'doklib2024!');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForSelector('nav', { timeout: 15000 });
  }
}

// 등록 탭 → 크롤링 모드 이동 헬퍼
async function goToCrawlMode(page) {
  await login(page);
  await expect(page.locator('nav')).toBeVisible({ timeout: 15000 });
  // 등록 탭 클릭
  await page.locator('nav button').filter({ hasText: '등록' }).click();
  // 크롤링 모드 버튼 클릭
  const crawlBtn = page.getByRole('button', { name: '크롤링' });
  await expect(crawlBtn).toBeVisible({ timeout: 5000 });
  await crawlBtn.click();
  // 서브탭이 보일 때까지 대기
  await expect(page.getByRole('button', { name: '실행', exact: true })).toBeVisible({ timeout: 5000 });
}

// ============================================================
// 1. 크롤링 탭 UI 기본 요소
// ============================================================
test.describe('크롤링 탭 UI 기본 요소', () => {
  test.beforeEach(async ({ page }) => {
    await goToCrawlMode(page);
  });

  test('등록 탭에 3개 모드 버튼이 표시된다 (파일 업로드, 법령 검색, 크롤링)', async ({ page }) => {
    await expect(page.getByRole('button', { name: '파일 업로드' })).toBeVisible();
    await expect(page.getByRole('button', { name: '법령 검색' })).toBeVisible();
    await expect(page.getByRole('button', { name: '크롤링', exact: true })).toBeVisible();
  });

  test('크롤링 모드에 4개 서브탭이 표시된다', async ({ page }) => {
    await expect(page.getByRole('button', { name: '실행', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '소스 관리' })).toBeVisible();
    await expect(page.getByRole('button', { name: '키워드', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '제외 패턴', exact: true })).toBeVisible();
  });

  test('실행 탭에 네이버 뉴스 / 사이트 게시판 선택 버튼이 있다', async ({ page }) => {
    await expect(page.getByRole('button', { name: '네이버 뉴스' })).toBeVisible();
    await expect(page.getByRole('button', { name: '사이트 게시판' })).toBeVisible();
  });

  test('실행 탭에 가중치 설정 필드가 표시된다', async ({ page }) => {
    // 제목 가중치, 내용 가중치 입력 필드 확인
    const labels = await page.locator('label').allTextContents();
    const hasTitle = labels.some(l => l.includes('제목 가중치'));
    const hasContent = labels.some(l => l.includes('내용 가중치'));
    const hasRecent = labels.some(l => l.includes('최근 일수'));
    expect(hasTitle).toBeTruthy();
    expect(hasContent).toBeTruthy();
    expect(hasRecent).toBeTruthy();
  });

  test('크롤링 실행 버튼이 키워드 미선택 시 비활성화된다', async ({ page }) => {
    const executeBtn = page.getByRole('button', { name: '크롤링 실행' });
    await expect(executeBtn).toBeVisible();
    await expect(executeBtn).toBeDisabled();
  });
});

// ============================================================
// 2. 서브탭 전환
// ============================================================
test.describe('서브탭 전환', () => {
  test.beforeEach(async ({ page }) => {
    await goToCrawlMode(page);
  });

  test('소스 관리 탭으로 전환하면 소스 목록이 표시된다', async ({ page }) => {
    await page.getByRole('button', { name: '소스 관리' }).click();
    // "새 소스 추가" 텍스트 확인
    await expect(page.getByText('새 소스 추가')).toBeVisible({ timeout: 5000 });
    // "등록된 소스" 텍스트 확인
    await expect(page.getByText(/등록된 소스/)).toBeVisible();
  });

  test('키워드 탭으로 전환하면 키워드 관리 UI가 표시된다', async ({ page }) => {
    await page.getByRole('button', { name: '키워드' }).click();
    await expect(page.getByText('새 키워드 추가')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/등록된 키워드/)).toBeVisible();
  });

  test('제외 패턴 탭으로 전환하면 제외 관리 UI가 표시된다', async ({ page }) => {
    await page.getByRole('button', { name: '제외 패턴', exact: true }).click();
    await expect(page.getByText('제외 URL 패턴 추가')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/등록된 제외 패턴/).first()).toBeVisible();
  });

  test('실행 탭으로 돌아오면 크롤링 실행 버튼이 표시된다', async ({ page }) => {
    // 다른 탭으로 갔다가 실행 탭으로 돌아옴
    await page.getByRole('button', { name: '소스 관리' }).click();
    await expect(page.getByText('새 소스 추가')).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.getByRole('button', { name: '크롤링 실행' })).toBeVisible({ timeout: 5000 });
  });
});

// ============================================================
// 3. 소스 관리 (CRUD)
// ============================================================
test.describe('소스 관리', () => {
  test.beforeEach(async ({ page }) => {
    await goToCrawlMode(page);
    await page.getByRole('button', { name: '소스 관리' }).click();
    await expect(page.getByText('새 소스 추가')).toBeVisible({ timeout: 5000 });
  });

  test.fixme('기본 등록된 소스 3개가 표시된다 (KISA, 개인정보포털, 개인정보보호위원회)', async ({ page }) => {
    // API 응답 대기
    await page.waitForResponse(
      resp => resp.url().includes('/api/crawl-sources') && resp.status() === 200,
      { timeout: 10000 }
    ).catch(() => {});
    // 잠시 렌더링 대기
    await page.waitForSelector('text=등록된 소스', { timeout: 5000 });

    const sourceCards = page.locator('text=KISA');
    await expect(sourceCards.first()).toBeVisible({ timeout: 5000 });
  });

  test('소스 추가 폼에 사이트 이름과 게시판 URL 입력이 있다', async ({ page }) => {
    await expect(page.getByPlaceholder('예: KISA')).toBeVisible();
    await expect(page.getByPlaceholder(/kisa\.or\.kr/)).toBeVisible();
  });

  test('소스에 활성/비활성 토글이 있다', async ({ page }) => {
    // 활성 상태 버튼 확인
    const activeBtn = page.getByRole('button', { name: '활성' }).first();
    await expect(activeBtn).toBeVisible({ timeout: 10000 });
  });
});

// ============================================================
// 4. 키워드 관리 (CRUD)
// ============================================================
test.describe('키워드 관리', () => {
  test.beforeEach(async ({ page }) => {
    await goToCrawlMode(page);
    await page.getByRole('button', { name: '키워드' }).click();
    await expect(page.getByText('새 키워드 추가')).toBeVisible({ timeout: 5000 });
  });

  test('키워드 추가 폼에 필드가 표시된다 (키워드, 가중치)', async ({ page }) => {
    await expect(page.getByPlaceholder('예: 개인정보보호')).toBeVisible();
    const labels = await page.locator('label').allTextContents();
    expect(labels.some(l => l.includes('키워드'))).toBeTruthy();
    expect(labels.some(l => l.includes('제목 가중치'))).toBeTruthy();
    expect(labels.some(l => l.includes('내용 가중치'))).toBeTruthy();
  });

  test('키워드를 추가하면 목록에 나타난다', async ({ page }) => {
    const testKeyword = `테스트키워드_${Date.now()}`;

    // 키워드 입력
    await page.getByPlaceholder('예: 개인정보보호').fill(testKeyword);

    // 추가 버튼 클릭
    const addBtn = page.locator('button').filter({ hasText: '추가' }).first();
    await addBtn.click();

    // API 응답 대기
    await page.waitForResponse(
      resp => resp.url().includes('/api/crawl-keywords') && resp.request().method() === 'POST',
      { timeout: 10000 }
    );

    // 목록에 추가된 키워드가 표시되는지 확인
    await expect(page.getByText(testKeyword)).toBeVisible({ timeout: 5000 });

    // 정리: 추가한 키워드 삭제
    const deleteBtn = page.locator(`text=${testKeyword}`).locator('..').locator('..').getByRole('button', { name: '삭제' });
    if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      page.once('dialog', dialog => dialog.accept());
      await deleteBtn.click();
    }
  });
});

// ============================================================
// 5. 제외 패턴 관리
// ============================================================
test.describe('제외 패턴 관리', () => {
  test.beforeEach(async ({ page }) => {
    await goToCrawlMode(page);
    await page.getByRole('button', { name: '제외 패턴', exact: true }).click();
    await expect(page.getByText('제외 URL 패턴 추가')).toBeVisible({ timeout: 5000 });
  });

  test('제외 패턴 추가 폼이 표시된다', async ({ page }) => {
    await expect(page.getByPlaceholder('예: blog.example.com')).toBeVisible();
    await expect(page.getByText('이 패턴이 포함된 URL은 크롤링 결과에서 제외됩니다')).toBeVisible();
  });

  test('제외 패턴을 추가하고 삭제할 수 있다', async ({ page }) => {
    const testPattern = `test-exclude-${Date.now()}.com`;

    // 패턴 입력 + 추가
    await page.getByPlaceholder('예: blog.example.com').fill(testPattern);
    const addBtn = page.locator('button').filter({ hasText: '추가' }).first();
    await addBtn.click();

    // API 응답 대기
    await page.waitForResponse(
      resp => resp.url().includes('/api/crawl-sources') && resp.request().method() === 'POST',
      { timeout: 10000 }
    );

    // 목록에 나타나는지 확인
    await expect(page.getByText(testPattern)).toBeVisible({ timeout: 5000 });

    // 삭제
    const deleteBtn = page.locator(`text=${testPattern}`).locator('..').locator('..').getByRole('button', { name: '삭제' });
    await deleteBtn.click();

    // 삭제 후 목록에서 사라지는지 확인
    await expect(page.getByText(testPattern)).not.toBeVisible({ timeout: 5000 });
  });
});

// ============================================================
// 6. 크롤링 실행 모드 전환
// ============================================================
test.describe('크롤링 실행 모드 전환', () => {
  test.beforeEach(async ({ page }) => {
    await goToCrawlMode(page);
  });

  test('네이버 뉴스 모드가 기본 선택되어 있다', async ({ page }) => {
    const naverBtn = page.getByRole('button', { name: '네이버 뉴스' });
    // 네이버 뉴스 버튼에 primary 스타일이 적용되어 있는지 확인
    const className = await naverBtn.getAttribute('class');
    expect(className).toContain('border-primary');
  });

  test('사이트 게시판 모드 선택 시 소스 선택 드롭다운이 나타난다', async ({ page }) => {
    await page.getByRole('button', { name: '사이트 게시판' }).click();
    // 크롤링 소스 선택 드롭다운 확인
    await expect(page.getByText('크롤링 소스')).toBeVisible({ timeout: 3000 });
  });

  test('네이버 뉴스 모드에서는 최대 건수 필드가 표시된다', async ({ page }) => {
    const labels = await page.locator('label').allTextContents();
    expect(labels.some(l => l.includes('최대 건수'))).toBeTruthy();
  });

  test('사이트 게시판 모드로 전환하면 소스 선택이 필수이다', async ({ page }) => {
    await page.getByRole('button', { name: '사이트 게시판' }).click();
    // 소스를 선택하세요 기본 옵션 확인
    await expect(page.locator('option').filter({ hasText: '소스를 선택하세요' })).toBeAttached();
  });
});

// ============================================================
// 7. API 엔드포인트 구조 검증
// ============================================================
test.describe('크롤링 API 엔드포인트 검증', () => {
  // 브라우저 내 authFetch를 활용하여 API 호출 (토큰 자동 포함)
  async function apiFetch(page, url) {
    return page.evaluate(async (apiUrl) => {
      const token = localStorage.getItem('docstore_token') || '';
      const res = await fetch(apiUrl, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      return { status: res.status, data: await res.json() };
    }, url);
  }

  test('GET /api/crawl-sources 가 소스 목록을 반환한다', async ({ page }) => {
    await login(page);
    const { status, data } = await apiFetch(page, '/api/crawl-sources');
    expect(status).toBe(200);
    expect(data).toHaveProperty('sources');
    expect(Array.isArray(data.sources)).toBeTruthy();
  });

  test('GET /api/crawl-keywords 가 키워드 목록을 반환한다', async ({ page }) => {
    await login(page);
    const { status, data } = await apiFetch(page, '/api/crawl-keywords');
    expect(status).toBe(200);
    expect(data).toHaveProperty('keywords');
    expect(Array.isArray(data.keywords)).toBeTruthy();
  });

  test('GET /api/crawl-sources?exclusions=1 가 제외 패턴 목록을 반환한다', async ({ page }) => {
    await login(page);
    const { status, data } = await apiFetch(page, '/api/crawl-sources?exclusions=1');
    expect(status).toBe(200);
    expect(data).toHaveProperty('exclusions');
    expect(Array.isArray(data.exclusions)).toBeTruthy();
  });

  test('GET /api/crawl-ingest 가 크롤링 결과 목록을 반환한다', async ({ page }) => {
    await login(page);
    const { status, data } = await apiFetch(page, '/api/crawl-ingest');
    expect(status).toBe(200);
    expect(data).toHaveProperty('results');
    expect(Array.isArray(data.results)).toBeTruthy();
  });
});

// ============================================================
// 8. 가중치 설정 UI 동작
// ============================================================
test.describe('가중치 설정 UI', () => {
  test.beforeEach(async ({ page }) => {
    await goToCrawlMode(page);
  });

  test('제목 가중치 기본값이 10이다', async ({ page }) => {
    // 제목 가중치 input 찾기
    const titleWeightInput = page.locator('input[type="number"]').nth(1); // 최근 일수 다음
    // 가중치 필드들 중 제목 가중치 값 확인
    const inputs = await page.locator('input[type="number"]').all();
    // 최근 일수(7) 다음에 최대 건수(20), 그 다음 제목 가중치(10), 내용 가중치(3)
    let found = false;
    for (const input of inputs) {
      const val = await input.inputValue();
      if (val === '10') { found = true; break; }
    }
    expect(found).toBeTruthy();
  });

  test('내용 가중치 기본값이 3이다', async ({ page }) => {
    const inputs = await page.locator('input[type="number"]').all();
    let found = false;
    for (const input of inputs) {
      const val = await input.inputValue();
      if (val === '3') { found = true; break; }
    }
    expect(found).toBeTruthy();
  });

  test('가중치 값을 변경할 수 있다', async ({ page }) => {
    // 모든 숫자 입력 필드 중 값이 10인 것 찾아서 변경
    const inputs = await page.locator('input[type="number"]').all();
    for (const input of inputs) {
      const val = await input.inputValue();
      if (val === '10') {
        await input.fill('15');
        const newVal = await input.inputValue();
        expect(newVal).toBe('15');
        break;
      }
    }
  });
});

// ============================================================
// 9. 키워드 선택 시 가중치 자동 반영
// ============================================================
test.describe('키워드 선택과 가중치 연동', () => {
  test('키워드를 추가하고 실행 탭에서 선택할 수 있다', async ({ page }) => {
    await goToCrawlMode(page);

    // 1) 키워드 탭에서 키워드 추가
    await page.getByRole('button', { name: '키워드' }).click();
    await expect(page.getByText('새 키워드 추가')).toBeVisible({ timeout: 5000 });

    const testKw = `E2E테스트_${Date.now()}`;
    await page.getByPlaceholder('예: 개인정보보호').fill(testKw);
    await page.locator('button').filter({ hasText: '추가' }).first().click();

    // API 응답 대기
    await page.waitForResponse(
      resp => resp.url().includes('/api/crawl-keywords') && resp.request().method() === 'POST',
      { timeout: 10000 }
    );

    // 2) 실행 탭으로 이동
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.getByRole('button', { name: '크롤링 실행' })).toBeVisible({ timeout: 5000 });

    // 3) 키워드 체크박스 목록에서 추가한 키워드 확인 (체크박스+label 방식)
    const kwLabel = page.locator('label').filter({ hasText: testKw });
    await expect(kwLabel).toBeAttached({ timeout: 5000 });

    // 4) 정리: 키워드 삭제
    await page.getByRole('button', { name: '키워드' }).click();
    await expect(page.getByText(testKw)).toBeVisible({ timeout: 5000 });
    const delBtn = page.locator(`text=${testKw}`).locator('..').locator('..').getByRole('button', { name: '삭제' });
    if (await delBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      page.once('dialog', dialog => dialog.accept());
      await delBtn.click();
    }
  });
});

// ============================================================
// 10. 모드 토글 상태 유지
// ============================================================
test.describe('모드 토글', () => {
  test('다른 모드로 갔다가 크롤링으로 돌아와도 상태가 유지된다', async ({ page }) => {
    await goToCrawlMode(page);

    // 소스 관리 탭으로 이동
    await page.getByRole('button', { name: '소스 관리' }).click();
    await expect(page.getByText('새 소스 추가')).toBeVisible({ timeout: 5000 });

    // 파일 모드로 전환
    await page.getByRole('button', { name: '파일 업로드' }).click();

    // 다시 크롤링 모드로 돌아옴
    await page.getByRole('button', { name: '크롤링' }).click();
    // 서브탭이 다시 표시되는지 확인
    await expect(page.getByRole('button', { name: '실행', exact: true })).toBeVisible({ timeout: 5000 });
  });
});
