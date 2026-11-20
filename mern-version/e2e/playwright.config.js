import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 45000,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:15173', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node ../scripts/test-stack.js',
    url: 'http://127.0.0.1:15173/api/health',
    reuseExistingServer: false,
    timeout: 180000,
  },
});
