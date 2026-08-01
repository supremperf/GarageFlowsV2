/**
 * Configuration Playwright (E2E). Utilise le Chromium PRÉ-INSTALLÉ (pas de
 * téléchargement) et démarre l'application Next en mode dev sur une base SQLite
 * E2E dédiée (semée par e2e/global-setup.ts). Voir docs/E2E_TESTING.md.
 */
import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'

const PORT = 3100
const E2E_DB = path.resolve(__dirname, '.tmp-e2e.db')
// Chromium pré-installé (sandbox) si présent ; sinon on laisse Playwright
// résoudre le navigateur installé par `playwright install` (CI).
const CHROMIUM = process.env.GF_E2E_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const launchOptions = fs.existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {}

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions,
    // Cookie de licence de TEST (mint par global-setup) pour franchir le
    // middleware de licence (portail /license). Jamais un contournement de prod.
    storageState: path.resolve(__dirname, 'e2e/.auth/license.json'),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL: `file:${E2E_DB}`,
      NEXTAUTH_URL: `http://127.0.0.1:${PORT}`,
      NEXTAUTH_SECRET: 'e2e-only-secret-not-for-production-0123456789abcdef',
      NODE_ENV: 'development',
      NEXT_TELEMETRY_DISABLED: '1',
      LICENSE_ENFORCEMENT: 'off',
    },
  },
})
