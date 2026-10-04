import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60000,
  workers: 1,
  reporter: 'list',
  use: {
    headless: true,
    channel: 'chromium',
    viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined },
    screenshot: 'only-on-failure',
  },
  webServer: [
    { command: 'npm run preview -w storefront -- --port 5273', url: 'http://localhost:5273', reuseExistingServer: false },
    { command: 'npm run preview -w admin -- --port 5274', url: 'http://localhost:5274', reuseExistingServer: false },
  ],
})