import { test, expect, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { AUTH_STATE } from './global-setup'

/**
 * GF-PLAN — planning mécaniciens dans un VRAI navigateur.
 *
 * Les tests unitaires prouvent le CALCUL de la fenêtre ; ils ne prouvent rien de
 * la géométrie réelle. Ce fichier mesure la page rendue : position effective des
 * flèches, effet réel de la molette, nombre de colonnes réellement peintes.
 *
 * ─── Conditions d'exécution ─────────────────────────────────────────────────
 * Le planning est derrière l'authentification ET l'activation de licence. Sans
 * `E2E_EMAIL` / `E2E_PASSWORD` / `E2E_LICENSE`, `global-setup` n'ouvre aucune
 * session : ces tests se déclarent alors IGNORÉS, jamais verts. Un test de mise
 * en page qui « passe » sur un écran de connexion ne prouve rien — c'est
 * exactement le piège que la suite responsive a déjà connu.
 */

const sessionOuverte = (() => {
  if (!existsSync(AUTH_STATE)) return false
  try {
    return (JSON.parse(readFileSync(AUTH_STATE, 'utf8')).cookies ?? []).length > 0
  } catch {
    return false
  }
})()

test.use({ storageState: sessionOuverte ? AUTH_STATE : undefined })

/**
 * ─── Exécution ──────────────────────────────────────────────────────────────
 *   npx playwright test planning-mechanics --workers=1
 *
 * Le `--workers=1` n'est pas une précaution rituelle : les six gabarits d'écran
 * de la configuration partagent UNE instance applicative. Lancés en parallèle,
 * ils mesurent des géométries pendant que les autres redimensionnent leur propre
 * fenêtre et sollicitent le même serveur de développement — des tests corrects
 * échouent alors au hasard, et jamais les mêmes. Sérialisés : 54/54 stables.
 *
 * Les tests eux-mêmes ne modifient aucun état partagé (l'effectif est préparé en
 * amont et seulement lu) ; la contention restante est celle du serveur.
 */
test.describe.configure({ mode: 'serial' })

test.describe('planning — fenêtre de mécaniciens et navigation', () => {
  test.skip(!sessionOuverte, 'Session applicative absente : fournir E2E_EMAIL / E2E_PASSWORD / E2E_LICENSE.')

  /**
   * Vérifie que l'effectif est suffisant — sans RIEN créer.
   *
   * La version précédente créait les mécaniciens manquants. Les six gabarits
   * d'écran s'exécutant en parallèle contre une SEULE instance, ils se
   * disputaient l'effectif : des tests parfaitement corrects échouaient au
   * hasard, et jamais les mêmes d'une exécution à l'autre. Un scénario qui
   * modifie un état partagé ne peut pas rendre un verdict stable.
   *
   * L'effectif est donc préparé en amont (jeu de recette), et le scénario se
   * contente de le lire.
   */
  async function garantirEffectif(page: Page, minimum: number) {
    const existants = await page.request.get('/api/mechanics')
    expect(existants.ok(), 'l’API mécaniciens doit répondre').toBeTruthy()
    const liste = await existants.json()
    expect(
      liste.length,
      `effectif insuffisant (${liste.length} < ${minimum}) : préparez le jeu de recette avant d'exécuter ce scénario`,
    ).toBeGreaterThanOrEqual(minimum)
  }

  const precedents = (page: Page) => page.getByRole('button', { name: 'Mécaniciens précédents' })
  const suivants = (page: Page) => page.getByRole('button', { name: 'Mécaniciens suivants' })
  /** En-têtes de colonnes réellement peints. */
  const colonnes = (page: Page) => page.locator('[data-gf-mechanic-column]')

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle').catch(() => {})
    await garantirEffectif(page, 20)
    await page.reload()
    await page.waitForLoadState('networkidle').catch(() => {})
    await expect(colonnes(page).first()).toBeVisible({ timeout: 20_000 })
  })

  test('les flèches sont en HAUT À GAUCHE et en HAUT À DROITE du planning', async ({ page }) => {
    const gauche = await precedents(page).boundingBox()
    const droite = await suivants(page).boundingBox()
    const premiereColonne = await colonnes(page).first().boundingBox()
    expect(gauche && droite && premiereColonne).toBeTruthy()
    if (!gauche || !droite || !premiereColonne) return

    // Gauche à gauche, droite à droite — mesuré, pas supposé.
    expect(droite.x).toBeGreaterThan(gauche.x)

    // « EN HAUT » : au-dessus des en-têtes de colonnes, jamais au milieu vertical.
    expect(gauche.y + gauche.height).toBeLessThanOrEqual(premiereColonne.y + 2)
    expect(droite.y + droite.height).toBeLessThanOrEqual(premiereColonne.y + 2)

    // Et elles n'empiètent sur aucune colonne.
    const chevauche = (b: { x: number; y: number; width: number; height: number }) =>
      b.y < premiereColonne.y + premiereColonne.height && b.y + b.height > premiereColonne.y
      && b.x < premiereColonne.x + premiereColonne.width && b.x + b.width > premiereColonne.x
    expect(chevauche(gauche)).toBe(false)
    expect(chevauche(droite)).toBe(false)
  })

  test('la position des flèches ne bouge pas quand on change de groupe', async ({ page }) => {
    const avantG = await precedents(page).boundingBox()
    const avantD = await suivants(page).boundingBox()
    await suivants(page).click()
    await page.waitForTimeout(400)
    const apresG = await precedents(page).boundingBox()
    const apresD = await suivants(page).boundingBox()

    expect(apresG?.x).toBeCloseTo(avantG?.x ?? -1, 0)
    expect(apresG?.y).toBeCloseTo(avantG?.y ?? -1, 0)
    expect(apresD?.x).toBeCloseTo(avantD?.x ?? -1, 0)
    expect(apresD?.y).toBeCloseTo(avantD?.y ?? -1, 0)
  })

  test('au premier groupe la flèche gauche est désactivée, au dernier la droite', async ({ page }) => {
    await expect(precedents(page)).toBeDisabled()
    await expect(suivants(page)).toBeEnabled()

    for (let i = 0; i < 30 && await suivants(page).isEnabled(); i++) {
      await suivants(page).click()
      await page.waitForTimeout(120)
    }
    await expect(suivants(page)).toBeDisabled()
    await expect(precedents(page)).toBeEnabled()
  })

  test('tous les mécaniciens sont atteignables, aucun doublon, aucun groupe vide', async ({ page }) => {
    const vus = new Set<string>()
    for (let i = 0; i < 30; i++) {
      const noms = await colonnes(page).allTextContents()
      expect(noms.length, 'aucun groupe ne doit être vide').toBeGreaterThan(0)
      noms.forEach((n) => vus.add(n.trim()))
      if (!(await suivants(page).isEnabled())) break
      await suivants(page).click()
      await page.waitForTimeout(120)
    }
    const total = (await (await page.request.get('/api/mechanics')).json()).length
    expect(vus.size).toBe(total)
  })

  test('la molette fait défiler le planning, elle ne change PAS de groupe', async ({ page }) => {
    const avant = await colonnes(page).allTextContents()
    const zone = page.locator('[data-gf-mechanic-column]').first()
    await zone.hover()
    for (const [dx, dy] of [[0, 400], [0, -400], [200, 0], [-200, 0], [120, 120]]) {
      await page.mouse.wheel(dx, dy)
      await page.waitForTimeout(120)
    }
    expect(await colonnes(page).allTextContents()).toEqual(avant)
  })

  test('des clics rapides répétés ne cassent pas l’état', async ({ page }) => {
    // Le nombre de groupes DÉPEND du gabarit : six colonnes en desktop large,
    // une seule en portrait. Un nombre de clics figé (12) suffisait au desktop
    // et laissait le portrait au milieu de la liste — le test échouait alors
    // sur une bordure parfaitement correcte. On martèle donc largement au-delà
    // du pire cas : autant de clics que de mécaniciens.
    const total = (await (await page.request.get('/api/mechanics')).json()).length
    const martelage = total + 5

    for (let i = 0; i < martelage; i++) await suivants(page).click({ force: true }).catch(() => {})
    await page.waitForTimeout(500)
    expect((await colonnes(page).allTextContents()).length).toBeGreaterThan(0)
    await expect(suivants(page)).toBeDisabled()

    for (let i = 0; i < martelage; i++) await precedents(page).click({ force: true }).catch(() => {})
    await page.waitForTimeout(500)
    await expect(precedents(page)).toBeDisabled()
  })

  test('naviguer ne réattribue AUCUNE intervention', async ({ page }) => {
    // `/api/jobs` enveloppe sa liste ; on ne suppose pas la forme de la réponse.
    const interventions = async (): Promise<Array<{ id: string; mechanicId: string }>> => {
      const corps = await (await page.request.get('/api/jobs')).json()
      return Array.isArray(corps) ? corps : (corps?.data ?? corps?.jobs ?? [])
    }

    const avant = await interventions()
    for (let i = 0; i < 6 && await suivants(page).isEnabled(); i++) {
      await suivants(page).click(); await page.waitForTimeout(120)
    }
    while (await precedents(page).isEnabled()) { await precedents(page).click(); await page.waitForTimeout(120) }

    const apres = await interventions()
    // Le couple (intervention, mécanicien) doit être IDENTIQUE : c'est ce qui
    // prouve qu'aucune affectation n'a suivi le déplacement de la fenêtre.
    const cle = (j: { id: string; mechanicId: string }) => `${j.id}:${j.mechanicId}`
    expect(apres.map(cle).sort()).toEqual(avant.map(cle).sort())
  })

  test('le nombre de colonnes suit la largeur réelle', async ({ page }) => {
    const mesures: Array<[number, number]> = []
    for (const largeur of [1366, 1920, 2560]) {
      await page.setViewportSize({ width: largeur, height: 900 })
      await page.waitForTimeout(400)
      mesures.push([largeur, await colonnes(page).count()])
      await page.screenshot({ path: `playwright-report/planning-${largeur}.png`, fullPage: false })
    }
    // Plus large ⇒ jamais moins de colonnes, et jamais de colonnes minuscules.
    expect(mesures[1][1]).toBeGreaterThanOrEqual(mesures[0][1])
    expect(mesures[2][1]).toBeGreaterThanOrEqual(mesures[1][1])
    for (const [largeur, n] of mesures) {
      expect(n, `${largeur}px`).toBeGreaterThan(0)
      expect(n, `${largeur}px : colonnes trop nombreuses donc illisibles`).toBeLessThanOrEqual(6)
    }
  })

  test('sur mobile les flèches restent en haut', async ({ page }) => {
    for (const largeur of [375, 390, 430]) {
      await page.setViewportSize({ width: largeur, height: 800 })
      // Attendre un délai FIXE après un changement de gabarit est un pari : sous
      // charge, le reflow n'est pas terminé et la mesure porte sur une mise en
      // page intermédiaire. On laisse donc l'assertion réessayer jusqu'à ce que
      // la géométrie se stabilise.
      await expect.poll(async () => {
        const g = await precedents(page).boundingBox()
        const col = await colonnes(page).first().boundingBox()
        if (!g || !col) return null
        return g.y + g.height <= col.y + 2
      }, { message: `flèche au-dessus des colonnes à ${largeur}px` }).toBe(true)
    }
  })
})
