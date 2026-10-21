#!/usr/bin/env node
/**
 * generate-release-manifest — SOURCE UNIQUE DE VÉRITÉ liant une release à son
 * code source. Écrit `release-manifest.json` à la racine, rempli EXCLUSIVEMENT à
 * partir de données RÉELLES lues sur la machine (git + package.json + toolchain
 * installée + résultats de tests présents). Aucune valeur importante n'est
 * recopiée à la main → plus de commit/version/comptes contradictoires entre
 * documents.
 *
 * Usage : node scripts/generate-release-manifest.mjs [--check]
 *   (sans arg) : (ré)génère release-manifest.json
 *   --check    : échoue si le manifeste est absent ou si son gitCommit ne
 *                correspond pas au HEAD courant (garde CI anti-obsolescence).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = path.join(ROOT, 'release-manifest.json')

/**
 * Vrai seulement si ROOT EST la racine du dépôt git.
 *
 * Sans cette garde, `git -C ROOT …` répond pour un dépôt ENGLOBANT : un dossier
 * de travail extrait d'un ZIP sous un répertoire personnel lui-même versionné
 * (cas réel rencontré le 2026-10-20 : `C:/Users/<user>/.git`, le projet n'ayant
 * aucun `.git` propre et n'étant pas même suivi) faisait écrire dans le
 * manifeste le commit de CE dépôt personnel. L'installateur se retrouvait donc
 * « rattaché » à une révision qui ne contient pas une ligne du code livré.
 *
 * Une traçabilité fausse est plus nuisible qu'une traçabilité absente : elle a
 * l'apparence d'une preuve. On déclare donc `git: null` et on le dit.
 */
function racineDeDepot() {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const norm = (c) => {
      const reel = realpathSync.native(c)
      return process.platform === 'win32' ? reel.toLowerCase() : reel
    }
    return norm(top) === norm(ROOT)
  } catch { return false }
}

const DANS_DEPOT = racineDeDepot()

function git(args) {
  // Hors racine de dépôt : aucune donnée git n'est LÉGITIME pour ce dossier.
  if (!DANS_DEPOT) return null
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim() } catch { return null }
}
function pkgVersion(name) {
  try { return JSON.parse(readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version } catch { return null }
}
function npmVersion() {
  try { return execFileSync('npm', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim() } catch { return null }
}

function readTestCounts() {
  // SOURCE UNIQUE : la baseline machine (artifacts/verification/baseline.json),
  // régénérée par la porte de release et gardée cohérente avec le doc canonique
  // par check-docs-consistency. On ne duplique PAS le comptage ici (pas de 3e
  // source divergente). null si la baseline est absente.
  const p = path.join(ROOT, 'artifacts', 'verification', 'baseline.json')
  if (!existsSync(p)) return null
  try {
    const t = JSON.parse(readFileSync(p, 'utf8')).tests
    if (!t) return null
    return { total: t.total ?? null, passed: t.passed ?? null, failed: t.failed ?? null, skipped: t.skipped ?? null, source: 'artifacts/verification/baseline.json' }
  } catch { return null }
}

function build(now) {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const b = pkg.build || {}
  const dirty = (git(['status', '--porcelain']) || '').length > 0
  const commit = git(['rev-parse', 'HEAD'])
  return {
    productName: b.productName ?? pkg.name ?? null,
    packageVersion: pkg.version ?? null,
    appId: b.appId ?? null,
    // Hors racine de dépôt : `null` franc. `dirty: false` laisserait croire à un
    // arbre propre alors qu'on ne sait RIEN de la provenance du code.
    git: DANS_DEPOT
      ? {
          branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
          commit,
          shortCommit: commit ? commit.slice(0, 9) : null,
          dirty,
        }
      : null,
    buildId: commit ? `${pkg.version}+${commit.slice(0, 9)}${dirty ? '.dirty' : ''}` : null,
    generatedAt: now,
    environment: { os: `${process.platform} ${process.arch}`, node: process.version, npm: npmVersion() },
    toolchain: {
      next: pkgVersion('next'),
      react: pkgVersion('react'),
      electron: pkgVersion('electron'),
      prisma: pkgVersion('prisma') ?? pkgVersion('@prisma/client'),
    },
    tests: readTestCounts(),
    note:
      'Généré automatiquement (scripts/generate-release-manifest.mjs) à partir de ' +
      'git + package.json + toolchain installée. Ne pas éditer à la main. ' +
      'tests=null si artifacts/verification/test-results.json est absent (lancer la suite).' +
      (DANS_DEPOT
        ? ''
        : ' TRAÇABILITÉ GIT INDISPONIBLE : ce dossier n’est pas la racine d’un dépôt git ' +
          '(copie extraite d’une archive). Aucun commit n’est rattachable à cet artefact ; ' +
          'construire depuis un clone du dépôt pour obtenir un buildId rattachable.'),
  }
}

const isCheck = process.argv.includes('--check')

if (isCheck) {
  if (!existsSync(MANIFEST)) { console.error('❌ release-manifest.json absent — lancer: node scripts/generate-release-manifest.mjs'); process.exit(1) }
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  // Hors dépôt, il n'y a pas de HEAD à comparer. Le dire — ni planter sur un
  // `null.slice`, ni afficher un ✅ qui n'atteste de rien.
  if (!DANS_DEPOT) {
    if (m.git !== null) {
      console.error('❌ release-manifest.json porte un commit alors que ce dossier n’est pas la racine d’un dépôt git : régénérez-le (traçabilité emprunté à un dépôt englobant).')
      process.exit(1)
    }
    console.log('⚠️  release-manifest.json présent, SANS traçabilité git (dossier hors dépôt) — non rattachable à une révision.')
    process.exit(0)
  }
  const head = git(['rev-parse', 'HEAD'])
  if (m.git?.commit !== head) {
    console.error(`❌ release-manifest.json périmé : commit ${m.git?.commit?.slice(0,9)} ≠ HEAD ${head?.slice(0,9)}. Régénérez-le.`)
    process.exit(1)
  }
  console.log(`✅ release-manifest.json à jour (commit ${head.slice(0, 9)}).`)
  process.exit(0)
}

// Génération. `now` : passé via GF_MANIFEST_NOW si fourni (reproductibilité CI),
// sinon horodatage courant (script CLI — new Date() autorisé ici).
const now = process.env.GF_MANIFEST_NOW || new Date().toISOString()
const manifest = build(now)
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
console.log(manifest.buildId
  ? `✅ release-manifest.json généré : ${manifest.buildId}`
  : '⚠️  release-manifest.json généré SANS buildId : dossier hors racine de dépôt git, '
    + 'artefact non rattachable à une révision (voir le champ `note`).')
