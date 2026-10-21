// Pilote Playwright de l'application RÉELLE de la copie de démonstration.
// Usage : node web.cjs <étape> [arguments]
//   login    <png_page> <png_saisie> <png_après>   connexion du compte de démonstration
//   activate <png_saisie> <png_résultat>            colle le jeton et active
//   visit    <chemin> <png> [attente_ms]            ouvre une page avec la session
// Les secrets (mot de passe, jeton) viennent de fichiers en mode 600 et sont
// MASQUÉS dans les captures ; ils ne sont jamais écrits dans la sortie.
const { chromium } = require('/home/user/GarageFlowsV2/node_modules/@playwright/test')
const fs = require('fs')
const { execFileSync } = require('child_process')

const S = process.env.S
const BASE = 'http://localhost:3300'
const STATE = process.env.WEB_STATE || `${S}/web-state.json`
const [, , step, ...args] = process.argv

async function shot(page, out, masks = []) {
  const boxes = []
  const visibles = []
  for (const m of masks) {
    if (!(await m.isVisible())) continue
    const b = await m.boundingBox({ timeout: 2000 }).catch(() => null)
    if (b) { boxes.push(b); visibles.push(m) }
  }
  await page.screenshot({ path: out, mask: visibles, maskColor: '#000000' })
  for (const b of boxes) {
    execFileSync('convert', [out, '-font', 'DejaVu-Sans-Bold', '-pointsize', '13', '-fill', '#ffd166',
      '-annotate', `+${Math.round(b.x + 12)}+${Math.round(b.y + Math.min(b.height - 6, 22))}`,
      '[ masqué ]', out])
  }
  console.log(`capture : ${out} | URL : ${new URL(page.url()).pathname}`)
}

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 900 }, locale: 'fr-FR', timezoneId: 'Europe/Paris',
    ...(step !== 'login' && fs.existsSync(STATE) ? { storageState: STATE } : {}),
  })
  const page = await ctx.newPage()
  page.on('response', (r) => {
    const u = new URL(r.url())
    if (u.pathname.startsWith('/api/') && r.status() >= 400) console.log(`API ${r.status()} ${r.request().method()} ${u.pathname}`)
  })
  try {
    if (step === 'login') {
      const [pngPage, pngSaisie, pngApres] = args
      await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 120000 })
      await page.waitForTimeout(3000)
      await shot(page, pngPage)
      const mdp = page.locator('input[autocomplete="current-password"]')
      const bouton = page.locator('button[type="submit"]')
      // Saisie répétée tant que React (hydratation à la demande en dev) ne l'a pas prise en compte.
      for (let essai = 1; essai <= 5 && !(await bouton.isEnabled()); essai++) {
        await page.fill('input[type="email"]', '')
        await page.locator('input[type="email"]').pressSequentially('admingarageflow@admin.fr', { delay: 10 })
        await mdp.fill(process.env.DEMO_ADMIN_PASSWORD || '')
        await page.waitForTimeout(1000)
      }
      await shot(page, pngSaisie, [mdp])
      await Promise.all([
        page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 120000 }),
        page.click('button[type="submit"]'),
      ])
      await page.waitForLoadState('networkidle', { timeout: 120000 })
      await page.waitForTimeout(1500)
      await shot(page, pngApres)
    } else if (step === 'activate') {
      const [pngSaisie, pngResultat] = args
      await page.goto(BASE + '/license', { waitUntil: 'networkidle', timeout: 120000 })
      const zone = page.locator('textarea')
      await zone.fill(fs.readFileSync(`${S}/demo-token.txt`, 'utf8').trim())
      await shot(page, pngSaisie, [zone])
      const reponse = page.waitForResponse((r) => r.url().endsWith('/api/license/activate'), { timeout: 120000 })
      await page.getByRole('button', { name: /Activer GarageFlows/ }).click()
      const r = await reponse
      console.log(`POST /api/license/activate → HTTP ${r.status()}`)
      await page.waitForTimeout(500)
      await shot(page, pngResultat, [zone])
      await page.waitForURL((u) => !u.pathname.startsWith('/license'), { timeout: 30000 }).catch(() => {})
      await page.waitForLoadState('networkidle', { timeout: 120000 })
      console.log(`après activation : ${new URL(page.url()).pathname}`)
    } else if (step === 'watch') {
      // Page ouverte AVANT l'action du keygen ; attend le texte annoncé.
      const [pngAvant, pngApres, secondes, texte] = args
      await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 120000 })
      await page.waitForTimeout(3000)
      await shot(page, pngAvant)
      fs.writeFileSync(`${S}/watch.ready`, new Date().toISOString())
      const t0 = Date.now()
      await page.getByText(texte).first().waitFor({ timeout: Number(secondes) * 1000 })
      console.log(`« ${texte} » affiché ${((Date.now() - t0) / 1000).toFixed(1)} s après le signal`)
      await page.waitForTimeout(1200)
      await shot(page, pngApres)
    } else if (step === 'chain') {
      // Ouvre « / » puis attend successivement chaque texte, une capture par texte.
      // Le signal est posé après la première capture : l'action du keygen suit.
      const [secondes, ...paires] = args
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 120000 })
      for (let i = 0; i < paires.length; i += 2) {
        const t0 = Date.now()
        await page.getByText(paires[i]).first().waitFor({ timeout: Number(secondes) * 1000 })
        console.log(`« ${paires[i]} » affiché après ${((Date.now() - t0) / 1000).toFixed(1)} s`)
        await page.waitForTimeout(800)
        await shot(page, paires[i + 1])
        if (i === 0) fs.writeFileSync(`${S}/watch.ready`, new Date().toISOString())
      }
    } else if (step === 'visit') {
      const [chemin, png, attente] = args
      await page.goto(BASE + chemin, { waitUntil: 'networkidle', timeout: 120000 })
      await page.waitForTimeout(Number(attente || 2500))
      await shot(page, png)
    } else {
      throw new Error(`étape inconnue : ${step}`)
    }
  } finally {
    await ctx.storageState({ path: STATE })
    fs.chmodSync(STATE, 0o600)
    await browser.close()
  }
})().catch((e) => { console.error('ÉCHEC :', e.message); process.exit(1) })
