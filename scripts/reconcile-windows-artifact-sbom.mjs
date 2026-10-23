#!/usr/bin/env node
'use strict'

/**
 * Réconcilie ce qui est RÉELLEMENT DISTRIBUÉ dans l'artefact Windows avec la
 * clôture de production déclarée (SBOM) et les notices tierces.
 *
 * ─── Pourquoi ce script existe ───────────────────────────────────────────────
 * `docs/sbom/sbom-garageflowsv2.cdx.json` décrit la clôture de production
 * LINUX — celle qui est déployée sur Vercel. L'installateur Windows, lui,
 * embarque une clôture DIFFÉRENTE : les binaires optionnels sont sélectionnés
 * par plateforme (`@img/sharp-*`, `@next/swc-*`), et le contenu réellement
 * empaqueté est en plus découpé par electron-builder entre `app.asar`,
 * `app.asar.unpacked` et la sortie `standalone` tracée par Next.
 *
 * Comparer l'installateur à la SBOM Linux produirait deux erreurs symétriques :
 * déclarer des binaires Linux absents du paquet, et taire les binaires Windows
 * qui y sont. Ce script mesure l'écart au lieu de le supposer, dans les DEUX
 * sens, en lisant l'artefact fichier par fichier.
 *
 * Il ne corrige rien et ne masque rien : il produit un constat chiffré.
 *
 * Usage :
 *   node scripts/reconcile-windows-artifact-sbom.mjs \
 *     [--unpacked dist/win-unpacked] \
 *     [--windows-sbom docs/sbom/sbom-garageflows-windows.cdx.json] \
 *     [--out artifacts/windows-delivery/sbom-reconciliation.json]
 *
 * Code de sortie : 0 si le constat a pu être établi (même s'il montre un écart),
 * 1 si l'artefact est introuvable ou illisible — jamais un écart silencieux.
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const ROOT = process.cwd()
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}

const UNPACKED = path.resolve(ROOT, option('--unpacked', 'dist/win-unpacked'))
const WINDOWS_SBOM = path.resolve(ROOT, option('--windows-sbom', 'docs/sbom/sbom-garageflows-windows.cdx.json'))
const SERVER_SBOM = path.resolve(ROOT, option('--server-sbom', 'docs/sbom/sbom-garageflowsv2.cdx.json'))
const NOTICES = path.resolve(ROOT, option('--notices', 'THIRD_PARTY_NOTICES.md'))
const OUT = path.resolve(ROOT, option('--out', 'artifacts/windows-delivery/sbom-reconciliation.json'))

if (!fs.existsSync(UNPACKED)) {
  console.error(`❌ Artefact introuvable : ${path.relative(ROOT, UNPACKED)}`)
  console.error('   Correctif : `npm run dist` sur un poste Windows.')
  process.exit(1)
}

/** Exécute un script JS livré avec npm, sans shell (portable Windows/Linux). */
function runNode(scriptRelative, scriptArgs) {
  const result = spawnSync(process.execPath, [scriptRelative, ...scriptArgs], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(`${scriptRelative} a échoué (${result.status}) : ${(result.stderr || '').trim().slice(-800)}`)
  }
  return result.stdout
}

// ── 1. Clôture de production de CETTE plateforme ──────────────────────────────
console.log('▶ Clôture de production de la plateforme courante…')
fs.mkdirSync(path.dirname(WINDOWS_SBOM), { recursive: true })
runNode('scripts/gen-production-sbom.mjs', ['--out', path.relative(ROOT, WINDOWS_SBOM)])
const windowsSbom = JSON.parse(fs.readFileSync(WINDOWS_SBOM, 'utf8'))
const serverSbom = JSON.parse(fs.readFileSync(SERVER_SBOM, 'utf8'))

const key = (component) => `${component.name}@${component.version}`
const windowsDeclared = new Set(windowsSbom.components.map(key))
const serverDeclared = new Set(serverSbom.components.map(key))

// ── 2. Inventaire RÉEL de l'artefact ──────────────────────────────────────────
console.log('▶ Inventaire du contenu réellement empaqueté…')

/** Tous les package.json sous un dossier node_modules, scopes compris. */
function walkNodeModules(dir, found) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const child = path.join(dir, entry.name)
    if (entry.name === 'node_modules') { walkNodeModules(child, found); continue }
    const manifest = path.join(child, 'package.json')
    if (fs.existsSync(manifest)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'))
        if (parsed.name && parsed.version) found.set(`${parsed.name}@${parsed.version}`, path.relative(UNPACKED, child).split(path.sep).join('/'))
      } catch { /* manifeste illisible : ignoré, signalé par l'absence */ }
    }
    walkNodeModules(child, found)
  }
}

const packaged = new Map()
for (const relative of ['resources/standalone/node_modules', 'resources/app.asar.unpacked/node_modules']) {
  const dir = path.join(UNPACKED, relative)
  if (fs.existsSync(dir)) walkNodeModules(dir, packaged)
}

// Contenu de app.asar : listé par l'outil officiel @electron/asar.
const asarPath = path.join(UNPACKED, 'resources', 'app.asar')
const asarPackages = new Map()
let asarListed = false
if (fs.existsSync(asarPath)) {
  try {
    const asar = require('@electron/asar')
    for (const entry of asar.listPackage(asarPath)) {
      const normalized = entry.replace(/\\/g, '/')
      const match = /^\/(?:.*\/)?node_modules\/((?:@[^/]+\/)?[^/]+)\/package\.json$/.exec(normalized)
      if (!match) continue
      try {
        const parsed = JSON.parse(asar.extractFile(asarPath, normalized.replace(/^\//, '')).toString('utf8'))
        if (parsed.name && parsed.version) asarPackages.set(`${parsed.name}@${parsed.version}`, normalized)
      } catch { /* entrée illisible */ }
    }
    asarListed = true
  } catch (error) {
    console.warn(`⚠ app.asar non listé (${error.message}) — l'inventaire se limite aux dossiers décompressés.`)
  }
}
for (const [identity, location] of asarPackages) if (!packaged.has(identity)) packaged.set(identity, 'app.asar:' + location)

// ── 3. Écarts, dans les deux sens ─────────────────────────────────────────────
const packagedKeys = new Set(packaged.keys())
const declaredNotPackaged = [...windowsDeclared].filter((k) => !packagedKeys.has(k)).sort()
const packagedNotDeclared = [...packagedKeys].filter((k) => !windowsDeclared.has(k)).sort()
const serverOnly = [...serverDeclared].filter((k) => !windowsDeclared.has(k)).sort()
const windowsOnly = [...windowsDeclared].filter((k) => !serverDeclared.has(k)).sort()

// ── 4. Notices : ce que le paquet EMBARQUE réellement ─────────────────────────
const notices = fs.readFileSync(NOTICES, 'utf8')
const noticeSections = new Set(
  [...notices.matchAll(/^### (.+?) — /gm)].map((m) => m[1].trim()),
)
const packagedWithoutNotice = [...packagedKeys].filter((k) => !noticeSections.has(k)).sort()
const noticeWithoutPackaged = [...noticeSections].filter((k) => !packagedKeys.has(k)).sort()
const missingTexts = [...notices.matchAll(/^### (.+?) — [^\n]*\n\n_\(Texte de licence non trouvé/gm)].map((m) => m[1])

// Composants NON npm distribués avec Electron : leurs textes voyagent avec le
// binaire, pas par la SBOM npm. On prouve leur présence, on ne les invente pas.
const nonNpm = [
  { nom: 'Electron', fichier: 'LICENSE.electron.txt' },
  { nom: 'Chromium et ses composants tiers', fichier: 'LICENSES.chromium.html' },
].map((item) => {
  const file = path.join(UNPACKED, item.fichier)
  const present = fs.existsSync(file)
  return { ...item, present, octets: present ? fs.statSync(file).size : 0 }
})

const rapport = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  artefact: path.relative(ROOT, UNPACKED).split(path.sep).join('/'),
  asarListed,
  plateforme: { os: process.platform, arch: process.arch, node: process.version },
  totaux: {
    declareWindows: windowsDeclared.size,
    declareServeurLinux: serverDeclared.size,
    empaqueteReel: packagedKeys.size,
    sectionsDeNotice: noticeSections.size,
  },
  ecartsPlateforme: { serveurLinuxUniquement: serverOnly, windowsUniquement: windowsOnly },
  ecartsArtefact: { declareMaisAbsentDuPaquet: declaredNotPackaged, dansLePaquetMaisNonDeclare: packagedNotDeclared },
  ecartsNotices: {
    empaqueteSansNotice: packagedWithoutNotice,
    noticeSansEquivalentEmpaquete: noticeWithoutPackaged,
    textesManquants: missingTexts,
  },
  composantsNonNpm: nonNpm,
  inventaireEmpaquete: Object.fromEntries([...packaged.entries()].sort(([a], [b]) => a.localeCompare(b))),
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(rapport, null, 2) + '\n', 'utf8')

// ── 5. Constat lisible ────────────────────────────────────────────────────────
const ligne = (label, valeur) => console.log(`  ${label.padEnd(46)} ${valeur}`)
console.log('\n📦 Réconciliation paquet Windows ↔ SBOM ↔ notices\n')
ligne('composants déclarés (clôture Windows)', windowsDeclared.size)
ligne('composants déclarés (clôture serveur Linux)', serverDeclared.size)
ligne('composants réellement empaquetés', packagedKeys.size)
ligne('sections de notice disponibles', noticeSections.size)
ligne('app.asar listé par @electron/asar', asarListed ? 'oui' : 'NON')
console.log('')
ligne('déclarés Windows mais absents du paquet', declaredNotPackaged.length)
ligne('dans le paquet mais non déclarés', packagedNotDeclared.length)
ligne('empaquetés SANS notice disponible', packagedWithoutNotice.length)
ligne('textes de licence manquants dans les notices', missingTexts.length)
console.log('')
for (const item of nonNpm) {
  ligne(`texte ${item.nom}`, item.present ? `présent (${(item.octets / 1024).toFixed(0)} Ko)` : 'ABSENT')
}
if (serverOnly.length || windowsOnly.length) {
  console.log('\n  Écart de PLATEFORME (attendu, binaires optionnels) :')
  for (const k of serverOnly) console.log(`    − ${k}   (Linux/Vercel uniquement)`)
  for (const k of windowsOnly) console.log(`    + ${k}   (Windows uniquement)`)
}
if (packagedWithoutNotice.length) {
  console.log('\n  ⚠ Empaquetés sans notice correspondante :')
  for (const k of packagedWithoutNotice) console.log(`    ! ${k}   → ${packaged.get(k)}`)
}
console.log(`\nRapport : ${path.relative(ROOT, OUT).split(path.sep).join('/')}`)
