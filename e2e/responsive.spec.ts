import { test, expect, Page } from '@playwright/test'
import { AUTH_STATE } from './global-setup'

/**
 * Suite responsive GarageFlow.
 *
 * Objectif : garantir qu'aucune page ne déborde horizontalement et que la
 * navigation mobile (barre inférieure, assistant, menu « Plus ») reste
 * accessible, tout en préservant le desktop.
 *
 * Les tests authentifiés se connectent si E2E_EMAIL / E2E_PASSWORD sont fournis,
 * sinon ils sont ignorés (skip) — la page de connexion reste testée partout.
 */

const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD
/**
 * Licence GF2 de recette. L'application est protégée par un écran d'activation :
 * sans elle, une session authentifiée n'atteint JAMAIS l'application, et la
 * suite « authentifiée » mesurerait l'écran d'activation en croyant mesurer le
 * planning. Les tests concernés sont donc ignorés plutôt que faussement verts.
 */
const LICENSE = process.env.E2E_LICENSE

/** Vérifie l'absence de scroll horizontal global (tolérance 1px d'arrondi). */
async function expectNoHorizontalOverflow(page: Page) {
  // Mesure APRÈS stabilisation (réseau au repos + styles appliqués) : sous
  // forte parallélisation, mesurer pendant le chargement des CSS/polices
  // produisait un débordement transitoire — un flake, pas un vrai défaut.
  // Un débordement RÉEL (persistant) échoue toujours ici.
  await page.waitForLoadState('networkidle')
  const { clientWidth, scrollWidth } = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(scrollWidth, `scrollWidth (${scrollWidth}) ≤ clientWidth (${clientWidth})`).toBeLessThanOrEqual(clientWidth + 1)
}

// ── Tests publics (aucune authentification requise) ───────────────────────────
test.describe('Page de connexion — responsive', () => {
  test('aucun débordement horizontal', async ({ page }) => {
    await page.goto('/login')
    await expectNoHorizontalOverflow(page)
  })

  test('le formulaire de connexion est visible et non coupé', async ({ page }) => {
    await page.goto('/login')
    const email = page.locator('input[type="email"], input[name="email"]').first()
    await expect(email).toBeVisible()
    const box = await email.boundingBox()
    const vw = page.viewportSize()!.width
    expect(box!.x).toBeGreaterThanOrEqual(-1)
    expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 1)
  })
})

// ── Tests authentifiés (app complète) ─────────────────────────────────────────
test.describe('Application — responsive', () => {
  test.skip(!EMAIL || !PASSWORD || !LICENSE, 'E2E_EMAIL / E2E_PASSWORD / E2E_LICENSE non fournis')

  // Session ouverte UNE fois par le global setup — aucune reconnexion par test
  // (le limiteur d'activation de licence les refuserait, et la suite mesurerait
  // l'écran d'activation en croyant mesurer l'application).
  test.use({ storageState: AUTH_STATE })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle').catch(() => {})
    expect(
      new URL(page.url()).pathname,
      'la session doit atteindre l’application (ni /login, ni /license)',
    ).toBe('/')
  })

  test('aucun débordement horizontal global (planning)', async ({ page }) => {
    await expectNoHorizontalOverflow(page)
  })

  test('la barre de navigation mobile est présente sous md', async ({ page }, testInfo) => {
    const isMobile = page.viewportSize()!.width < 768
    const nav = page.locator('nav[aria-label="Navigation principale"]')
    if (isMobile) {
      await expect(nav).toBeVisible()
      // Bouton principal « Ajouter » accessible.
      await expect(page.getByRole('button', { name: /Nouvelle intervention|Ajouter/i }).first()).toBeVisible()
    } else {
      await expect(nav).toBeHidden()
    }
  })

  test('ouverture et fermeture de l’assistant IA (mobile)', async ({ page }) => {
    test.skip(page.viewportSize()!.width >= 768, 'Assistant en colonne au-delà de md')
    await page.locator('nav[aria-label="Navigation principale"]').getByText(/Assistant/i).click()
    const dialog = page.getByRole('dialog', { name: /Assistant IA/i })
    await expect(dialog).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.getByRole('button', { name: /Fermer le panneau/i }).click()
    await expect(dialog).toBeHidden()
  })

  test('accès aux autres mécaniciens en portrait', async ({ page }) => {
    test.skip(page.viewportSize()!.width >= 768, 'Sélecteur mono-mécanicien en mobile uniquement')
    const tablist = page.getByRole('tablist', { name: /Mécaniciens/i })
    // Présent seulement s'il y a > 1 mécanicien.
    if (await tablist.count()) {
      const tabs = tablist.getByRole('tab')
      if (await tabs.count() > 1) {
        await tabs.nth(1).click()
        await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
      }
    }
  })

  test('le menu « Plus » ouvre tous les modules', async ({ page }) => {
    test.skip(page.viewportSize()!.width >= 768, 'Menu « Plus » en mobile uniquement')
    await page.locator('nav[aria-label="Navigation principale"]').getByText(/Plus/i).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // La section s'intitule « Finance » (cf. i18n `secFinance`) : l'ancienne
    // assertion cherchait « Finances » et ne pouvait donc JAMAIS passer — le
    // menu « Plus » n'était en réalité pas vérifié. On contrôle désormais la
    // section ET une entrée réellement cliquable de celle-ci.
    await expect(dialog.getByText(/^Finance$/i).first()).toBeVisible()
    await expect(dialog.getByText(/Devis\s*&\s*Factures/i).first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('adaptation au changement d’orientation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }) // portrait
    await expectNoHorizontalOverflow(page)
    await page.setViewportSize({ width: 844, height: 390 }) // paysage
    await expectNoHorizontalOverflow(page)
    await page.setViewportSize({ width: 390, height: 844 }) // retour portrait
    await expectNoHorizontalOverflow(page)
  })
})
