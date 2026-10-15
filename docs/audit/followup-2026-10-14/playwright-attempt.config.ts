import { defineConfig } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import base from '../../../playwright.config'

// Diagnostic harness only: real Next dev server, real Playwright tests, no
// database/response mocks added. Does not run setup-dev or modify local secrets.
// Point AUDIT_E2E_DATABASE_URL at a TEST-OWNED copy of the empty SQLite template.
// Browser installation/authenticated journeys remain separate prerequisites.
const root = path.resolve(__dirname, '../../..')
const database = process.env.AUDIT_E2E_DATABASE_URL
if (!database?.startsWith('file:')) throw new Error('A test-owned SQLite AUDIT_E2E_DATABASE_URL is required')
export default defineConfig(base, {
  testDir: path.join(root, 'e2e'),
  globalSetup: path.join(root, 'e2e/global-setup.ts'),
  reporter: [
    ['line'],
    ['json', { outputFile: path.join(__dirname, 'evidence/e2e.json') }],
  ],
  use: { baseURL: 'http://127.0.0.1:4028' },
  webServer: {
    command: `"${process.execPath}" node_modules/next/dist/bin/next dev --hostname 0.0.0.0 --port 4028`,
    cwd: root,
    url: 'http://127.0.0.1:4028/login',
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      DATABASE_URL: database,
      NEXTAUTH_SECRET: randomBytes(32).toString('hex'),
      NEXTAUTH_URL: 'http://127.0.0.1:4028',
    },
  },
})
