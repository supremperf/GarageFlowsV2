import { defineConfig, devices } from '@playwright/test'

/**
 * Tests responsive GarageFlow (E2E).
 *
 * Exécution :
 *   BASE_URL=http://localhost:3000 npm run test:e2e
 *
 * Pour tester l'app authentifiée (planning, assistant…), fournir des identifiants
 * de test — sinon ces tests sont ignorés (skip) et seuls les tests publics
 * (page de connexion) s'exécutent :
 *   E2E_EMAIL=demo@garage.test E2E_PASSWORD=... BASE_URL=http://localhost:3000 npm run test:e2e
 *
 * Le navigateur Chromium est fourni par l'environnement
 * (PLAYWRIGHT_BROWSERS_PATH) — aucun « playwright install » nécessaire.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  // Chaque « projet » = un gabarit d'écran testé (portrait, paysage, tablette, desktop).
  projects: [
    { name: 'mobile-portrait-small',  use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 568 } } },
    { name: 'mobile-portrait',        use: { ...devices['iPhone 12'] } },
    { name: 'mobile-landscape',       use: { ...devices['iPhone 12 landscape'] } },
    { name: 'tablet-portrait',        use: { ...devices['iPad Mini'] } },
    { name: 'tablet-landscape',       use: { ...devices['iPad Mini landscape'] } },
    { name: 'desktop',                use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
})
