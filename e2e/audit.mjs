// Audit responsive authentifié — exécuté avec un vrai Chromium contre l'app
// lancée localement (next dev + SQLite seedée : 5 mécaniciens, 13 interventions).
//
//   BASE_URL=http://localhost:3000 LABEL=after MODE=full  node e2e/audit.mjs
//   BASE_URL=http://localhost:3000 LABEL=before MODE=shots node e2e/audit.mjs
//
// MODE=full  : captures + assertions sur tous les flux (branche responsive).
// MODE=shots : captures uniquement (état « avant », volontairement cassé).
import { chromium } from '@playwright/test'
import { SignJWT } from 'jose'
import fs from 'node:fs'
import path from 'node:path'

// Le middleware protège les pages derrière une « session de licence » signée
// (cookie gf_session, HS256 avec NEXTAUTH_SECRET). En local, on forge un cookie
// valide avec le MÊME secret que le serveur dev pour franchir cette porte —
// aucune donnée de production n'est touchée, aucune modification de code. Les
// API de données (/api/jobs, /api/mechanics) restent, elles, protégées par la
// vraie session NextAuth (obtenue via une connexion réelle ci-dessous).
async function mintLicenseCookie() {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('NEXTAUTH_SECRET manquant (doit être identique au serveur dev)')
  return new SignJWT({ typ: 'premium', lid: 'e2e-local-license' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1d')
    .sign(new TextEncoder().encode(secret))
}

const BASE = process.env.BASE_URL || 'http://localhost:3000'
const LABEL = process.env.LABEL || 'after'
const MODE = process.env.MODE || 'full'
const OUT = path.join('e2e', 'shots', LABEL)
// Identifiants du compte de démonstration (fournis par la seed) — via l'env,
// jamais codés en dur. Ex. : E2E_EMAIL=… E2E_PASSWORD=… node e2e/audit.mjs
const EMAIL = process.env.E2E_EMAIL || 'AdminGarageFlow@admin.fr'
const PASSWORD = process.env.E2E_PASSWORD || ''
if (!PASSWORD) { console.error('E2E_PASSWORD requis (mot de passe du compte de démo seedé).'); process.exit(2) }

fs.mkdirSync(OUT, { recursive: true })

const VIEWPORTS = [
  { name: '390x844-portrait',  width: 390,  height: 844, mobile: true },
  { name: '844x390-landscape', width: 844,  height: 390, mobile: true },
  { name: '768x1024-tablet',   width: 768,  height: 1024, mobile: false },
  { name: '1440x900-desktop',  width: 1440, height: 900, mobile: false },
]

const results = []
function rec(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} [${LABEL}] ${name}${detail ? ' — ' + detail : ''}`)
}

async function noOverflow(page, where) {
  const { c, s } = await page.evaluate(() => ({
    c: document.documentElement.clientWidth,
    s: document.documentElement.scrollWidth,
  }))
  return { ok: s <= c + 1, msg: `${where}: scrollWidth ${s} vs clientWidth ${c}` }
}

async function login(page) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
  const email = page.locator('input[type=email]')
  await email.waitFor({ state: 'visible', timeout: 25000 })
  await page.waitForTimeout(900) // laisser React hydrater (sinon la saisie précède l'attachement des handlers)
  await email.click()
  await email.pressSequentially(EMAIL, { delay: 15 })
  const pw = page.locator('input[type=password]')
  await pw.click()
  await pw.pressSequentially(PASSWORD, { delay: 15 })
  // Le bouton n'est actif que lorsque l'état React a bien reçu email + mot de passe.
  await page.locator('button[type=submit]:not([disabled])').waitFor({ timeout: 10000 })
  await page.click('button[type=submit]')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {})
  // Planning prêt = un nom de mécanicien seedé est visible. En dev, la 1re
  // compilation des routes peut être lente : on attend, et on recharge une fois
  // si l'app reste sur le splash « Chargement du planning… ».
  const mech = page.locator('text=Thomas B.').first()
  try {
    await mech.waitFor({ timeout: 45000 })
  } catch {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await mech.waitFor({ timeout: 45000 }).catch(() => {})
  }
  await page.waitForTimeout(1500)
}

async function shot(page, vp, screen) {
  await page.screenshot({ path: path.join(OUT, `${vp.name}__${screen}.png`), fullPage: false })
}

async function run() {
  const gfSession = await mintLicenseCookie()
  // Navigateur : `CHROME_PATH` si l'opérateur impose un binaire, sinon le
  // Chromium que Playwright a lui-même installé (`npx playwright install
  // chromium`) — c'est `chromium.launch()` sans `executablePath` qui le résout.
  //
  // Le chemin `/opt/pw-browsers/chromium` codé en dur ici auparavant était celui
  // d'une image CI Linux : sur tout autre poste — dont Windows, la plateforme
  // CIBLE du produit — l'audit s'arrêtait sur « Failed to launch chromium
  // because executable doesn't exist », avant la moindre mesure. On le conserve
  // comme repli explicite, mais seulement s'il existe vraiment.
  const imposed = process.env.CHROME_PATH
  const ciImage = '/opt/pw-browsers/chromium'
  const executablePath = imposed || (fs.existsSync(ciImage) ? ciImage : undefined)
  const browser = await chromium.launch(executablePath ? { executablePath } : {})
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
    })
    await context.addCookies([{ name: 'gf_session', value: gfSession, url: BASE, httpOnly: true, sameSite: 'Lax' }])
    const page = await context.newPage()
    try {
      await login(page)
      await shot(page, vp, '1-planning')
      const ov = await noOverflow(page, vp.name + ' planning')
      rec(`Pas de débordement horizontal — ${vp.name}`, ov.ok, ov.msg)

      // Données réelles visibles : au moins une intervention seedée + un
      // mécanicien (son nom OU, en colonnes étroites ≥ md, son avatar « TB »).
      const hasMechName = await page.locator('text=Thomas B.').first().isVisible().catch(() => false)
      const hasMechAvatar = await page.getByText('TB', { exact: true }).first().isVisible().catch(() => false)
      const hasMech = hasMechName || hasMechAvatar
      const hasJob = await page.locator('text=Martin Dupont').first().isVisible().catch(() => false)
        || await page.locator('text=Sophie Laurent').first().isVisible().catch(() => false)
      rec(`Planning avec données réelles — ${vp.name}`, hasMech && hasJob,
        `mécanicien(nom:${hasMechName}/avatar:${hasMechAvatar}) intervention:${hasJob}`)

      if (MODE !== 'full') { await context.close(); continue }

      // ── Desktop / large : colonne assistant présente, pas de barre mobile ──
      if (!vp.mobile && vp.width >= 1024) {
        const aside = await page.locator('aside:has-text("Assistant IA")').first().isVisible().catch(() => false)
        const navHidden = !(await page.locator('nav[aria-label="Navigation principale"]').first().isVisible().catch(() => false))
        rec(`Desktop : assistant en colonne + pas de nav mobile — ${vp.name}`, aside && navHidden,
          `colonne:${aside} navMobileMasquée:${navHidden}`)
      }

      // ── Flux mobile détaillés (portrait 390×844) ──────────────────────────
      if (vp.name === '390x844-portrait') {
        const nav = page.locator('nav[aria-label="Navigation principale"]')
        rec('Barre de navigation mobile visible', await nav.isVisible().catch(() => false))
        rec('Bouton principal « Ajouter » visible',
          await page.getByRole('button', { name: /Nouvelle intervention/i }).first().isVisible().catch(() => false))

        // Changement de mécanicien
        const tabs = page.getByRole('tab')
        const nTabs = await tabs.count().catch(() => 0)
        if (nTabs > 1) {
          await tabs.nth(1).click()
          await page.waitForTimeout(400)
          const sel = await tabs.nth(1).getAttribute('aria-selected')
          const marco = await page.locator('main').getByText('Marco R.').first().isVisible().catch(() => false)
          rec('Changement de mécanicien', sel === 'true' && marco, `onglet2 sélectionné:${sel} colonne Marco R.:${marco}`)
          await shot(page, vp, '2-mechanic-switch')
          await tabs.nth(0).click(); await page.waitForTimeout(300)
        } else rec('Changement de mécanicien', false, `tablist absente (${nTabs} onglets)`)

        // Assistant IA : ouverture / fermeture
        await nav.getByText(/^Assistant$/).click()
        const dlg = page.getByRole('dialog', { name: /Assistant IA/i })
        const opened = await dlg.isVisible().catch(() => false)
        const ovA = await noOverflow(page, 'assistant')
        await shot(page, vp, '3-assistant-open')
        await page.getByRole('button', { name: /Fermer le panneau/i }).click().catch(() => {})
        await dlg.waitFor({ state: 'hidden', timeout: 6000 }).catch(() => {})
        await page.waitForTimeout(500)
        const closed = !(await dlg.isVisible().catch(() => false))
        rec('Assistant IA : ouverture/fermeture', opened && closed && ovA.ok,
          `ouvert:${opened} fermé:${closed} ${ovA.msg}`)

        // Menu « Plus » — doit exposer TOUS les modules (Atelier, Gestion, Finance…)
        // NB : on cible le dialog — les mêmes libellés existent aussi dans la barre
        // d'outils du header (masquée md:hidden sur mobile → non visible).
        await nav.getByText(/^Plus$/).click()
        const plusDlg = page.getByRole('dialog')
        await plusDlg.getByText('Réception').first().waitFor({ state: 'visible', timeout: 9000 }).catch(() => {})
        await page.waitForTimeout(400)
        const recep = await plusDlg.getByText('Réception').first().isVisible().catch(() => false)
        const stock = await plusDlg.getByText('Stock', { exact: true }).first().isVisible().catch(() => false)
        const rappels = await plusDlg.getByText('Rappels').first().isVisible().catch(() => false)
        const finance = await plusDlg.getByText(/Dashboard financier/i).first().isVisible().catch(() => false)
        const ovP = await noOverflow(page, 'plus')
        await shot(page, vp, '4-plus-menu')
        rec('Menu « Plus » (tous les modules)', recep && stock && rappels && finance && ovP.ok,
          `Réception:${recep} Stock:${stock} Rappels:${rappels} Finance:${finance} ${ovP.msg}`)
        await page.getByRole('button', { name: /Fermer le panneau/i }).click().catch(() => {})
        await page.waitForTimeout(300)

        // Création d'intervention
        await page.getByRole('button', { name: /Nouvelle intervention/i }).first().click()
        await page.waitForTimeout(600)
        const createOpen = await page.locator('h2', { hasText: 'Nouvelle intervention' }).first().isVisible().catch(() => false)
        const ovC = await noOverflow(page, 'job-create')
        await shot(page, vp, '5-job-create')
        rec('Création d\'intervention (modale)', createOpen && ovC.ok, `modale:${createOpen} ${ovC.msg}`)
        await page.keyboard.press('Escape'); await page.waitForTimeout(400)

        // Ouverture d'une intervention existante (clic sur une carte).
        // dnd-kit intercepte le tap synthétique → on déclenche directement le
        // onClick React via dispatchEvent (comportement réel = clic ouvre la fiche).
        const card = page.locator('main [class*="cursor-grab"]').first()
        await card.dispatchEvent('click').catch(() => {})
        await page.waitForTimeout(700)
        let editOpen = await page.locator('h2', { hasText: /Modifier/ }).first().isVisible().catch(() => false)
        if (!editOpen) { await card.tap().catch(() => {}); await page.waitForTimeout(700)
          editOpen = await page.locator('h2', { hasText: /Modifier/ }).first().isVisible().catch(() => false) }
        await shot(page, vp, '6-job-open')
        rec('Ouverture d\'une intervention', editOpen, `modale édition:${editOpen}`)
        await page.keyboard.press('Escape'); await page.waitForTimeout(400)

        // Rotation portrait → paysage → portrait
        await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(700)
        const ovL = await noOverflow(page, 'rotate-landscape')
        await shot(page, vp, '7-rotate-landscape')
        await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(700)
        const ovB = await noOverflow(page, 'rotate-back')
        rec('Adaptation à la rotation (pas de débordement)', ovL.ok && ovB.ok, `${ovL.msg} | ${ovB.msg}`)
      }
    } catch (e) {
      rec(`Exception — ${vp.name}`, false, String(e).slice(0, 200))
    }
    await context.close()
  }
  await browser.close()

  const passed = results.filter((r) => r.pass).length
  console.log(`\n==== [${LABEL}] ${passed}/${results.length} vérifications OK ====`)
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ label: LABEL, base: BASE, passed, total: results.length, results }, null, 2))
}

run().catch((e) => { console.error(e); process.exit(1) })
