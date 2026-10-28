import { defineConfig } from '@playwright/test'

// Read-only UI checks against the running workspace; no agent messages or edits.
export default defineConfig({
  testDir: './specs', testMatch: 'library-workspace.spec.ts', timeout: 60_000,
  expect: { timeout: 15_000 }, workers: 1, reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:4318', viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] } },
})
