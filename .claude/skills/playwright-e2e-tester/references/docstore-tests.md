# DocStore 테스트 시나리오 가이드

## UI 구조

- SPA (React CDN + Babel in-browser)
- 하단 네비게이션 5탭: 등록, 문서 목록, 검색, AI 채팅, 관리
- 로그인 필수 (JWT 토큰 기반)

## 탭 선택자

```js
// 하단 네비게이션 탭 클릭
await page.locator('nav button').filter({ hasText: '등록' }).click();
await page.locator('nav button').filter({ hasText: '문서 목록' }).click();
await page.locator('nav button').filter({ hasText: '검색' }).click();
await page.locator('nav button').filter({ hasText: 'AI 채팅' }).click();
await page.locator('nav button').filter({ hasText: '관리' }).click();
```

## 1. 로그인 테스트

```js
test.describe('로그인', () => {
  test('빈 입력 시 에러 메시지 표시', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '로그인' }).click();
    await expect(page.locator('.bg-red-50')).toContainText('아이디와 비밀번호');
  });

  test('잘못된 비밀번호 시 에러', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('아이디를 입력하세요').fill('wrong');
    await page.getByPlaceholder('비밀번호를 입력하세요').fill('wrong');
    await page.getByRole('button', { name: '로그인' }).click();
    await expect(page.locator('.bg-red-50')).toBeVisible();
  });

  test('정상 로그인 성공', async ({ page }) => {
    await login(page);
    await expect(page.locator('nav')).toBeVisible(); // 하단 네비
  });
});
```

## 2. 등록 탭 (업로드)

- 모드 토글: 파일 업로드 / 법령 검색 / URL 임포트
- 드래그 앤 드롭 영역 `.drop-zone`
- 지원 포맷: PDF, DOCX, XLSX, CSV, TXT

```js
test('등록 탭 모드 전환', async ({ page }) => {
  await login(page);
  // 기본: 파일 업로드 모드
  await expect(page.locator('.drop-zone')).toBeVisible();
  // 법령 검색 모드로 전환
  await page.getByText('법령 검색').click();
  await expect(page.getByPlaceholder(/법령명/)).toBeVisible();
});
```

## 3. 문서 목록 탭

- 문서 카드 리스트 (기본 5개, "더보기" 버튼)
- 필터: 전체 / 법령 / 기타
- 문서 삭제 (휴지통 이동)
- 접기/펼치기 토글

```js
test('문서 목록 표시 및 더보기', async ({ page }) => {
  await login(page);
  await page.locator('nav button').filter({ hasText: '문서 목록' }).click();
  // 문서 카드 존재 확인
  await page.waitForSelector('[class*="rounded-xl"]');
  // 더보기 버튼 있으면 클릭
  const moreBtn = page.getByText(/더보기/);
  if (await moreBtn.isVisible()) {
    await moreBtn.click();
  }
});
```

## 4. 검색 탭

- 텍스트 검색 / 벡터 검색 토글
- 문서 범위 멀티 선택 (MultiSelect 컴포넌트)
- 검색 결과 카드

```js
test('텍스트 검색 실행', async ({ page }) => {
  await login(page);
  await page.locator('nav button').filter({ hasText: '검색' }).click();
  await page.getByPlaceholder(/검색어/).fill('테스트');
  await page.getByRole('button', { name: /검색/ }).click();
  // API 응답 대기
  await page.waitForResponse(resp => resp.url().includes('/api/search'));
});
```

## 5. AI 채팅 탭

- 프로바이더 선택: Gemini / OpenAI / Claude
- 문서 범위 멀티 선택
- 채팅 입력 + 전송
- 마크다운 렌더링 답변

```js
test('AI 채팅 탭 진입 및 UI 확인', async ({ page }) => {
  await login(page);
  await page.locator('nav button').filter({ hasText: 'AI 채팅' }).click();
  // 프로바이더 버튼 존재 확인
  await expect(page.getByText('Gemini')).toBeVisible();
  await expect(page.getByText('OpenAI')).toBeVisible();
  // 입력창 확인
  await expect(page.getByPlaceholder(/질문/)).toBeVisible();
});
```

## 6. 관리 탭

- API 사용량 표시
- 연결 상태 (DB, Gemini, OpenAI 등)
- OCR 엔진 설정

```js
test('관리 탭 API 상태 확인', async ({ page }) => {
  await login(page);
  await page.locator('nav button').filter({ hasText: '관리' }).click();
  await page.waitForResponse(resp => resp.url().includes('/api/api-usage'));
  // 연결 상태 표시 확인
  await expect(page.getByText(/DB/)).toBeVisible();
});
```

## 공통 유틸

```js
const { test, expect } = require('@playwright/test');

async function login(page) {
  await page.goto('/');
  await page.getByPlaceholder('아이디를 입력하세요').fill(process.env.TEST_ID || 'admin');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(process.env.TEST_PW || 'test1234');
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForSelector('nav');
}
```
