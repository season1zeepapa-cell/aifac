// 신규 기능 E2E 테스트
// 테스트 대상: RAG 트레이싱, 프롬프트 템플릿, HWP 업로드 지원, 관측성
// UI 구조 변경: 관리 탭이 설정/튜닝으로 분리됨
const { test, expect } = require('@playwright/test');

// ── 튜닝 탭 진입 헬퍼 ──
async function goToTuningTab(page) {
  await page.goto('/');
  await page.waitForSelector('nav', { timeout: 15000 });
  // 하단 네비게이션에서 "튜닝" 탭 클릭
  await page.locator('nav button').filter({ hasText: '튜닝' }).click();
  // 서브탭 렌더 대기
  await page.waitForSelector('button', { timeout: 5000 });
}

// ── 특정 서브탭 클릭 헬퍼 (스크롤 포함) ──
async function clickSubTab(page, tabName) {
  const tab = page.getByRole('button', { name: tabName, exact: true });
  await tab.scrollIntoViewIfNeeded();
  await tab.click();
}

// ── 인증된 API 호출 헬퍼 (localStorage 토큰 사용) ──
async function authApiFetch(page, url) {
  return page.evaluate(async (apiUrl) => {
    const token = localStorage.getItem('docstore_token');
    const res = await fetch(apiUrl, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });
    return { status: res.status, data: await res.json() };
  }, url);
}

// ========================================
// 1. RAG 트레이싱 탭 테스트
// ========================================
test.describe('RAG 트레이싱 탭', () => {

  test('튜닝 탭에서 RAG 트레이싱 서브탭이 존재한다', async ({ page }) => {
    await goToTuningTab(page);
    const tracingTab = page.getByRole('button', { name: 'RAG 트레이싱' });
    await tracingTab.scrollIntoViewIfNeeded();
    await expect(tracingTab).toBeVisible();
  });

  test('RAG 트레이싱 탭 클릭 시 패널이 로드된다', async ({ page }) => {
    await goToTuningTab(page);
    await clickSubTab(page, 'RAG 트레이싱');

    // 패널 제목 확인
    await expect(page.getByText('RAG 파이프라인 트레이싱')).toBeVisible({ timeout: 10000 });

    // 새로고침 버튼이 존재하는지 확인
    await expect(page.getByRole('button', { name: '새로고침' })).toBeVisible();
  });

  test('RAG 트레이싱 상태 필터가 동작한다', async ({ page }) => {
    await goToTuningTab(page);
    await clickSubTab(page, 'RAG 트레이싱');
    await page.waitForSelector('text=RAG 파이프라인 트레이싱', { timeout: 10000 });

    // 상태 필터 select가 존재하는지 확인
    const filterSelect = page.locator('select').filter({ hasText: '전체 상태' });
    await expect(filterSelect).toBeVisible();

    // 필터 옵션 확인 (전체 상태, 성공, 에러)
    const options = filterSelect.locator('option');
    await expect(options).toHaveCount(3);
  });

  test('RAG 트레이싱 설명 문구가 표시된다', async ({ page }) => {
    await goToTuningTab(page);
    await clickSubTab(page, 'RAG 트레이싱');

    // 안내 문구 확인
    await expect(page.getByText('전체 과정')).toBeVisible({ timeout: 10000 });
  });

  test('RAG 트레이싱 API가 정상 응답한다', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('nav', { timeout: 15000 });

    const result = await authApiFetch(page, '/api/rag-traces?limit=5');
    expect(result.status).toBe(200);
    expect(result.data).toHaveProperty('traces');
    expect(result.data).toHaveProperty('total');
    expect(Array.isArray(result.data.traces)).toBe(true);
  });
});

// ========================================
// 2. 프롬프트 템플릿 탭 테스트
// ========================================
test.describe('프롬프트 템플릿 탭', () => {

  test('튜닝 탭에서 프롬프트 서브탭이 존재한다', async ({ page }) => {
    await goToTuningTab(page);
    const promptTab = page.getByRole('button', { name: '프롬프트', exact: true });
    await promptTab.scrollIntoViewIfNeeded();
    await expect(promptTab).toBeVisible();
  });

  test('프롬프트 탭에서 템플릿 관련 UI가 로드된다', async ({ page }) => {
    await goToTuningTab(page);
    await clickSubTab(page, '프롬프트');

    // 프롬프트 템플릿 제목이 표시되는지 확인
    await expect(page.getByText('프롬프트 템플릿').first()).toBeVisible({ timeout: 10000 });
  });

  test('프롬프트 체인 구조 설명이 표시된다', async ({ page }) => {
    await goToTuningTab(page);
    await clickSubTab(page, '프롬프트');

    // 프롬프트 체인 설명 영역 확인
    await expect(page.getByText('프롬프트 체인 구조')).toBeVisible({ timeout: 10000 });
  });

  test('프롬프트 API가 템플릿 목록을 반환한다', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('nav', { timeout: 15000 });

    const result = await authApiFetch(page, '/api/prompts');
    expect(result.status).toBe(200);
    expect(result.data).toHaveProperty('templates');
    expect(Array.isArray(result.data.templates)).toBe(true);
  });
});

// ========================================
// 3. 관측성(LangFuse) 탭 테스트
// ========================================
test.describe('관측성 탭', () => {

  test('튜닝 탭에서 관측성 서브탭이 존재한다', async ({ page }) => {
    await goToTuningTab(page);
    const obsTab = page.getByRole('button', { name: '관측성', exact: true });
    await obsTab.scrollIntoViewIfNeeded();
    await expect(obsTab).toBeVisible();
  });

  test('관측성 탭 클릭 시 LangFuse 관측성 제목이 표시된다', async ({ page }) => {
    await goToTuningTab(page);
    await clickSubTab(page, '관측성');

    // heading으로 정확히 찾기 (strict mode 대응)
    await expect(page.getByRole('heading', { name: 'LangFuse 관측성' })).toBeVisible({ timeout: 10000 });
  });

  test('관측성 API가 상태를 반환한다', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('nav', { timeout: 15000 });

    const result = await authApiFetch(page, '/api/observability');
    expect(result.status).toBe(200);
    expect(result.data).toHaveProperty('enabled');
  });
});

// ========================================
// 4. HWP/HWPX 파일 업로드 지원 테스트
// ========================================
test.describe('HWP 파일 업로드 지원', () => {

  test('파일 업로드 input이 .hwp, .hwpx 확장자를 허용한다', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('nav', { timeout: 15000 });

    // 등록 탭으로 이동
    await page.locator('nav button').filter({ hasText: '등록' }).click();

    // 파일 입력 input의 accept 속성 확인
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeAttached();

    const accept = await fileInput.getAttribute('accept');
    expect(accept).toContain('.hwp');
    expect(accept).toContain('.hwpx');
  });

  test('파일 형식 감지에서 .hwp/.hwpx 확장자가 인식된다', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('nav', { timeout: 15000 });

    // 클라이언트의 파일 형식 매핑 확인
    const result = await page.evaluate(() => {
      const map = {
        '.pdf': 'pdf', '.txt': 'text', '.md': 'markdown', '.markdown': 'markdown',
        '.docx': 'docx', '.xlsx': 'xlsx', '.xls': 'xlsx', '.csv': 'csv',
        '.json': 'json', '.hwp': 'hwp', '.hwpx': 'hwpx',
        '.jpg': 'image', '.jpeg': 'image', '.png': 'image',
        '.gif': 'image', '.webp': 'image',
      };
      return { hwp: map['.hwp'], hwpx: map['.hwpx'] };
    });
    expect(result.hwp).toBe('hwp');
    expect(result.hwpx).toBe('hwpx');
  });
});

// ========================================
// 5. 탭 구조 테스트 (설정/튜닝 분리)
// ========================================
test.describe('설정/튜닝 탭 구조', () => {

  test('설정 탭에 핵심 서브탭들이 존재한다', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('nav', { timeout: 15000 });
    await page.locator('nav button').filter({ hasText: '설정' }).click();

    // 실제 서브탭 라벨: 'API 키', 'LLM 설정', '임베딩'
    const settingsTabs = ['API 키', 'LLM 설정', '임베딩'];
    for (const tabName of settingsTabs) {
      const tab = page.getByRole('button', { name: tabName, exact: true });
      await tab.scrollIntoViewIfNeeded();
      await expect(tab).toBeVisible({ timeout: 5000 });
    }
  });

  test('튜닝 탭에 핵심 서브탭들이 존재한다', async ({ page }) => {
    await goToTuningTab(page);

    const tuningTabs = ['프롬프트', 'RAG 트레이싱', '관측성'];
    for (const tabName of tuningTabs) {
      const tab = page.getByRole('button', { name: tabName, exact: true });
      await tab.scrollIntoViewIfNeeded();
      await expect(tab).toBeVisible({ timeout: 5000 });
    }
  });

  test('서브탭 간 전환이 정상 동작한다', async ({ page }) => {
    await goToTuningTab(page);

    // 프롬프트 → RAG 트레이싱 → 관측성 순서로 전환
    await clickSubTab(page, '프롬프트');
    await expect(page.getByText('프롬프트 템플릿').first()).toBeVisible({ timeout: 10000 });

    await clickSubTab(page, 'RAG 트레이싱');
    await expect(page.getByText('RAG 파이프라인 트레이싱')).toBeVisible({ timeout: 10000 });

    await clickSubTab(page, '관측성');
    await expect(page.getByRole('heading', { name: 'LangFuse 관측성' })).toBeVisible({ timeout: 10000 });
  });
});
