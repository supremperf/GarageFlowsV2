import { test, expect, Page } from '@playwright/test'

/**
 * CONTRÔLE VÉHICULE — lisibilité RÉELLE des champs, mesurée dans Chromium.
 *
 * Bug corrigé : dans la modale « Contrôle véhicule » (carte blanche), les
 * champs Client / Véhicule / Immatriculation / Kilométrage s'affichaient en
 * BLANC SUR BLANC. Cause : `.dark input {color:#f8fafc!important}` était émise
 * APRÈS `.bg-white input {color:#111827!important}` à spécificité ÉGALE, et
 * `applyTheme()` pose `class="dark"` sur <html> pour 3 des 4 thèmes (dont le
 * thème par défaut).
 *
 * Ce test ne relit pas le CSS : il charge une PAGE RÉELLE de l'application
 * (donc la vraie feuille de styles et le vrai <html> stylé par l'app), y insère
 * le balisage EXACT de la modale, et demande au moteur de rendu la couleur
 * EFFECTIVE de chaque champ. Le contraste est ensuite calculé selon WCAG 2.1.
 *
 * Aucune donnée n'est créée ni modifiée : le nœud injecté est retiré et le
 * thème restauré à la fin de chaque cas.
 *
 * Exécution :  BASE_URL=http://localhost:3000 npx playwright test e2e/inspection-contrast.spec.ts
 */

/** Valeurs exigées par la spécification. */
const SAMPLE = {
  clientName: 'Pauline',
  vehicleModel: 'Renault Twingo',
  licensePlate: 'FZ-319-BZ',
  mileage: '75000',
}

/** Classes du champ, copiées VERBATIM de src/components/InspectionModal.tsx. */
const INSP_INPUT =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 ' +
  'placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-300'

interface FieldMeasure {
  id: string
  value: string
  color: string
  background: string
  contrast: number
  textFill: string
}

/**
 * Injecte la modale, applique le thème comme le fait `applyTheme()`, mesure,
 * puis nettoie. Retourne une mesure par champ.
 */
async function measureModal(page: Page, theme: string): Promise<FieldMeasure[]> {
  return page.evaluate(
    ({ theme, sample, inputClass }) => {
      const html = document.documentElement
      const previous = { className: html.className, theme: html.getAttribute('data-theme') }

      // EXACTEMENT ce que fait src/lib/i18n.tsx applyTheme().
      html.setAttribute('data-theme', theme)
      html.classList.remove('dark', 'light')
      html.classList.add(theme === 'light' ? 'light' : 'dark')

      // Balisage EXACT de la modale (racine `gf-surface-light bg-white`,
      // zone d'impression `bg-white`, grille des 4 champs).
      const host = document.createElement('div')
      host.id = 'gf-contrast-probe'
      host.innerHTML = `
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div class="gf-surface-light bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-modal flex flex-col">
            <div class="flex-1 overflow-y-auto">
              <div id="inspection-print" class="p-6 bg-white">
                <div class="space-y-4 mb-6">
                  <div class="grid grid-cols-2 gap-3">
                    <div><label class="text-xs font-semibold text-gray-500 uppercase mb-1 block">Client *</label>
                      <input id="probe-clientName" class="${inputClass}" value="${sample.clientName}"></div>
                    <div><label class="text-xs font-semibold text-gray-500 uppercase mb-1 block">Véhicule</label>
                      <input id="probe-vehicleModel" class="${inputClass}" value="${sample.vehicleModel}"></div>
                    <div><label class="text-xs font-semibold text-gray-500 uppercase mb-1 block">Plaque</label>
                      <input id="probe-licensePlate" class="${inputClass} font-mono" value="${sample.licensePlate}"></div>
                    <div><label class="text-xs font-semibold text-gray-500 uppercase mb-1 block">Kilométrage</label>
                      <input id="probe-mileage" type="number" class="${inputClass}" value="${sample.mileage}"></div>
                  </div>
                </div>
                <div class="flex items-start gap-3 p-3 rounded-xl border bg-emerald-50 border-emerald-200">
                  <input id="probe-nested" class="mt-1 w-full text-xs border-0 bg-transparent text-gray-700 placeholder-gray-400" value="Observation">
                </div>
              </div>
            </div>
          </div>
        </div>`
      document.body.appendChild(host)

      /** Couleur de fond EFFECTIVE : on remonte jusqu'au premier fond opaque. */
      function effectiveBackground(el: Element): string {
        let node: Element | null = el
        while (node) {
          const bg = getComputedStyle(node).backgroundColor
          const m = bg.match(/rgba?\(([^)]+)\)/)
          if (m) {
            const parts = m[1].split(',').map((s) => parseFloat(s))
            const alpha = parts.length > 3 ? parts[3] : 1
            if (alpha > 0.95) return bg
          }
          node = node.parentElement
        }
        return 'rgb(255, 255, 255)'
      }

      function toRgb(c: string): [number, number, number] {
        const m = c.match(/rgba?\(([^)]+)\)/)
        if (!m) return [0, 0, 0]
        const p = m[1].split(',').map((s) => parseFloat(s))
        return [p[0], p[1], p[2]]
      }
      function luminance(c: string): number {
        const [r, g, b] = toRgb(c).map((v) => {
          const s = v / 255
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
        })
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }

      const ids = ['clientName', 'vehicleModel', 'licensePlate', 'mileage', 'nested']
      const out = ids.map((id) => {
        const el = document.getElementById(`probe-${id}`) as HTMLInputElement
        const cs = getComputedStyle(el)
        // `-webkit-text-fill-color` PRIME sur `color` dans Blink : c'est LUI la
        // couleur réellement peinte. On mesure donc les deux.
        const painted = cs.webkitTextFillColor && cs.webkitTextFillColor !== 'currentcolor'
          ? cs.webkitTextFillColor
          : cs.color
        const background = effectiveBackground(el)
        const l1 = luminance(painted)
        const l2 = luminance(background)
        const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
        return {
          id,
          value: el.value,
          color: painted,
          background,
          contrast: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100,
          textFill: cs.webkitTextFillColor,
        }
      })

      // Nettoyage : la page revient EXACTEMENT à son état initial.
      host.remove()
      html.className = previous.className
      if (previous.theme) html.setAttribute('data-theme', previous.theme)
      else html.removeAttribute('data-theme')

      return out
    },
    { theme, sample: SAMPLE, inputClass: INSP_INPUT },
  )
}

test.describe('Contrôle véhicule — contraste des champs (mesure Chromium)', () => {
  test.beforeEach(async ({ page }) => {
    // Page réelle de l'application : même feuille de styles que la modale.
    await page.goto('/login')
    await page.waitForLoadState('networkidle')
  })

  test('l’application applique bien class="dark" au thème par défaut', async ({ page }) => {
    // Sans cela, le bug d'origine serait irreproductible — on vérifie donc que
    // la condition de déclenchement existe toujours.
    //
    // ⚠️ Le thème est posé par le script client APRÈS l'hydratation. Sur un
    // exécuteur partagé, `networkidle` peut être atteint avant que React n'ait
    // démarré : lire l'attribut immédiatement mesurait alors une course, pas le
    // comportement de l'application (échec observé sur le run 38952634453, qui a
    // bloqué le job de fabrication de l'installeur). On ATTEND l'application du
    // thème : l'exigence reste identique — si le thème n'est jamais appliqué, le
    // test échoue toujours.
    const lire = () =>
      page.evaluate(() => ({
        cls: document.documentElement.className,
        theme: document.documentElement.getAttribute('data-theme'),
      }))

    await expect
      .poll(lire, { message: 'le thème « dark » doit être appliqué au démarrage' })
      .toMatchObject({ theme: 'dark' })

    const applied = await lire()
    expect(applied.cls).toContain('dark')
    expect(applied.theme).toBe('dark')
  })

  for (const theme of ['dark', 'light', 'night-shift', 'true-tone']) {
    test(`thème « ${theme} » : les 4 champs sont lisibles sur la carte blanche`, async ({ page }) => {
      const measures = await measureModal(page, theme)
      // Mesures publiées dans le rapport d'exécution (valeurs réelles, pas des
      // suppositions).
      console.log(`\n  [${theme}]`)
      for (const m of measures) {
        console.log(`    ${m.id.padEnd(14)} « ${m.value} »  ${m.color} sur ${m.background} → ${m.contrast}:1`)
      }

      for (const m of measures) {
        // Le texte saisi doit être RÉELLEMENT présent (pas un champ vide).
        expect(m.value.length, `${m.id} vide`).toBeGreaterThan(0)
        // La modale est une surface CLAIRE dans les 4 thèmes : blanc pour les
        // champs d'identification, teinte pastel pour la ligne de checklist.
        const [r, g, b] = m.background.match(/\d+/g)!.map(Number)
        expect(
          Math.min(r, g, b),
          `${m.id} : le fond ${m.background} n'est pas clair`,
        ).toBeGreaterThan(200)
        // Critère : texte principal suffisamment sombre → contraste AAA (≥ 7:1).
        expect(
          m.contrast,
          `${m.id} : texte ${m.color} sur ${m.background} → contraste ${m.contrast}:1`,
        ).toBeGreaterThanOrEqual(7)
      }
    })
  }

  test('les valeurs de la spécification sont affichées et lisibles', async ({ page }) => {
    const measures = await measureModal(page, 'dark')
    const byId = Object.fromEntries(measures.map((m) => [m.id, m]))

    expect(byId.clientName.value).toBe('Pauline')
    expect(byId.vehicleModel.value).toBe('Renault Twingo')
    expect(byId.licensePlate.value).toBe('FZ-319-BZ')
    expect(byId.mileage.value).toBe('75000')

    for (const id of ['clientName', 'vehicleModel', 'licensePlate', 'mileage']) {
      expect(byId[id].color, `${id} peint en blanc !`).not.toBe('rgb(255, 255, 255)')
      expect(byId[id].contrast).toBeGreaterThanOrEqual(7)
    }
  })

  test('capture visuelle de la modale (thème sombre)', async ({ page }, testInfo) => {
    await page.evaluate(
      ({ inputClass, sample }) => {
        const html = document.documentElement
        html.setAttribute('data-theme', 'dark')
        html.classList.add('dark')
        const host = document.createElement('div')
        host.id = 'gf-contrast-shot'
        host.innerHTML = `
          <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div class="gf-surface-light bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col">
              <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                <h2 class="font-bold text-gray-900">Contrôle véhicule</h2>
              </div>
              <div class="p-6 bg-white">
                <div class="grid grid-cols-2 gap-3">
                  <div><label class="text-xs font-semibold text-gray-500 uppercase mb-1 block">Client *</label>
                    <input class="${inputClass}" value="${sample.clientName}"></div>
                  <div><label class="text-xs font-semibold text-gray-500 uppercase mb-1 block">Véhicule</label>
                    <input class="${inputClass}" value="${sample.vehicleModel}"></div>
                  <div><label class="text-xs font-semibold text-gray-500 uppercase mb-1 block">Immatriculation</label>
                    <input class="${inputClass} font-mono" value="${sample.licensePlate}"></div>
                  <div><label class="text-xs font-semibold text-gray-500 uppercase mb-1 block">Kilométrage</label>
                    <input class="${inputClass}" value="${sample.mileage}"></div>
                </div>
              </div>
            </div>
          </div>`
        document.body.appendChild(host)
      },
      { inputClass: INSP_INPUT, sample: SAMPLE },
    )
    // Écrite dans le dossier de sortie du test (preuve visuelle consultable).
    const file = testInfo.outputPath('controle-vehicule-theme-sombre.png')
    const shot = await page.screenshot({ path: file })
    await testInfo.attach('controle-vehicule-theme-sombre.png', { body: shot, contentType: 'image/png' })
    console.log(`\n  Capture : ${file}`)
    await page.evaluate(() => document.getElementById('gf-contrast-shot')?.remove())
  })
})
