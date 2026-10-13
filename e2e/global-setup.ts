import { chromium, type FullConfig } from '@playwright/test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Ouverture d'UNE session applicative, réutilisée par toute la suite.
 *
 * ─── Pourquoi ──────────────────────────────────────────────────────────────
 * Chaque test authentifié se connectait ET activait une licence dans son
 * `beforeEach`. Sur six gabarits d'écran, cela faisait des dizaines
 * d'activations : le limiteur de débit (5 activations / 15 min par IP) et le
 * décompte de sièges les refusaient, la session restait bloquée sur l'écran
 * d'activation, et la suite « responsive » mesurait cet écran au lieu de
 * l'application — en passant au vert sur les contrôles de débordement.
 *
 * On ouvre donc la session UNE fois ici, et les tests repartent de cet état.
 */

export const AUTH_STATE = path.join(__dirname, '.auth', 'app.json')

export default async function globalSetup(_config: FullConfig) {
  const email = process.env.E2E_EMAIL
  const password = process.env.E2E_PASSWORD
  const license = process.env.E2E_LICENSE
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  mkdirSync(path.dirname(AUTH_STATE), { recursive: true })

  if (!email || !password || !license) {
    // Les tests authentifiés se déclarent « skipped » : jamais de faux vert.
    rmSync(AUTH_STATE, { force: true })
    writeFileSync(AUTH_STATE, JSON.stringify({ cookies: [], origins: [] }))
    return
  }

  const browser = await chromium.launch()

  // Une session déjà ouverte est RÉUTILISÉE si elle atteint encore
  // l'application. Chaque activation consomme un SIÈGE d'appareil de la
  // licence : ré-activer à chaque exécution épuisait le quota et la suite
  // finissait bloquée sur l'écran d'activation. C'est aussi ce que fait un vrai
  // utilisateur — il ne ressaisit pas sa licence à chaque ouverture.
  if (existsSync(AUTH_STATE)) {
    const probeCtx = await browser.newContext({ baseURL, storageState: AUTH_STATE })
    const probe = await probeCtx.newPage()
    try {
      await probe.goto('/', { waitUntil: 'load' })
      await probe.waitForLoadState('networkidle').catch(() => {})
      if (new URL(probe.url()).pathname === '/') {
        await probeCtx.close()
        await browser.close()
        return
      }
    } catch { /* état inutilisable : on en ouvre un neuf ci-dessous */ }
    await probeCtx.close()
  }

  const page = await browser.newPage({ baseURL })
  try {
    await page.goto('/login', { waitUntil: 'load' })
    await page.waitForLoadState('networkidle').catch(() => {})

    // Le formulaire se remonte après hydratation : remplir puis VÉRIFIER.
    const submit = page.locator('button[type="submit"]')
    for (let attempt = 0; attempt < 20; attempt++) {
      await page.fill('input[type="email"], input[name="email"]', email).catch(() => {})
      await page.fill('input[type="password"], input[name="password"]', password).catch(() => {})
      const filled = await page.evaluate(() => {
        const e = document.querySelector<HTMLInputElement>('input[type="email"], input[name="email"]')
        const p = document.querySelector<HTMLInputElement>('input[type="password"], input[name="password"]')
        return Boolean(e?.value && p?.value)
      }).catch(() => false)
      if (filled && await submit.isEnabled().catch(() => false)) break
      await page.waitForTimeout(500)
    }
    await submit.click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 45_000 }).catch(() => {})

    // La redirection de connexion mène d'abord à « / » ; c'est le middleware qui
    // renvoie ENSUITE vers /license si la licence manque. Tester l'URL trop tôt
    // faisait sauter l'activation, et l'état enregistré ne portait alors que le
    // cookie de session — jamais le cookie de licence.
    await page.goto('/', { waitUntil: 'load' })
    await page.waitForLoadState('networkidle').catch(() => {})

    if (new URL(page.url()).pathname.startsWith('/license')) {
      const field = page.locator('textarea, input[type="text"]').first()
      await field.waitFor({ timeout: 15_000 })
      const activate = page.getByRole('button', { name: /activer/i }).first()
      for (let attempt = 0; attempt < 20; attempt++) {
        await field.fill(license).catch(() => {})
        const filled = await page.evaluate(() => {
          const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>('textarea, input[type="text"]')
          return Boolean(el?.value && el.value.length > 40)
        }).catch(() => false)
        if (filled && await activate.isEnabled().catch(() => false)) break
        await page.waitForTimeout(500)
      }
      await activate.click()
      await page.waitForURL((u) => !u.pathname.startsWith('/license'), { timeout: 45_000 }).catch(() => {})
    }

    const finalUrl = page.url()
    const cookies = (await page.context().cookies()).map((c) => c.name)
    // eslint-disable-next-line no-console
    console.log(`[e2e:setup] url=${finalUrl} cookies=${cookies.join(',')}`)
    await page.context().storageState({ path: AUTH_STATE })

  } finally {
    await browser.close()
  }
}
