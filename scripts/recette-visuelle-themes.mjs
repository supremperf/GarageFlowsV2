/**
 * Recette VISUELLE des thèmes — mesure réelle, pas déclaration (§41).
 *
 * Ouvre les écrans publics dans un vrai Chromium, applique chaque thème, mesure
 * le contraste EFFECTIF entre le texte saisi et le fond réellement composé, et
 * capture l'écran. Un contraste inférieur à 4,5:1 (WCAG AA, texte normal) est
 * signalé ; sous 3:1 le texte est tenu pour illisible.
 *
 * Usage : node scripts/recette-visuelle-themes.mjs [baseUrl] [dossierSortie]
 * Le serveur doit tourner (ELECTRON=1 next start -p 4111 sur une base jetable).
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.argv[2] ?? 'http://127.0.0.1:4111'
const SORTIE = process.argv[3] ?? path.join(process.cwd(), 'artifacts', 'recette-visuelle')

const THEMES = ['dark', 'light', 'night-shift', 'true-tone']
const ECRANS = [
  { nom: 'connexion', chemin: '/login',            champ: 'input[type="email"], input[name="email"], input' },
  { nom: 'licence',   chemin: '/license',          champ: 'input, textarea' },
  { nom: 'portail-connexion', chemin: '/clients/login', champ: 'input' },
]

/**
 * Éléments mesurés EN PLUS du champ de saisie (§40 : normal, désactivé…).
 * Le bouton principal d'un formulaire vide est DÉSACTIVÉ — c'est le premier
 * état que voit l'utilisateur, et celui où le libellé était illisible.
 */
const ETATS = [
  { nom: 'titre',                 sel: 'h1, h2' },
  { nom: 'bouton principal (désactivé)', sel: 'button[type="submit"]' },
  { nom: 'libellé de champ',      sel: 'label' },
]

/** Luminance relative WCAG d'un triplet sRGB 0-255. */
function luminance([r, g, b]) {
  const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function contraste(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}
/** `rgb(a, b, c)` ou `rgba(a, b, c, alpha)` → triplet, composé sur `dessous`. */
function composer(couleur, dessous = [255, 255, 255]) {
  const m = String(couleur).match(/rgba?\(([^)]+)\)/)
  if (!m) return dessous
  const p = m[1].split(',').map((v) => parseFloat(v.trim()))
  const alpha = p.length > 3 ? p[3] : 1
  return [0, 1, 2].map((i) => Math.round(p[i] * alpha + dessous[i] * (1 - alpha)))
}

const resultats = []

const navigateur = await chromium.launch()
try {
  fs.mkdirSync(SORTIE, { recursive: true })

  for (const theme of THEMES) {
    const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await contexte.newPage()
    const erreurs = []
    page.on('pageerror', (e) => erreurs.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()) })

    for (const ecran of ECRANS) {
      await page.goto(`${BASE}${ecran.chemin}`, { waitUntil: 'domcontentloaded' })
      // Le thème vit dans localStorage et est appliqué au montage : on le pose
      // puis on recharge, comme le ferait l'utilisateur après son choix.
      await page.evaluate((t) => localStorage.setItem('gf_theme', t), theme)
      await page.reload({ waitUntil: 'networkidle' }).catch(() => page.reload({ waitUntil: 'domcontentloaded' }))
      await page.waitForTimeout(400)

      const themeApplique = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))

      // ── Refus de mesurer une page SANS feuille de style ───────────────────
      // Un serveur qui sert le CSS en 404 (build plus récent que le processus)
      // donne du noir sur blanc : 21:1 partout, « tout va bien », et la mesure
      // ne veut plus rien dire. C'est arrivé, et ça a failli valider un écran
      // illisible.
      const feuilles = await page.evaluate(() => {
        try {
          return Array.from(document.styleSheets)
            .reduce((n, f) => n + (f.cssRules ? f.cssRules.length : 0), 0)
        } catch { return -1 }
      })
      if (feuilles < 50) {
        throw new Error(
          `Aucune feuille de style appliquée sur ${ecran.chemin} (${feuilles} règles). `
          + 'Le serveur sert-il bien le build courant ? Toute mesure serait fausse.',
        )
      }

      const mesure = await page.evaluate((selecteur) => {
        const champ = document.querySelector(selecteur)
        if (!champ) return null
        const s = getComputedStyle(champ)
        // Fond EFFECTIF : on remonte les ancêtres jusqu'au premier fond opaque.
        const fonds = []
        let n = champ
        while (n && n !== document.documentElement) {
          const c = getComputedStyle(n).backgroundColor
          if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') fonds.push(c)
          n = n.parentElement
        }
        fonds.push(getComputedStyle(document.body).backgroundColor)
        return {
          couleurTexte: s.color,
          fondChamp: s.backgroundColor,
          pileDeFonds: fonds,
          placeholder: champ.getAttribute('placeholder') ?? null,
        }
      }, ecran.champ)

      const fichier = path.join(SORTIE, `${ecran.nom}-${theme}.png`)
      await page.screenshot({ path: fichier, fullPage: false })

      let ratio = null
      if (mesure) {
        // Composition de la pile de fonds, du plus profond au plus proche.
        let fond = [255, 255, 255]
        for (const c of [...mesure.pileDeFonds].reverse()) fond = composer(c, fond)
        ratio = contraste(composer(mesure.couleurTexte, fond), fond)
      }

      resultats.push({
        theme, ecran: ecran.nom, element: 'texte saisi', themeApplique,
        contraste: ratio === null ? null : Math.round(ratio * 100) / 100,
        couleurTexte: mesure?.couleurTexte ?? null,
        fondChamp: mesure?.fondChamp ?? null,
        capture: path.relative(process.cwd(), fichier).replace(/\\/g, '/'),
        erreurs: erreurs.slice(0, 3),
      })

      // ── Autres états de la même page ─────────────────────────────────────
      for (const etat of ETATS) {
        const m = await page.evaluate((sel) => {
          const el = document.querySelector(sel)
          if (!el) return null
          const s = getComputedStyle(el)
          const fonds = []
          let n = el
          while (n && n !== document.documentElement) {
            const bg = getComputedStyle(n).backgroundColor
            if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') fonds.push(bg)
            n = n.parentElement
          }
          fonds.push(getComputedStyle(document.body).backgroundColor)
          return { couleur: s.color, opacite: parseFloat(s.opacity), fonds }
        }, etat.sel)
        if (!m) continue

        let fond = [255, 255, 255]
        for (const b of [...m.fonds].reverse()) fond = composer(b, fond)
        const encre = composer(m.couleur, fond)
        // `opacity` du conteneur dilue l'encre sur son propre fond.
        const dilue = m.opacite < 1
          ? encre.map((v, i) => Math.round(v * m.opacite + fond[i] * (1 - m.opacite)))
          : encre
        resultats.push({
          theme, ecran: ecran.nom, element: etat.nom, themeApplique,
          contraste: Math.round(contraste(dilue, fond) * 100) / 100,
          couleurTexte: m.couleur, fondChamp: null,
          capture: path.relative(process.cwd(), fichier).replace(/\\/g, '/'),
          erreurs: [],
        })
      }
    }
    await contexte.close()
  }
} finally {
  await navigateur.close()
}

const rapport = path.join(SORTIE, 'rapport.json')
fs.writeFileSync(rapport, JSON.stringify(resultats, null, 2), 'utf8')

console.log('\n  écran / thème / élément                             contraste   verdict')
console.log('  ' + '─'.repeat(76))
let illisibles = 0
for (const r of resultats) {
  const c = r.contraste
  const verdict = c === null ? 'ÉLÉMENT INTROUVABLE' : c < 3 ? 'ILLISIBLE' : c < 4.5 ? 'faible (AA non atteint)' : 'OK'
  if (c !== null && c < 3) illisibles++
  const libelle = `${r.ecran} / ${r.theme} / ${r.element}`
  console.log(`  ${libelle.padEnd(51)} ${String(c ?? '—').padEnd(11)} ${verdict}`)
}
console.log(`\n  captures : ${SORTIE}`)
console.log(`  rapport  : ${rapport}`)
if (illisibles > 0) {
  console.log(`\n  ✗ ${illisibles} écran(s) illisible(s).`)
  process.exit(1)
}
console.log('\n  ✓ Aucun écran illisible.')
