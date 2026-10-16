'use strict'
/**
 * Chaîne de build/dist — non-régression sur la CAUSE RACINE du « server.js NOT
 * found » et sur les garde-fous de publication.
 *
 * Historique réel : `next build` réussissait, puis `scripts/post-build.js`
 * échouait sur « ❌ server.js NOT found — make sure you ran: npm run build ».
 * Cause : `output: 'standalone'` sans `outputFileTracingRoot`. Next.js déduisait
 * la racine de workspace d'un `package-lock.json` situé dans un dossier PARENT
 * du dépôt (C:\Users\<nom>\package-lock.json) et écrivait l'application sous
 * `.next/standalone/Desktop/GarageFlowsV2-<branche>/`. Le script cherchait le
 * fichier à la racine du dossier standalone : introuvable, alors que la
 * compilation était bonne — et l'installateur aurait embarqué un dossier
 * imbriqué, donc une application inlançable.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const root = path.resolve(__dirname, '..')
const layout = require('../scripts/lib/standalone-layout.cjs')

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-standalone-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('next.config.mjs verrouille la racine de tracing sur le dossier du projet', () => {
  const source = fs.readFileSync(path.join(root, 'next.config.mjs'), 'utf8')
  assert.match(source, /output:\s*'standalone'/, 'la sortie autonome reste activée')
  assert.match(source, /outputFileTracingRoot:\s*PROJECT_ROOT/,
    'sans outputFileTracingRoot, un lockfile parent déplace server.js hors de .next/standalone')
  // La valeur doit désigner le dossier du projet, pas un chemin deviné.
  assert.match(source, /const PROJECT_ROOT = dirname\(fileURLToPath\(import\.meta\.url\)\)/)
  assert.match(source, /We detected multiple lockfiles/, 'la cause documentée reste dans le fichier')
})

test('sortie saine : server.js à la racine, ressources au bon endroit', t => {
  const dir = fixture(t)
  const standalone = path.join(dir, '.next', 'standalone')
  fs.mkdirSync(path.join(standalone, '.next', 'static'), { recursive: true })
  fs.writeFileSync(path.join(standalone, 'server.js'), '// serveur Next')

  const result = layout.inspectStandaloneLayout(dir)
  assert.equal(result.ok, true)
  assert.equal(result.error, null)
  assert.equal(result.nested, '')
  assert.equal(result.appDir, standalone)
  assert.equal(layout.standaloneAppDir(standalone), standalone)
})

test('sortie IMBRIQUÉE (lockfile parent) : refusée avec la cause exacte, jamais « server.js NOT found »', t => {
  const dir = fixture(t)
  const standalone = path.join(dir, '.next', 'standalone')
  const imbrique = path.join(standalone, 'Desktop', 'GarageFlowsV2-arena')
  fs.mkdirSync(imbrique, { recursive: true })
  fs.writeFileSync(path.join(imbrique, 'server.js'), '// serveur Next')

  const result = layout.inspectStandaloneLayout(dir)
  assert.equal(result.ok, false, 'une sortie imbriquée ne doit jamais être empaquetée')
  assert.equal(result.serverJs, path.join(imbrique, 'server.js'), 'le fichier est bien LOCALISÉ')
  assert.equal(result.nested, 'Desktop/GarageFlowsV2-arena')
  assert.match(result.error, /IMBRIQUÉE/)
  assert.match(result.error, /outputFileTracingRoot/)
  assert.match(result.error, /package-lock\.json/)
  // Les copies continuent de viser le dossier réellement produit.
  assert.equal(layout.standaloneAppDir(standalone), imbrique)
})

test('sortie absente ou sans server.js : diagnostic explicite', t => {
  const vide = fixture(t)
  assert.equal(layout.inspectStandaloneLayout(vide).ok, false)
  assert.match(layout.inspectStandaloneLayout(vide).error, /\.next\/standalone absent/)

  const dir = fixture(t)
  fs.mkdirSync(path.join(dir, '.next', 'standalone', '.next', 'static'), { recursive: true })
  const result = layout.inspectStandaloneLayout(dir)
  assert.equal(result.ok, false)
  assert.match(result.error, /server\.js introuvable/)
})

test('détecte les copies périmées de l’application à purger avant empaquetage', t => {
  const dir = fixture(t)
  const standalone = path.join(dir, '.next', 'standalone')
  const bon = standalone
  const obsolete = path.join(standalone, 'Desktop', 'AncienProjet')
  fs.mkdirSync(obsolete, { recursive: true })
  fs.mkdirSync(path.join(standalone, 'node_modules', 'next'), { recursive: true })
  fs.writeFileSync(path.join(bon, 'server.js'), '// serveur Next')
  fs.writeFileSync(path.join(obsolete, 'server.js'), '// ancienne copie')
  fs.writeFileSync(path.join(standalone, 'node_modules', 'next', 'server.js'), '// dépendance, jamais l’application')

  const obsoletes = layout.staleAppDirs(standalone, bon)
  assert.deepEqual(obsoletes, [obsolete], 'node_modules est ignoré, la copie périmée est listée')
})

test('le post-build dirige les copies vers le dossier d’application (pas un chemin supposé)', () => {
  const source = fs.readFileSync(path.join(root, 'scripts', 'post-build.js'), 'utf8')
  assert.match(source, /inspectStandaloneLayout\(ROOT\)/)
  assert.match(source, /const APP_DIR = layout\.appDir/)
  assert.match(source, /staleAppDirs\(/)
  // Les chemins fixes historiques sous .next/standalone ne doivent plus servir de cible.
  assert.ok(!/path\.join\(ROOT, '\.next', 'standalone', '\.next', 'static'\)/.test(source), 'cible statique historique retirée')
  assert.ok(!/const serverJs = path\.join\(ROOT, '\.next', 'standalone', 'server\.js'\)/.test(source), 'vérification par chemin fixe remplacée par la résolution réelle')
})

test('le post-build ne casse pas les builds cloud (Vercel) et distingue l’empaquetage desktop', () => {
  const source = fs.readFileSync(path.join(root, 'scripts', 'post-build.js'), 'utf8')
  assert.match(source, /process\.env\.VERCEL/, 'un build Vercel ne doit pas exiger les ressources desktop')
  assert.match(source, /GF_PACKAGE_DESKTOP/, 'l’empaquetage desktop est déclaré explicitement')
})

test('package.json : dist vérifie tout et échoue clairement à chaque étape', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const dist = pkg.scripts.dist
  const ordre = ['preflight:release', 'GF_PACKAGE_DESKTOP=1', 'npm run build', 'electron-builder', 'check:artifact-secrets', 'check:artifact-fuses', 'verify:installer']
  let curseur = -1
  for (const etape of ordre) {
    const position = dist.indexOf(etape)
    assert.ok(position > curseur, `« ${etape} » doit apparaître après l’étape précédente dans npm run dist`)
    curseur = position
  }
  assert.equal(pkg.scripts.postbuild, 'node scripts/post-build.js', 'npm run build doit produire la sortie empaquetable')
  assert.equal(pkg.scripts['verify:standalone'], 'node scripts/verify-standalone-build.cjs')
  assert.equal(pkg.scripts['preflight:release'], 'node scripts/preflight-release.cjs')
  assert.equal(pkg.scripts['verify:installer'], 'node scripts/verify-installer.cjs')
  for (const fichier of ['scripts/post-build.js', 'scripts/preflight-release.cjs', 'scripts/verify-standalone-build.cjs', 'scripts/verify-installer.cjs', 'scripts/lib/standalone-layout.cjs']) {
    assert.ok(fs.existsSync(path.join(root, fichier)), `${fichier} doit exister`)
  }
})

test('release:sign explique quoi fournir au lieu d’un « --file obligatoire » sec', () => {
  const source = fs.readFileSync(path.join(root, 'scripts', 'sign-release-manifest.mjs'), 'utf8')
  assert.match(source, /function installeurDetecte/)
  assert.match(source, /function argumentsManquants/)
  assert.match(source, /npm run release:sign -- --file/)
  assert.ok(!/mourir\(`--file <chemin de l'installeur> est obligatoire/.test(source), 'message d’origine remplacé')
  // Les contrôles de cohérence et l’interdiction de signer un fichier absent restent intacts.
  assert.match(source, /--allow-mismatch pour signer malgré tout, en connaissance de cause/)
  assert.match(source, /Fichier vide/)
})
