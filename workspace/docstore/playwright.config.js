// Playwright E2E 테스트 설정
const { defineConfig } = require('@playwright/test');
const path = require('path');

const AUTH_FILE = path.join(__dirname, 'tests', '.auth', 'storage-state.json');

module.exports = defineConfig({
  // 테스트 파일 위치
  testDir: './tests',

  // 각 테스트 최대 실행 시간 (30초)
  timeout: 30000,

  // 실패 시 1회 재시도
  retries: 1,

  // 워커 1개로 제한 (rate limit 방어)
  workers: 1,

  // 전역 설정: 한 번만 로그인하고 상태 저장
  globalSetup: './tests/global-setup.js',

  // 테스트 리포트 설정
  reporter: [
    ['list'],                    // 터미널 출력
    ['html', { open: 'never' }], // HTML 리포트 (자동 열기 안 함)
  ],

  use: {
    // 테스트 대상 URL (환경변수로 오버라이드 가능)
    baseURL: process.env.BASE_URL || 'https://docstore-eight.vercel.app',

    // 저장된 인증 상태 재사용 (매번 로그인 안 함)
    storageState: AUTH_FILE,

    // 실패 시에만 스크린샷 저장
    screenshot: 'only-on-failure',

    // 첫 번째 재시도 시 트레이스 기록
    trace: 'on-first-retry',

    // 뷰포트 크기 (모바일 퍼스트)
    viewport: { width: 390, height: 844 },
  },

  // Chromium 브라우저만 사용
  projects: [
    {
      name: 'setup',
      testMatch: /login\.spec\.js/,
      use: { storageState: undefined }, // 로그인 테스트는 인증 없이 실행
    },
    {
      name: 'chromium',
      testIgnore: /login\.spec\.js/,
      use: { browserName: 'chromium' },
      dependencies: ['setup'], // login 테스트 후 실행
    },
  ],
});
