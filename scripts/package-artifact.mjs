#!/usr/bin/env node
/**
 * package-artifact — produit un ARTEFACT DE DISTRIBUTION source RÉEL, reproductible
 * et rattachable à son commit, puis (optionnel) le VÉRIFIE de bout en bout.
 *
 * Ce que fait le script :
 *   1. génère `release-manifest.json` (identité de build : commit, versions, toolchain) ;
 *   2. `git archive` de HEAD au format ZIP — UNIQUEMENT les fichiers SUIVIS
 *      (aucun `.env` de dev, aucun `node_modules`, aucun secret non suivi) ;
 *   3. INJECTE le manifeste dans le ZIP (`git archive --add-file`) → l'archive
 *      distribuée reste rattachable à son code SANS `.git` ;
 *   4. calcule le SHA-256 de l'artefact et écrit le sidecar `<zip>.sha256` ;
 *   5. `--verify` : extrait l'archive dans un dossier SANS `.git` et exécute le
 *      vrai `scripts/verify-artifact.mjs` en MODE ARTIFACT — échoue (exit 1) si
 *      l'artefact n'est pas conforme (manifeste absent, version incohérente,
 *      fuite `.env`, fichier critique manquant).
 *
 * Ceci est l'artefact SOURCE (celui que `verify-artifact.mjs` sait vérifier).
 * L'installateur Windows NSIS (electron-builder) reste une étape EXTERNE (Windows
 * requis, cf. EXTERNAL_BLOCKERS) ; ce script n'en tient pas lieu et ne le prétend pas.
 *
 * Usage :
 *   node scripts/package-artifact.mjs            # produit le ZIP + .sha256
 *   node scripts/package-artifact.mjs --verify   # + extraction + verify-artifact
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, mkdtempSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'dist-artifact')
const VERIFY = process.argv.includes('--verify')

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}
function step(msg) { console.log(`\n▶ ${msg}`) }
function ok(msg) { console.log(`  ✓ ${msg}`) }

// ── 1. manifeste d'identité de build ────────────────────────────────────────
step('Génération du manifeste de release')
execFileSync('node', ['scripts/generate-release-manifest.mjs'], { cwd: ROOT, stdio: 'inherit' })
const manifestPath = path.join(ROOT, 'release-manifest.json')
if (!existsSync(manifestPath)) {
  console.error('❌ release-manifest.json non généré — arrêt.')
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const version = manifest.packageVersion
const commit = git(['rev-parse', 'HEAD'])
const shortCommit = commit.slice(0, 9)
ok(`${manifest.productName} ${version} — commit ${shortCommit}`)

// ── 2+3. git archive (fichiers suivis) + injection du manifeste ─────────────
step('Construction de l\'artefact (git archive HEAD + manifeste injecté)')
mkdirSync(OUT_DIR, { recursive: true })
const zipPath = path.join(OUT_DIR, `garageflows-${version}-${shortCommit}.zip`)
if (existsSync(zipPath)) rmSync(zipPath)
// --add-file place release-manifest.json à la RACINE de l'archive (là où
// verify-artifact.mjs le cherche). --worktree-attributes respecte .gitattributes.
git(['archive', '--format=zip', '--add-file=release-manifest.json', '-o', zipPath, 'HEAD'])
const zipBuf = readFileSync(zipPath)
ok(`ZIP écrit : ${path.relative(ROOT, zipPath)} (${(zipBuf.length / 1024).toFixed(0)} Kio)`)

// ── 4. SHA-256 ──────────────────────────────────────────────────────────────
step('Empreinte SHA-256 de l\'artefact')
const sha = createHash('sha256').update(zipBuf).digest('hex')
const shaLine = `${sha}  ${path.basename(zipPath)}\n`
writeFileSync(`${zipPath}.sha256`, shaLine)
ok(`SHA-256 : ${sha}`)
ok(`Sidecar : ${path.relative(ROOT, zipPath)}.sha256`)

// ── 5. vérification de bout en bout (extraction SANS .git → verify-artifact) ─
if (VERIFY) {
  step('Vérification : extraction (sans .git) + verify-artifact en mode artifact')
  const tmp = mkdtempSync(path.join(tmpdir(), 'gf-artifact-'))
  try {
    // Extraction via Node (unzip natif). On relit chaque entrée du ZIP.
    execFileSync('node', ['scripts/unzip-into.mjs', zipPath, tmp], { cwd: ROOT, stdio: 'inherit' })
    if (existsSync(path.join(tmp, '.git'))) {
      console.error('❌ L\'extraction contient un .git — ce n\'est pas un vrai test de mode artifact.')
      process.exit(1)
    }
    ok('Arbre extrait SANS .git (mode artifact réel)')
    // Exécute le VRAI vérificateur DEPUIS l'arbre extrait.
    execFileSync('node', [path.join(tmp, 'scripts', 'verify-artifact.mjs')], { cwd: tmp, stdio: 'inherit' })
    ok('verify-artifact : artefact conforme et rattachable (mode artifact)')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

console.log(`\n✅ Artefact prêt : ${path.relative(ROOT, zipPath)} (+ .sha256)`)
