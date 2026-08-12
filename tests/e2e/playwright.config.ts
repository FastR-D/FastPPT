import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'

const systemChrome = '/usr/bin/google-chrome'

export default defineConfig({
  testDir: './specs',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4328',
    viewport: { width: 1600, height: 900 },
    launchOptions: {
      ...(existsSync(systemChrome) ? { executablePath: systemChrome } : {}),
      args: ['--no-proxy-server'],
    },
  },
  webServer: [
    {
      command: 'tsx fixtures/server.ts',
      url: 'http://127.0.0.1:4317/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command:
        'pnpm --dir ../../apps/web exec vite --host 127.0.0.1 --port 4328',
      url: 'http://127.0.0.1:4328',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
})
