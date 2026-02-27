import { defineConfig, devices } from '@playwright/test';

/**
 * E2E 테스트 설정
 *
 * 실행 전 서버 2개를 자동 기동:
 *   1. Backend  — packages/server  (port 3001)
 *   2. Frontend — packages/web Vite (port 5173)
 *
 * Usage:
 *   pnpm --filter @agent-observatory/web test:e2e
 */

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,        // 공유 서버 상태가 있으므로 순차 실행
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    // 1) Backend server
    {
      command: 'PORT=3001 OBSERVATORY_MODE=local node ../../packages/server/dist/index.js',
      url: 'http://localhost:3001/api/v1/config',
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    // 2) Frontend dev server
    {
      command: 'VITE_WEBSOCKET_URL=http://localhost:3001 VITE_MOCK=false pnpm dev --port 5173',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
  ],
});
