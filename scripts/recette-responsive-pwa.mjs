/**
 * Recette RESPONSIVE de la PWA — mesure réelle en navigateur, pas déclaration.
 *
 * Ouvre chaque écran atteignable sans session dans un vrai Chromium, à des
 * largeurs de 320 à 1024 px, et MESURE :
 *
 *   · le débordement HORIZONTAL de la page (`scrollWidth > clientWidth`) — un
 *     écran de téléphone qui se balade latéralement est inutilisable d'une main ;
 *   · les éléments qui SORTENT du cadre, nommés un par un (sélecteur, largeur) ;
 *   · les cibles tactiles sous 44 × 44 px, la borne au-dessous de laquelle un
 *     doigt rate le bouton ;
 *   · les erreurs de console et les exceptions de page.
 *
 * Chaque combinaison écran × largeur est capturée en PNG. Aucune donnée n'est
 * inventée : ce fichier ne sait que lire ce que le navigateur a composé.
 *
 * Usage : node scripts/recette-responsive-pwa.mjs [baseUrl] [dossierSortie]
 * Le serveur doit tourner (ELECTRON=1 next start -p 4111 sur une base jetable).
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.argv[2] ?? 'http://127.0.0.1:4111'
const SORTIE = process.argv[3] ?? path.join(process.cwd(), 'artifacts', 'recette-responsive')

/** Largeurs réelles : petit téléphone, téléphone courant, grand, tablette. */
const LARGEURS = [320, 360, 390, 414, 768, 1024]

/**
 * Écrans atteignables SANS session — ceux qu'un utilisateur voit en premier.
 *
 * `/mechanic` n'y figure pas : il redirige vers `/login` tant qu'aucune session
 * mécanicien n'existe. L'y laisser produisait une ligne « mécanicien : OK »
 * portant en réalité sur la page de connexion. Le script détecte désormais
 * toute redirection et refuse de conclure — mais autant ne pas la provoquer.
 */
const ECRANS = [
  { nom: 'connexion-poste',   chemin: '/login' },
  { nom: 'licence',           chemin: '/license' },
  { nom: 'portail-connexion', chemin: '/clients/login' },
  { nom: 'portail-inscription', chemin: '/clients/register' },
  { nom: 'inscription-garage', chemin: '/register' },
]

/** Cible tactile minimale (recommandation WCAG 2.5.5 / Apple HIG). */
const CIBLE_MIN = 44

/** Marge de tolérance sur le débordement : sous 2 px, c'est un arrondi. */
const TOLERANCE_PX = 2

const resultats = []

const navigateur = await chromium.launch()
try {
  fs.mkdirSync(SORTIE, { recursive: true })

  for (const ecran of ECRANS) {
    for (const largeur of LARGEURS) {
      const contexte = await navigateur.newContext({
        viewport: { width: largeur, height: 800 },
        deviceScaleFactor: 1,
        isMobile: largeur < 768,
        hasTouch: largeur < 768,
      })
      const page = await contexte.newPage()
      const erreurs = []
      page.on('pageerror', (e) => erreurs.push(String(e)))
      page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()) })

      let mesure = null
      let urlFinale = null
      try {
        await page.goto(`${BASE}${ecran.chemin}`, { waitUntil: 'domcontentloaded', timeout: 20_000 })
        // Laisse le rendu client se poser (hydratation, polices, mesure de largeur).
        await page.waitForTimeout(700)

        // ── L'URL RÉELLEMENT mesurée, jamais celle demandée ──────────────────
        // Un écran protégé redirige vers la connexion. Sans ce relevé, le
        // rapport annonçait « mécanicien : OK » alors qu'il avait mesuré la
        // page de connexion — un verdict sur un écran jamais vu.
        urlFinale = new URL(page.url()).pathname

        mesure = await page.evaluate((seuils) => {
          const { CIBLE_MIN, TOLERANCE_PX } = seuils
          const doc = document.documentElement
          const largeurVue = doc.clientWidth

          /** Chemin CSS court et lisible d'un élément. */
          const designer = (el) => {
            const nom = el.tagName.toLowerCase()
            const id = el.id ? `#${el.id}` : ''
            const cls = typeof el.className === 'string' && el.className
              ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
              : ''
            return `${nom}${id}${cls}`.slice(0, 120)
          }

          const debordements = []
          const cibles = []
          for (const el of Array.from(document.body.querySelectorAll('*'))) {
            const r = el.getBoundingClientRect()
            if (r.width === 0 && r.height === 0) continue
            const style = getComputedStyle(el)
            if (style.visibility === 'hidden' || style.display === 'none') continue

            // Débordement : l'élément dépasse le bord droit ou commence avant 0.
            if (r.right > largeurVue + TOLERANCE_PX || r.left < -TOLERANCE_PX) {
              // Deux faux positifs à écarter, sinon le rapport est illisible et
              // l'on cesse de le lire :
              //  · un conteneur qui défile HORIZONTALEMENT sur lui-même est
              //    légitime (tableau large, barre d'onglets) — ce n'est pas la
              //    PAGE qui se balade ;
              //  · un élément ROGNÉ par un ancêtre `overflow: hidden` — halos
              //    décoratifs, cercles floutés en fond — ne fait rien défiler
              //    du tout. Il déborde géométriquement, jamais visuellement.
              const propre = style.overflowX === 'auto' || style.overflowX === 'scroll'
              let rogne = false
              for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
                const s = getComputedStyle(p)
                if (s.overflowX === 'hidden' || s.overflow === 'hidden' || s.overflowX === 'clip') {
                  rogne = true
                  break
                }
              }
              if (!propre && !rogne) {
                debordements.push({
                  selecteur: designer(el),
                  droite: Math.round(r.right),
                  largeur: Math.round(r.width),
                })
              }
            }

            // Cibles tactiles : uniquement ce qui est réellement cliquable.
            //
            // Les liens EN LIGNE dans une phrase sont explicitement exclus par
            // WCAG 2.5.5 : leur taille suit celle du texte, et les élargir
            // casserait la mise en page. On ne retient donc que les commandes
            // autonomes — boutons, champs, et liens présentés en bloc.
            const enLigneDansTexte = el.tagName === 'A'
              && style.display.startsWith('inline')
              && (el.parentElement?.textContent ?? '').trim().length > (el.textContent ?? '').trim().length
            const cliquable = !enLigneDansTexte
              && el.matches('button, a[href], input:not([type=hidden]), select, textarea, [role=button]')
            if (cliquable && r.width > 0 && r.height > 0
                && (r.width < CIBLE_MIN || r.height < CIBLE_MIN)) {
              cibles.push({
                selecteur: designer(el),
                l: Math.round(r.width),
                h: Math.round(r.height),
                texte: (el.textContent ?? '').trim().slice(0, 40),
              })
            }
          }

          return {
            largeurVue,
            scrollWidth: doc.scrollWidth,
            defilementHorizontal: doc.scrollWidth > largeurVue + TOLERANCE_PX,
            debordements: debordements.slice(0, 12),
            nbDebordements: debordements.length,
            cibles: cibles.slice(0, 12),
            nbCibles: cibles.length,
            // Une page vraiment rendue applique des dizaines de règles CSS.
            reglesCss: Array.from(document.styleSheets).reduce((n, f) => {
              try { return n + f.cssRules.length } catch { return n }
            }, 0),
          }
        }, { CIBLE_MIN, TOLERANCE_PX })

        const fichier = path.join(SORTIE, `${ecran.nom}-${largeur}.png`)
        await page.screenshot({ path: fichier, fullPage: true })
        mesure.capture = path.relative(process.cwd(), fichier)
      } catch (e) {
        erreurs.push(`navigation: ${String(e).slice(0, 200)}`)
      }

      const redirige = urlFinale !== null && urlFinale !== ecran.chemin
      resultats.push({
        ecran: ecran.nom, chemin: ecran.chemin, largeur, erreurs,
        urlMesuree: urlFinale, redirige,
        ...(mesure ?? {}),
      })
      await contexte.close()
    }
  }
} finally {
  await navigateur.close()
}

// ── Garde anti-mesure-fantôme ────────────────────────────────────────────────
// Une page servie sans CSS (404 sur le bundle, serveur pas prêt) ne déborde
// jamais et n'a aucune cible trop petite : elle produirait un rapport
// rassurant et FAUX. On refuse de conclure sur si peu de règles appliquées.
const sansStyle = resultats.filter((r) => (r.reglesCss ?? 0) < 50)
if (sansStyle.length > 0) {
  console.error(
    `MESURE INVALIDE : ${sansStyle.length} page(s) rendues avec moins de 50 règles CSS `
    + `(${sansStyle.slice(0, 3).map((r) => `${r.ecran}@${r.largeur}`).join(', ')}). `
    + 'Le serveur ne sert probablement pas les styles — aucun verdict n\'est publié.',
  )
  process.exit(2)
}

const rapport = path.join(SORTIE, 'rapport.json')
fs.writeFileSync(rapport, JSON.stringify({ base: BASE, largeurs: LARGEURS, resultats }, null, 2))

const enDefaut = resultats.filter((r) => r.defilementHorizontal)
const petitesCibles = resultats.filter((r) => (r.nbCibles ?? 0) > 0)

console.log(`\n── Recette responsive : ${resultats.length} mesures (${ECRANS.length} écrans × ${LARGEURS.length} largeurs)`)
console.log(`   Rapport : ${path.relative(process.cwd(), rapport)}`)

for (const r of resultats) {
  const drapeaux = []
  if (r.redirige) drapeaux.push(`REDIRIGÉ vers ${r.urlMesuree} — l'écran demandé n'a PAS été mesuré`)
  if (r.defilementHorizontal) drapeaux.push(`DÉBORDE (scrollWidth ${r.scrollWidth} > ${r.largeurVue})`)
  if ((r.nbCibles ?? 0) > 0) drapeaux.push(`${r.nbCibles} cible(s) < ${CIBLE_MIN}px`)
  if (r.erreurs?.length) drapeaux.push(`${r.erreurs.length} erreur(s) console`)
  console.log(`   ${drapeaux.length ? '✗' : '·'} ${r.ecran} @${r.largeur} ${drapeaux.join(' | ') || 'OK'}`)
  for (const d of r.debordements ?? []) {
    console.log(`       ↳ ${d.selecteur} — droite ${d.droite}px (largeur ${d.largeur})`)
  }
}

console.log(
  `\n   Débordement horizontal : ${enDefaut.length}/${resultats.length} — `
  + `cibles tactiles trop petites : ${petitesCibles.length}/${resultats.length}`,
)

// Une redirection invalide le verdict : on aurait mesuré un autre écran.
const redirigees = resultats.filter((r) => r.redirige)
if (redirigees.length > 0) {
  console.error(
    `\n   MESURE NON CONCLUANTE : ${redirigees.length} écran(s) redirigés `
    + `(${Array.from(new Set(redirigees.map((r) => `${r.chemin} → ${r.urlMesuree}`))).join(', ')}). `
    + 'Ces écrans n\'ont PAS été audités.',
  )
}

// Le débordement horizontal est le seul verdict BLOQUANT : il rend l'écran
// inutilisable. Les cibles trop petites sont rapportées pour arbitrage.
process.exit(enDefaut.length > 0 || redirigees.length > 0 ? 1 : 0)
