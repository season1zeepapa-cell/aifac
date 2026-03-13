---
name: playwright-e2e-tester
description: >
  Playwright CLI로 웹 프로젝트 E2E 테스트를 자동 실행한다.
  'E2E 테스트', 'Playwright 테스트', '브라우저 테스트', 'UI 테스트', '자동 테스트',
  '전체 테스트', '기능 테스트 돌려줘', '사이트 테스트' 등을 요청할 때 실행.
  로그인, 페이지 네비게이션, 검색, API 응답, 폼 제출 등 주요 UI 흐름을 자동 검증한다.
---

# Playwright E2E 테스트

## 실행 흐름

1. 테스트 대상 프로젝트/URL 확인
2. `playwright.config.js` 생성 (없으면)
3. `tests/*.spec.js` 테스트 파일 작성
4. `npx playwright test` 실행
5. 실패 시 원인 분석 및 수정

## 배포 URL 매핑

| 프로젝트 | URL |
|---|---|
| workspace/docstore | https://docstore-eight.vercel.app |
| workspace/error | https://error-liart.vercel.app |
| 로컬 | http://localhost:PORT |

## 설정 파일

프로젝트 루트에 `playwright.config.js`가 없으면 생성:

```js
const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: process.env.BASE_URL || 'https://docstore-eight.vercel.app',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
```

## 테스트 실행 명령

```bash
# 전체 실행
npx playwright test

# 특정 파일
npx playwright test tests/login.spec.js

# 브라우저 보이기
npx playwright test --headed

# 특정 테스트명
npx playwright test -g "로그인"

# 리포트
npx playwright show-report
```

## 테스트 작성 규칙

- 테스트명 한국어 작성
- 선택자 우선순위: `data-testid` > `getByRole` > `getByText` > CSS
- `waitForTimeout` 금지 → `waitForSelector`, `waitForResponse` 사용
- 인증 필요 테스트는 `test.beforeEach`에서 로그인 처리

## 인증 헬퍼 패턴

로그인이 필요한 테스트에서 사용:

```js
async function login(page, baseURL) {
  await page.goto(baseURL || '/');
  await page.getByPlaceholder('아이디를 입력하세요').fill(process.env.TEST_ID || 'admin');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(process.env.TEST_PW || 'test1234');
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForSelector('nav'); // 하단 네비게이션 렌더 대기
}
```

환경변수로 인증 정보 전달:
```bash
TEST_ID=admin TEST_PW=password npx playwright test
```

## docstore 탭별 테스트 패턴

`references/docstore-tests.md` 참고 — 탭 5개(등록, 문서목록, 검색, AI채팅, 관리)별 테스트 시나리오와 셀렉터 가이드.

## 주의사항

- 배포 서버 테스트 시 rate limit 고려 (연속 로그인 시도 5회/분 제한)
- AI 관련 기능(요약, 분석, RAG 채팅)은 API 비용 발생 → `test.skip` 또는 mock 권장
- 파일 업로드 테스트는 로컬에서만 실행 권장
