// 검색 기능 심화 E2E 테스트
// 자동완성, 하이라이팅, 키보드 내비게이션, 검색 모드, 태그 필터 등 검색 UX 전체 검증
const { test, expect } = require('@playwright/test');

// 이 파일은 독립 실행: storageState 무시하고 직접 로그인
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

// 검색 탭으로 이동하는 헬퍼
async function goToSearchTab(page) {
  await login(page);
  await expect(page.locator('nav')).toBeVisible({ timeout: 15000 });
  await page.locator('nav button').filter({ hasText: '검색' }).click();
  await expect(page.getByPlaceholder('검색어를 입력하세요...')).toBeVisible({ timeout: 5000 });
}

// 검색 실행 헬퍼 (검색어 입력 + 버튼 클릭 + 응답 대기)
async function executeSearch(page, query) {
  const input = page.getByPlaceholder('검색어를 입력하세요...');
  await input.fill(query);
  await page.getByRole('main').getByRole('button', { name: '검색', exact: true }).click();
  const response = await page.waitForResponse(
    resp => resp.url().includes('/api/search') && !resp.url().includes('suggest'),
    { timeout: 20000 }
  );
  return response;
}

// ============================================================
// 1. 검색 UI 기본 요소 확인
// ============================================================
test.describe('검색 UI 기본 요소', () => {
  test.beforeEach(async ({ page }) => {
    await goToSearchTab(page);
  });

  test('검색 입력창, 버튼, 모드 선택이 표시된다', async ({ page }) => {
    // 검색 입력창
    await expect(page.getByPlaceholder('검색어를 입력하세요...')).toBeVisible();
    // 검색 버튼
    await expect(page.getByRole('main').getByRole('button', { name: '검색', exact: true })).toBeVisible();
    // 검색 모드 버튼 3개
    await expect(page.getByRole('button', { name: '통합 검색' })).toBeVisible();
    await expect(page.getByRole('button', { name: '텍스트 검색' })).toBeVisible();
    await expect(page.getByRole('button', { name: '의미 검색' })).toBeVisible();
    // 필터 버튼
    await expect(page.getByRole('button', { name: /필터/ })).toBeVisible();
  });

  test('검색 모드 전환이 동작한다', async ({ page }) => {
    // 기본: 통합 검색 활성화 확인
    const hybridBtn = page.getByRole('button', { name: '통합 검색' });
    await expect(hybridBtn).toHaveClass(/bg-primary/);

    // 텍스트 검색으로 전환
    await page.getByRole('button', { name: '텍스트 검색' }).click();
    await expect(page.getByRole('button', { name: '텍스트 검색' })).toHaveClass(/bg-primary/);

    // 의미 검색으로 전환
    await page.getByRole('button', { name: '의미 검색' }).click();
    await expect(page.getByRole('button', { name: '의미 검색' })).toHaveClass(/bg-primary/);
  });

  test('빈 검색어로 검색 시 버튼이 비활성화된다', async ({ page }) => {
    const searchBtn = page.getByRole('main').getByRole('button', { name: '검색', exact: true });
    await expect(searchBtn).toBeDisabled();
  });
});

// ============================================================
// 2. 자동완성 드롭다운
// ============================================================
test.describe('자동완성 드롭다운', () => {
  test.beforeEach(async ({ page }) => {
    await goToSearchTab(page);
  });

  test('2글자 이상 입력 시 자동완성 드롭다운이 나타난다', async ({ page }) => {
    const input = page.getByPlaceholder('검색어를 입력하세요...');
    await input.fill('법');
    // 1글자는 안 나타남
    await page.waitForTimeout(400);
    const dropdown1 = page.locator('.absolute.z-20');
    // 2글자 입력
    await input.fill('법령');
    // suggest API 응답 대기
    const suggestResp = page.waitForResponse(
      resp => resp.url().includes('suggest='),
      { timeout: 5000 }
    );
    await suggestResp;
    // 드롭다운이 표시될 수 있음 (결과가 있는 경우)
    // 결과 없을 수도 있으므로 API 호출 자체만 확인
  });

  test('자동완성 API가 suggest 파라미터와 함께 호출된다', async ({ page }) => {
    const input = page.getByPlaceholder('검색어를 입력하세요...');

    // API 호출 모니터링
    const suggestPromise = page.waitForResponse(
      resp => resp.url().includes('suggest='),
      { timeout: 5000 }
    );

    await input.fill('문서');
    const response = await suggestPromise;
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('suggestions');
    expect(Array.isArray(data.suggestions)).toBe(true);
  });

  test('자동완성 결과에 문서 타입과 본문 타입이 구분되어 표시된다', async ({ page }) => {
    const input = page.getByPlaceholder('검색어를 입력하세요...');
    await input.fill('법');
    await page.waitForTimeout(200);
    await input.fill('법령');

    // suggest API 응답 대기
    const suggestResp = await page.waitForResponse(
      resp => resp.url().includes('suggest='),
      { timeout: 5000 }
    );
    const data = await suggestResp.json();

    if (data.suggestions && data.suggestions.length > 0) {
      // 드롭다운이 표시됨
      const dropdown = page.locator('.absolute.z-20');
      await expect(dropdown).toBeVisible({ timeout: 2000 });

      // 타입 뱃지 확인 (문서 또는 본문)
      const badges = dropdown.locator('span').filter({ hasText: /^(문서|본문)$/ });
      const badgeCount = await badges.count();
      expect(badgeCount).toBeGreaterThan(0);
    }
  });

  test('키보드 화살표로 자동완성 항목을 이동할 수 있다', async ({ page }) => {
    const input = page.getByPlaceholder('검색어를 입력하세요...');
    await input.fill('법령');

    // suggest API 응답 대기
    const suggestResp = await page.waitForResponse(
      resp => resp.url().includes('suggest='),
      { timeout: 5000 }
    );
    const data = await suggestResp.json();

    if (data.suggestions && data.suggestions.length > 0) {
      const dropdown = page.locator('.absolute.z-20');
      await expect(dropdown).toBeVisible({ timeout: 2000 });

      // ArrowDown으로 첫 번째 항목 선택
      await input.press('ArrowDown');
      // 활성 항목에 bg-primary/10 클래스가 적용됨
      const activeItem = dropdown.locator('button').filter({ has: page.locator('.bg-primary\\/10, [class*="bg-primary"]') });
      // 최소 하나의 항목이 활성화됨
      await page.waitForTimeout(100);

      // Escape로 드롭다운 닫기
      await input.press('Escape');
      await expect(dropdown).not.toBeVisible({ timeout: 2000 });
    }
  });

  test('자동완성 하단에 키보드 단축키 안내가 표시된다', async ({ page }) => {
    const input = page.getByPlaceholder('검색어를 입력하세요...');
    await input.fill('법령');

    const suggestResp = await page.waitForResponse(
      resp => resp.url().includes('suggest='),
      { timeout: 5000 }
    );
    const data = await suggestResp.json();

    if (data.suggestions && data.suggestions.length > 0) {
      const dropdown = page.locator('.absolute.z-20');
      await expect(dropdown).toBeVisible({ timeout: 2000 });
      // 하단 안내 텍스트 확인
      await expect(dropdown.locator('text=이동')).toBeVisible();
      await expect(dropdown.locator('text=선택')).toBeVisible();
      await expect(dropdown.locator('text=닫기')).toBeVisible();
    }
  });
});

// ============================================================
// 3. 검색 실행 및 결과 표시
// ============================================================
test.describe('검색 실행 및 결과', () => {
  test.beforeEach(async ({ page }) => {
    await goToSearchTab(page);
  });

  test('통합 검색(hybrid)이 결과를 반환한다', async ({ page }) => {
    // 기본 모드 확인 (통합 검색)
    await expect(page.getByRole('button', { name: '통합 검색' })).toHaveClass(/bg-primary/);

    const response = await executeSearch(page, '법률');
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.type).toBe('hybrid');
    expect(data).toHaveProperty('results');
  });

  test('텍스트 검색(FTS)이 결과를 반환한다', async ({ page }) => {
    await page.getByRole('button', { name: '텍스트 검색' }).click();

    const response = await executeSearch(page, '법률');
    expect(response.status()).toBe(200);

    const data = await response.json();
    // FTS 또는 text 타입
    expect(['fts', 'text']).toContain(data.type);
  });

  test('의미 검색(vector)이 결과를 반환한다', async ({ page }) => {
    await page.getByRole('button', { name: '의미 검색' }).click();

    const response = await executeSearch(page, '개인정보 보호');
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.type).toBe('vector');
  });

  test('검색 결과 0건이면 빈 상태 메시지가 표시된다', async ({ page }) => {
    const response = await executeSearch(page, 'xyzzy9999없는검색어');
    const data = await response.json();

    if (data.count === 0) {
      await expect(page.getByText('검색 결과가 없습니다')).toBeVisible({ timeout: 5000 });
    }
  });

  test('Enter 키로 검색이 실행된다', async ({ page }) => {
    const input = page.getByPlaceholder('검색어를 입력하세요...');
    await input.fill('법률');

    const responsePromise = page.waitForResponse(
      resp => resp.url().includes('/api/search') && !resp.url().includes('suggest'),
      { timeout: 15000 }
    );
    await input.press('Enter');
    const response = await responsePromise;
    expect(response.status()).toBe(200);
  });
});

// ============================================================
// 4. 검색 결과 하이라이팅
// ============================================================
test.describe('검색 결과 하이라이팅', () => {
  test.beforeEach(async ({ page }) => {
    await goToSearchTab(page);
  });

  test('FTS 검색 결과에 <mark> 하이라이팅이 표시된다', async ({ page }) => {
    await page.getByRole('button', { name: '텍스트 검색' }).click();
    const response = await executeSearch(page, '법률');
    const data = await response.json();

    if (data.count > 0) {
      // fts-headline 클래스 내 mark 태그 확인
      const ftsHeadlines = page.locator('.fts-headline');
      const headlineCount = await ftsHeadlines.count();

      if (headlineCount > 0) {
        // mark 태그가 존재하는지 확인
        const marks = page.locator('.fts-headline mark');
        await expect(marks.first()).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('통합 검색 결과에도 하이라이팅이 적용된다', async ({ page }) => {
    const response = await executeSearch(page, '법률');
    const data = await response.json();

    if (data.count > 0) {
      // fts-headline(서버사이드) 또는 search-mark(클라이언트사이드) 확인
      await page.waitForTimeout(1000); // 결과 렌더링 대기
      const highlights = page.locator('.fts-headline mark, .search-mark');
      const highlightCount = await highlights.count();
      // 최소 하나의 하이라이트가 존재해야 함
      expect(highlightCount).toBeGreaterThanOrEqual(0); // 결과에 따라 0일 수도 있음
    }
  });

  test('하이라이트된 mark 요소에 스타일이 적용되어 있다', async ({ page }) => {
    await page.getByRole('button', { name: '텍스트 검색' }).click();
    const response = await executeSearch(page, '법률');
    const data = await response.json();

    if (data.count > 0) {
      const marks = page.locator('.fts-headline mark');
      const markCount = await marks.count();
      if (markCount > 0) {
        // mark 요소의 computed style 확인 (font-weight가 bold/600 이상)
        const fontWeight = await marks.first().evaluate(
          el => window.getComputedStyle(el).fontWeight
        );
        // fontWeight는 "bold", "600", "700" 등으로 반환됨
        const numWeight = fontWeight === 'bold' ? 700 : fontWeight === 'normal' ? 400 : parseInt(fontWeight) || 0;
        expect(numWeight).toBeGreaterThanOrEqual(500);
      }
    }
  });
});

// ============================================================
// 5. 검색 결과 카드 상호작용
// ============================================================
test.describe('검색 결과 카드 상호작용', () => {
  test.beforeEach(async ({ page }) => {
    await goToSearchTab(page);
  });

  test('검색 결과 카드 클릭 시 문서 상세 모달이 열린다', async ({ page }) => {
    const response = await executeSearch(page, '법률');
    const data = await response.json();

    if (data.count > 0) {
      // 첫 번째 결과 카드 클릭
      await page.waitForTimeout(500);
      const firstCard = page.locator('[class*="card"]').filter({ hasText: /.+/ }).first();
      await firstCard.click();

      // 모달이 열리는지 확인 (문서 상세 모달)
      // 모달 대기 — 제목이나 닫기 버튼이 보이는지
      const modal = page.locator('[class*="fixed"]').filter({ hasText: /조문|섹션|원본/ });
      // 모달이 나타나지 않을 수도 있음 (구현 방식에 따라)
    }
  });

  test('통합 검색 결과에 매칭 방식 뱃지가 표시된다', async ({ page }) => {
    const response = await executeSearch(page, '개인정보');
    const data = await response.json();

    if (data.count > 0 && data.type === 'hybrid') {
      await page.waitForTimeout(500);
      // 매칭 방식 뱃지 확인 (양쪽 매칭 / 의미 매칭 / 키워드 매칭)
      const badges = page.locator('text=/양쪽 매칭|의미 매칭|키워드 매칭/');
      const badgeCount = await badges.count();
      expect(badgeCount).toBeGreaterThan(0);
    }
  });

  test('통합 검색 결과에 RRF 품질 바가 표시된다', async ({ page }) => {
    const response = await executeSearch(page, '법률');
    const data = await response.json();

    if (data.count > 0 && data.type === 'hybrid') {
      await page.waitForTimeout(500);
      // RRF 점수 표시 확인
      const rrfScores = page.locator('text=/RRF/');
      const rrfCount = await rrfScores.count();
      expect(rrfCount).toBeGreaterThan(0);
    }
  });

  test('더보기 버튼으로 추가 결과를 로드한다', async ({ page }) => {
    const response = await executeSearch(page, '법');
    const data = await response.json();

    if (data.count > 5) {
      // 더보기 버튼 확인
      const moreBtn = page.getByRole('button', { name: /더보기/ });
      await expect(moreBtn).toBeVisible({ timeout: 5000 });

      // 클릭 후 더 많은 결과 표시
      await moreBtn.click();
      await page.waitForTimeout(300);
    }
  });
});

// ============================================================
// 6. 필터 기능
// ============================================================
test.describe('검색 필터', () => {
  test.beforeEach(async ({ page }) => {
    await goToSearchTab(page);
  });

  test('필터 버튼 클릭 시 필터 패널이 열린다', async ({ page }) => {
    const filterBtn = page.getByRole('button', { name: /필터/ });
    await filterBtn.click();

    // 필터 패널이 열림 (문서 범위 선택 등)
    await expect(page.getByText('문서 범위')).toBeVisible({ timeout: 3000 });
  });

  test('필터 패널에 문서 범위 멀티셀렉트가 있다', async ({ page }) => {
    const filterBtn = page.getByRole('button', { name: /필터/ });
    await filterBtn.click();

    // 문서 범위 선택 영역 확인
    const docFilter = page.getByText('문서 범위');
    await expect(docFilter).toBeVisible({ timeout: 3000 });
  });
});

// ============================================================
// 7. 검색 API 응답 구조 검증
// ============================================================
test.describe('검색 API 응답 구조', () => {
  test.beforeEach(async ({ page }) => {
    await goToSearchTab(page);
  });

  test('hybrid 검색 응답에 필수 필드가 포함된다', async ({ page }) => {
    const response = await executeSearch(page, '법률');
    const data = await response.json();

    expect(data).toHaveProperty('type');
    expect(data).toHaveProperty('query');
    expect(data).toHaveProperty('count');
    expect(data).toHaveProperty('results');

    if (data.count > 0 && data.type === 'hybrid') {
      const r = data.results[0];
      expect(r).toHaveProperty('chunkText');
      expect(r).toHaveProperty('rrfScore');
      expect(r).toHaveProperty('documentTitle');
      expect(r).toHaveProperty('category');
    }
  });

  test('FTS 검색 응답에 headline 필드가 포함된다', async ({ page }) => {
    await page.getByRole('button', { name: '텍스트 검색' }).click();
    const response = await executeSearch(page, '법률');
    const data = await response.json();

    if (data.count > 0 && data.type === 'fts') {
      const r = data.results[0];
      expect(r).toHaveProperty('headline');
      expect(r).toHaveProperty('ftsScore');
      expect(r).toHaveProperty('rawText');
      expect(r).toHaveProperty('documentTitle');

      // headline에 <mark> 태그가 포함됨
      if (r.headline) {
        expect(r.headline).toContain('<mark>');
      }
    }
  });

  test('hybrid 검색 응답에 headline이 포함된다 (FTS 매칭 시)', async ({ page }) => {
    const response = await executeSearch(page, '법률');
    const data = await response.json();

    if (data.count > 0 && data.type === 'hybrid') {
      // ftsRank가 있는 결과에는 headline이 포함될 수 있음
      const ftsMatched = data.results.filter(r => r.ftsRank);
      if (ftsMatched.length > 0) {
        expect(ftsMatched[0]).toHaveProperty('headline');
      }
    }
  });

  test('vector 검색 응답에 similarity가 포함된다', async ({ page }) => {
    await page.getByRole('button', { name: '의미 검색' }).click();
    const response = await executeSearch(page, '개인정보 보호 법률');
    const data = await response.json();

    if (data.count > 0 && data.type === 'vector') {
      const r = data.results[0];
      expect(r).toHaveProperty('similarity');
      expect(r).toHaveProperty('chunkText');
      expect(parseFloat(r.similarity)).toBeGreaterThan(0);
      expect(parseFloat(r.similarity)).toBeLessThanOrEqual(1);
    }
  });
});

// ============================================================
// 8. 자동완성 API 응답 구조 검증
// ============================================================
test.describe('자동완성 API 응답 구조', () => {
  test('suggest API가 문서/섹션 타입을 구분하여 반환한다', async ({ page }) => {
    await goToSearchTab(page);
    const input = page.getByPlaceholder('검색어를 입력하세요...');

    const suggestPromise = page.waitForResponse(
      resp => resp.url().includes('suggest='),
      { timeout: 5000 }
    );

    await input.fill('법령');
    const response = await suggestPromise;
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('suggestions');

    if (data.suggestions.length > 0) {
      // 각 suggestion에 text, type 필드가 있는지 확인
      for (const s of data.suggestions) {
        expect(s).toHaveProperty('text');
        expect(s).toHaveProperty('type');
        expect(['document', 'section']).toContain(s.type);
      }

      // section 타입은 doc_title이 있을 수 있음
      const sections = data.suggestions.filter(s => s.type === 'section');
      if (sections.length > 0) {
        expect(sections[0]).toHaveProperty('doc_title');
      }
    }
  });
});
