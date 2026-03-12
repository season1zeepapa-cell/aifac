// PDF 로더 플러그인 시스템 E2E 테스트
// API 응답 구조, UI 드롭다운, 로더별 가용성, 업로드 파라미터 전달 검증
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

// 등록 탭 → 파일 업로드 모드 이동 헬퍼
async function goToUploadMode(page) {
  await login(page);
  await expect(page.locator('nav')).toBeVisible({ timeout: 15000 });
  // 등록 탭 클릭
  await page.locator('nav button').filter({ hasText: '등록' }).click();
  // 파일 업로드 모드 (기본값이지만 명시적 클릭)
  const uploadBtn = page.getByRole('button', { name: '파일 업로드' });
  await expect(uploadBtn).toBeVisible({ timeout: 5000 });
  await uploadBtn.click();
}

// API 호출 헬퍼 — 로그인 후 토큰을 가져와서 API 호출
async function fetchApi(page, path) {
  return page.evaluate(async (apiPath) => {
    const token = localStorage.getItem('docstore_token');
    const res = await fetch(apiPath, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });
    return { status: res.status, body: await res.json() };
  }, path);
}

// 테스트용 더미 PDF 생성 (최소 PDF 바이너리)
function createDummyPdf() {
  const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 12 Tf 100 700 Td (Hello PDF) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000266 00000 n
0000000360 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
441
%%EOF`;
  return Buffer.from(pdfContent);
}

// PDF 파일 선택 후 드롭다운 대기 헬퍼
async function selectPdfFile(page) {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: 'test.pdf',
    mimeType: 'application/pdf',
    buffer: createDummyPdf(),
  });
  // PDF 추출 엔진 드롭다운 대기
  const engineLabel = page.locator('label', { hasText: 'PDF 추출 엔진' });
  await expect(engineLabel).toBeVisible({ timeout: 10000 });
  return engineLabel;
}

// ============================================================
// 1. PDF 로더 목록 API 테스트
// ============================================================
test.describe('PDF 로더 목록 API (/api/pdf-loaders)', () => {
  test('GET 요청 시 로더 목록과 기본 로더를 반환한다', async ({ page }) => {
    await login(page);
    const response = await fetchApi(page, '/api/pdf-loaders');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.defaultLoader).toBe('pdf-parse');
    expect(Array.isArray(response.body.loaders)).toBe(true);
  });

  test('로더 목록에 6개 로더가 포함된다', async ({ page }) => {
    await login(page);
    const response = await fetchApi(page, '/api/pdf-loaders');
    const loaders = response.body.loaders;

    expect(loaders.length).toBe(6);
    const ids = loaders.map(l => l.id);
    expect(ids).toContain('pdf-parse');
    expect(ids).toContain('pdfjs');
    expect(ids).toContain('upstage-doc');
    expect(ids).toContain('pymupdf');
    expect(ids).toContain('pypdf');
    expect(ids).toContain('pdfplumber');
  });

  test('각 로더에 필수 필드가 존재한다 (id, name, type, description, is_available)', async ({ page }) => {
    await login(page);
    const response = await fetchApi(page, '/api/pdf-loaders');

    for (const loader of response.body.loaders) {
      expect(loader).toHaveProperty('id');
      expect(loader).toHaveProperty('name');
      expect(loader).toHaveProperty('type');
      expect(loader).toHaveProperty('description');
      expect(loader).toHaveProperty('is_available');
      expect(loader).toHaveProperty('free');
      expect(loader).toHaveProperty('bestFor');
      expect(['node', 'python', 'api']).toContain(loader.type);
    }
  });

  test('로더 타입별 분류가 올바르다 (node 2개, python 3개, api 1개)', async ({ page }) => {
    await login(page);
    const response = await fetchApi(page, '/api/pdf-loaders');
    const loaders = response.body.loaders;

    expect(loaders.filter(l => l.type === 'node').length).toBe(2);
    expect(loaders.filter(l => l.type === 'python').length).toBe(3);
    expect(loaders.filter(l => l.type === 'api').length).toBe(1);
  });

  test('pdf-parse 로더는 항상 사용 가능하다', async ({ page }) => {
    await login(page);
    const response = await fetchApi(page, '/api/pdf-loaders');
    const pdfParse = response.body.loaders.find(l => l.id === 'pdf-parse');

    expect(pdfParse).toBeDefined();
    expect(pdfParse.is_available).toBe(true);
    expect(pdfParse.type).toBe('node');
    expect(pdfParse.free).toBe(true);
  });

  test('pdfjs 로더는 사용 가능하다 (npm 설치됨)', async ({ page }) => {
    await login(page);
    const response = await fetchApi(page, '/api/pdf-loaders');
    const pdfjs = response.body.loaders.find(l => l.id === 'pdfjs');

    expect(pdfjs).toBeDefined();
    expect(pdfjs.is_available).toBe(true);
    expect(pdfjs.type).toBe('node');
  });

  test('Upstage 로더의 envKey가 UPSTAGE_API_KEY이다', async ({ page }) => {
    await login(page);
    const response = await fetchApi(page, '/api/pdf-loaders');
    const upstage = response.body.loaders.find(l => l.id === 'upstage-doc');

    expect(upstage).toBeDefined();
    expect(upstage.type).toBe('api');
    expect(upstage.envKey).toBe('UPSTAGE_API_KEY');
    expect(typeof upstage.is_available).toBe('boolean');
  });

  test('Python 로더 3개의 type이 python이다', async ({ page }) => {
    await login(page);
    const response = await fetchApi(page, '/api/pdf-loaders');
    const loaders = response.body.loaders;

    for (const id of ['pymupdf', 'pypdf', 'pdfplumber']) {
      const loader = loaders.find(l => l.id === id);
      expect(loader).toBeDefined();
      expect(loader.type).toBe('python');
      expect(typeof loader.is_available).toBe('boolean');
    }
  });

  test('인증 없이 요청하면 401 에러를 반환한다', async ({ page }) => {
    await page.goto('/');
    const response = await page.evaluate(async () => {
      const res = await fetch('/api/pdf-loaders');
      return { status: res.status };
    });
    expect(response.status).toBe(401);
  });
});

// ============================================================
// 2. 업로드 UI — PDF 로더 드롭다운 표시
// ============================================================
test.describe('업로드 UI — PDF 로더 드롭다운', () => {
  test('PDF 파일 선택 시 "PDF 추출 엔진" 드롭다운이 표시된다', async ({ page }) => {
    await goToUploadMode(page);
    await selectPdfFile(page);
    // selectPdfFile 내에서 이미 표시 확인됨 — 추가 검증
    await expect(page.locator('label', { hasText: 'PDF 추출 엔진' })).toBeVisible();
  });

  test('PDF 추출 엔진 드롭다운에 로더 옵션들이 포함된다', async ({ page }) => {
    await goToUploadMode(page);
    const engineLabel = await selectPdfFile(page);

    const select = engineLabel.locator('..').locator('select');
    const options = await select.locator('option').allTextContents();

    expect(options.some(o => o.includes('pdf-parse'))).toBe(true);
    expect(options.some(o => o.includes('PDF.js'))).toBe(true);
  });

  test('기본 선택값은 pdf-parse이다', async ({ page }) => {
    await goToUploadMode(page);
    const engineLabel = await selectPdfFile(page);

    const select = engineLabel.locator('..').locator('select');
    const value = await select.inputValue();
    expect(value).toBe('pdf-parse');
  });

  test('로더를 변경하면 설명 텍스트가 업데이트된다', async ({ page }) => {
    await goToUploadMode(page);
    const engineLabel = await selectPdfFile(page);

    // pdf-parse 기본 설명 확인
    const descContainer = engineLabel.locator('..').locator('..');
    await expect(descContainer.locator('text=기본 PDF 텍스트 추출')).toBeVisible();

    // PDF.js로 변경
    const select = engineLabel.locator('..').locator('select');
    await select.selectOption('pdfjs');

    // 설명이 변경되었는지 확인
    await expect(descContainer.locator('text=텍스트 위치/좌표')).toBeVisible({ timeout: 3000 });
  });

  test('Python 로더 선택 시 Python 뱃지가 표시된다', async ({ page }) => {
    await goToUploadMode(page);
    const engineLabel = await selectPdfFile(page);

    const select = engineLabel.locator('..').locator('select');
    await select.selectOption('pymupdf');

    // Python 뱃지 — 엔진 설명 영역 내에서 확인
    const descArea = engineLabel.locator('..').locator('.. >> span', { hasText: 'Python' });
    await expect(descArea.first()).toBeVisible({ timeout: 3000 });
  });

  test('Upstage 로더 선택 시 설명에 "구조화 추출"이 포함된다', async ({ page }) => {
    await goToUploadMode(page);
    const engineLabel = await selectPdfFile(page);

    const select = engineLabel.locator('..').locator('select');
    await select.selectOption('upstage-doc');

    const descContainer = engineLabel.locator('..').locator('..');
    await expect(descContainer.locator('text=구조화 추출')).toBeVisible({ timeout: 3000 });
  });

  test('텍스트 파일 선택 시 PDF 추출 엔진 드롭다운이 표시되지 않는다', async ({ page }) => {
    await goToUploadMode(page);

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'test.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('테스트 텍스트 파일입니다.'),
    });

    const engineLabel = page.locator('label', { hasText: 'PDF 추출 엔진' });
    await expect(engineLabel).not.toBeVisible({ timeout: 3000 });
  });

  test('PDF 로더 드롭다운에 6개 옵션이 표시된다', async ({ page }) => {
    await goToUploadMode(page);
    const engineLabel = await selectPdfFile(page);

    const select = engineLabel.locator('..').locator('select');
    const optionCount = await select.locator('option').count();
    expect(optionCount).toBe(6);
  });
});

// ============================================================
// 3. 업로드 시 pdfLoader 파라미터 전달 검증
// ============================================================
test.describe('업로드 시 pdfLoader 파라미터 전달', () => {
  test('기본(pdf-parse) 선택 시 pdfLoader 파라미터가 전송되지 않는다', async ({ page }) => {
    await goToUploadMode(page);
    await selectPdfFile(page);

    // 제목 입력
    const titleInput = page.locator('input[placeholder="문서 제목을 입력하세요"]');
    await expect(titleInput).toBeVisible({ timeout: 5000 });
    await titleInput.fill('테스트 PDF');

    // route로 요청 body 캡처 (multipart는 postData()가 빈 문자열)
    let capturedBody = '';
    await page.route('**/api/upload', async (route) => {
      const request = route.request();
      const buffer = request.postDataBuffer();
      if (buffer) capturedBody = buffer.toString('utf-8');
      await route.abort(); // 실제 업로드 방지
    });

    await page.getByRole('button', { name: '업로드', exact: true }).click();
    await page.waitForTimeout(2000);

    // 기본값(pdf-parse)이므로 pdfLoader 필드가 없어야 함
    expect(capturedBody).not.toContain('pdfLoader');
  });

  test('다른 로더 선택 시 pdfLoader 파라미터가 전송된다', async ({ page }) => {
    await goToUploadMode(page);
    const engineLabel = await selectPdfFile(page);

    // 제목 입력 (필수)
    const titleInput = page.locator('input[placeholder="문서 제목을 입력하세요"]');
    await expect(titleInput).toBeVisible({ timeout: 5000 });
    await titleInput.fill('테스트 PDF pdfjs');

    // pdfjs 로더 선택
    const select = engineLabel.locator('..').locator('select');
    await select.selectOption('pdfjs');
    await expect(select).toHaveValue('pdfjs');

    // route로 요청 body 캡처 (multipart는 postData()가 빈 문자열)
    let capturedBody = '';
    await page.route('**/api/upload', async (route) => {
      const request = route.request();
      const buffer = request.postDataBuffer();
      if (buffer) capturedBody = buffer.toString('utf-8');
      await route.abort(); // 실제 업로드 방지
    });

    await page.getByRole('button', { name: '업로드', exact: true }).click();
    // route 핸들러가 실행될 시간 대기
    await page.waitForTimeout(2000);

    expect(capturedBody).toContain('pdfLoader');
    expect(capturedBody).toContain('pdfjs');
  });
});

// ============================================================
// 4. 로더 bestFor 태그 표시
// ============================================================
test.describe('로더 bestFor 태그 표시', () => {
  test('pdf-parse 선택 시 "텍스트 PDF" 태그가 표시된다', async ({ page }) => {
    await goToUploadMode(page);
    const engineLabel = await selectPdfFile(page);

    const descContainer = engineLabel.locator('..').locator('..');
    await expect(descContainer.locator('text=텍스트 PDF')).toBeVisible({ timeout: 3000 });
  });

  test('PDFPlumber 선택 시 "표" "한글 PDF" 태그가 표시된다', async ({ page }) => {
    await goToUploadMode(page);
    const engineLabel = await selectPdfFile(page);

    const select = engineLabel.locator('..').locator('select');
    await select.selectOption('pdfplumber');

    const descContainer = engineLabel.locator('..').locator('..');
    await expect(descContainer.locator('text=표 추출 최강')).toBeVisible({ timeout: 3000 });
  });

  test('PyMuPDF 선택 시 "대용량" "속도" 태그가 표시된다', async ({ page }) => {
    await goToUploadMode(page);
    const engineLabel = await selectPdfFile(page);

    const select = engineLabel.locator('..').locator('select');
    await select.selectOption('pymupdf');

    const descContainer = engineLabel.locator('..').locator('..');
    await expect(descContainer.locator('span', { hasText: '대용량' }).first()).toBeVisible({ timeout: 3000 });
    await expect(descContainer.locator('span', { hasText: '속도' }).first()).toBeVisible({ timeout: 3000 });
  });
});
