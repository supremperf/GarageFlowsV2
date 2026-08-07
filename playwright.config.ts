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
  // Démarrage automatique de l'app pour l'E2E (local ET CI) — sauf si BASE_URL
  // pointe déjà vers une instance en cours. On lance le serveur de DÉVELOPPEMENT
  // (`next dev`) : le mode production refuse volontairement SQLite et exige
  // Postgres + secrets (validation fail-closed de l'instrumentation), inadapté à
  // un E2E de mise en page. Ainsi `npx playwright test` est auto-suffisant et
  // intégrable en CI sans provisionner tout l'environnement de production.
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        timeout: 180_000,
        reuseExistingServer: !process.env.CI,
      },
  // Chaque « projet » = un gabarit d'écran testé (portrait, paysage, tablette, desktop).
  // Les gabarits iPhone/iPad sont ÉMULÉS SOUS CHROMIUM (viewport + user-agent +
  // tactile) : la CI comme l'environnement d'audit n'installent que Chromium —
  // les descripteurs Apple par défaut exigeaient WebKit et faisaient échouer le
  // job au lancement du navigateur (jamais au test). Le rendu du VRAI moteur
  // WebKit/Safari reste une validation externe sur matériel Apple (documentée
  // dans EXTERNAL_VALIDATIONS).
  projects: [
    { name: 'mobile-portrait-small',  use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 568 } } },
    { name: 'mobile-portrait',        use: { ...devices['iPhone 12'], browserName: 'chromium' } },
    { name: 'mobile-landscape',       use: { ...devices['iPhone 12 landscape'], browserName: 'chromium' } },
    { name: 'tablet-portrait',        use: { ...devices['iPad Mini'], browserName: 'chromium' } },
    { name: 'tablet-landscape',       use: { ...devices['iPad Mini landscape'], browserName: 'chromium' } },
    { name: 'desktop',                use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
})
