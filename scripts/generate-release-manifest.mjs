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
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = path.join(ROOT, 'release-manifest.json')

function git(args) {
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
    git: {
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
      commit,
      shortCommit: commit ? commit.slice(0, 9) : null,
      dirty,
    },
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
      'tests=null si artifacts/verification/test-results.json est absent (lancer la suite).',
  }
}

const isCheck = process.argv.includes('--check')

if (isCheck) {
  if (!existsSync(MANIFEST)) { console.error('❌ release-manifest.json absent — lancer: node scripts/generate-release-manifest.mjs'); process.exit(1) }
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'))
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
console.log('✅ release-manifest.json généré :', manifest.buildId)
