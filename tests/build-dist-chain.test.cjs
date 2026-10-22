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

test('le vérificateur standalone analyse la RACINE du projet, pas le dossier standalone', () => {
  // Régression : `inspectStandaloneLayout` ajoute lui-même `.next/standalone`.
  // Lui passer ce dossier construisait `.next/standalone/.next/standalone` et
  // déclarait « dossier absent » sur une sortie SAINE — l’échec exact observé sur
  // l’exécuteur Windows (run 38953330502) après un post-build réussi.
  const source = fs.readFileSync(path.join(root, 'scripts', 'verify-standalone-build.cjs'), 'utf8')
  assert.match(source, /inspectStandaloneLayout\(RACINE\)/)
  assert.ok(!/inspectStandaloneLayout\(STANDALONE\)/.test(source), 'le dossier standalone ne doit plus être passé comme racine')
})

test('la liste des modules d’exécution se résout sans double préfixe node_modules', () => {
  const layout = require(path.join(root, 'scripts', 'lib', 'standalone-layout.cjs'))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-modules-'))
  for (const relatif of layout.MODULES_EXECUTION) {
    fs.mkdirSync(path.dirname(path.join(dir, relatif)), { recursive: true })
    fs.writeFileSync(path.join(dir, relatif), relatif.endsWith('.js') ? '// client généré' : '{"name":"fixture"}')
  }
  // `next-auth` n'est pas un fichier de la sortie : la compilation l'embarque.
  fs.mkdirSync(path.join(dir, '.next', 'server', 'chunks'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.next', 'server', 'chunks', '8858.js'), 'const c="next-auth.session-token";')
  assert.deepEqual(layout.modulesExecutionManquants(dir), [], 'sortie complète : aucun manque')
  assert.ok(layout.MODULES_EXECUTION.every(relatif => !relatif.startsWith('node_modules/node_modules/')), 'aucun chemin composé deux fois')
  assert.ok(layout.MODULES_EXECUTION.includes('node_modules/.prisma/client/index.js'))
  fs.rmSync(path.join(dir, 'node_modules', 'next'), { recursive: true, force: true })
  assert.deepEqual(layout.modulesExecutionManquants(dir), ['node_modules/next/package.json'], 'un module retiré est signalé, et lui seul')
  fs.rmSync(dir, { recursive: true, force: true })
})

/**
 * Arborescence autonome synthétique COMPLÈTE (tous les éléments exigés par
 * `verify-standalone-build.cjs`), pour éprouver le garde-fou lui-même — sain,
 * absent, incomplet — sans dépendre d'une compilation Next.js de plusieurs
 * minutes ni d'un exécuteur Windows.
 */
function arbreStandaloneSain(racine) {
  const app = path.join(racine, '.next', 'standalone')
  fs.mkdirSync(path.join(app, '.next', 'static', 'chunks'), { recursive: true })
  fs.mkdirSync(path.join(app, 'public'), { recursive: true })
  fs.mkdirSync(path.join(app, 'prisma'), { recursive: true })
  fs.mkdirSync(path.join(app, 'keys'), { recursive: true })
  fs.writeFileSync(path.join(app, 'server.js'), `const next = require('next')\n${'// serveur autonome\n'.repeat(80)}`)
  fs.writeFileSync(path.join(app, 'package.json'), '{"name":"garageflow"}')
  fs.writeFileSync(path.join(app, '.next', 'static', 'chunks', 'main.js'), '// chunk')
  fs.writeFileSync(path.join(app, 'public', 'icon.ico'), 'ico')
  fs.writeFileSync(path.join(app, 'prisma', 'schema.prisma'), '// schema')
  fs.writeFileSync(path.join(app, 'keys', 'public.pem'), 'cle publique')
  for (const relatif of require(path.join(root, 'scripts', 'lib', 'standalone-layout.cjs')).MODULES_EXECUTION) {
    const cible = path.join(app, relatif)
    fs.mkdirSync(path.dirname(cible), { recursive: true })
    fs.writeFileSync(cible, relatif.endsWith('.js') ? '// client genere' : '{"name":"x"}')
  }
  // Le client JS seul ne suffit pas : une sortie empaquetable doit contenir
  // au moins une bibliothèque/binaire de requête Prisma natif.
  fs.writeFileSync(path.join(app, 'node_modules', '.prisma', 'client', 'query_engine-windows.dll.node'), 'moteur natif factice')
  // `next-auth` n'est pas copié : la compilation l'embarque (constaté sur une
  // vraie sortie autonome). On reproduit le morceau qui le contient.
  fs.mkdirSync(path.join(app, '.next', 'server', 'chunks'), { recursive: true })
  fs.writeFileSync(path.join(app, '.next', 'server', 'chunks', '8858.js'), 'const c="next-auth.session-token";')
  return racine
}

function executerVerificateur(racine) {
  return require('node:child_process').spawnSync(process.execPath, [path.join(root, 'scripts', 'verify-standalone-build.cjs'), racine], { encoding: 'utf8' })
}

test('verify:standalone ACCEPTE une sortie saine (le garde-fou ne bloque pas un installeur valide)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-standalone-ok-'))
  arbreStandaloneSain(dir)
  const resultat = executerVerificateur(dir)
  assert.equal(resultat.status, 0, `attendu 0, obtenu ${resultat.status}\n${resultat.stderr}`)
  assert.match(resultat.stdout, /Sortie autonome complète/)
  assert.ok(!/absent/.test(resultat.stderr), 'aucun faux « absent » sur une sortie saine')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('verify:standalone REFUSE un client Prisma présent mais sans moteur natif', () => {
  const dir = arbreStandaloneSain(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-standalone-no-engine-')))
  const client = path.join(dir, '.next', 'standalone', 'node_modules', '.prisma', 'client')
  fs.rmSync(path.join(client, 'query_engine-windows.dll.node'))
  assert.ok(fs.existsSync(path.join(client, 'index.js')), 'le client JS reste présent pour reproduire le faux vert')
  const resultat = executerVerificateur(dir)
  assert.equal(resultat.status, 1, `le dossier du client ne doit pas suffire\n${resultat.stdout}\n${resultat.stderr}`)
  assert.match(resultat.stderr, /moteur Prisma natif absent/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('verify:standalone REFUSE une sortie absente, incomplète ou sans moteur Prisma', () => {
  const vide = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-standalone-vide-'))
  const absent = executerVerificateur(vide)
  assert.equal(absent.status, 1)
  assert.match(absent.stderr, /\.next\/standalone absent/)
  fs.rmSync(vide, { recursive: true, force: true })

  const casse = arbreStandaloneSain(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-standalone-casse-')))
  const app = path.join(casse, '.next', 'standalone')
  fs.rmSync(path.join(app, '.next', 'static'), { recursive: true, force: true })
  fs.rmSync(path.join(app, 'public'), { recursive: true, force: true })
  fs.rmSync(path.join(app, 'prisma'), { recursive: true, force: true })
  fs.rmSync(path.join(app, 'node_modules', '.prisma'), { recursive: true, force: true })
  const resultat = executerVerificateur(casse)
  assert.equal(resultat.status, 1)
  for (const attendu of [/ressources statiques .* manquant/, /fichiers publics .* manquant/, /schema\.prisma absent/, /moteur Prisma absent/]) {
    assert.match(resultat.stderr, attendu)
  }
  fs.rmSync(casse, { recursive: true, force: true })
})

test('next-auth est accepté COPIÉ ou EMBARQUÉ, et signalé s’il a disparu des deux côtés', () => {
  const layout = require(path.join(root, 'scripts', 'lib', 'standalone-layout.cjs'))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-embarque-'))
  const app = path.join(dir, '.next', 'standalone')
  for (const relatif of layout.MODULES_EXECUTION) {
    const cible = path.join(app, relatif)
    fs.mkdirSync(path.dirname(cible), { recursive: true })
    fs.writeFileSync(cible, relatif.endsWith('.js') ? '// client genere' : '{"name":"x"}')
  }

  // Cas A — la compilation a embarqué next-auth dans un morceau (cas réel).
  fs.mkdirSync(path.join(app, '.next', 'server', 'chunks'), { recursive: true })
  fs.writeFileSync(path.join(app, '.next', 'server', 'chunks', '8858.js'), 'const c="next-auth.session-token";')
  assert.deepEqual(layout.modulesExecutionManquants(app), [], 'embarqué : rien à signaler')

  // Cas B — le module est physiquement copié (autre stratégie de compilation).
  fs.rmSync(path.join(app, '.next', 'server'), { recursive: true, force: true })
  fs.mkdirSync(path.join(app, 'node_modules', 'next-auth'), { recursive: true })
  fs.writeFileSync(path.join(app, 'node_modules', 'next-auth', 'package.json'), '{"name":"next-auth"}')
  assert.deepEqual(layout.modulesExecutionManquants(app), [], 'copié : rien à signaler')

  // Cas C — ni l'un ni l'autre : la vérification DOIT refuser la sortie.
  fs.rmSync(path.join(app, 'node_modules', 'next-auth'), { recursive: true, force: true })
  assert.deepEqual(layout.modulesExecutionManquants(app), ['(ni copié, ni embarqué) next-auth'])

  fs.rmSync(dir, { recursive: true, force: true })
  assert.deepEqual(layout.MODULES_EMBARQUES.map(m => m.nom), ['next-auth'], 'liste des modules embarqués explicite')
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

test('la chaîne n’essaie JAMAIS de publier une release toute seule', () => {
  // Constaté en CI (run 38957019116) : l’installeur était construit, puis
  // electron-builder déclenchait une publication implicite — « Implicit
  // publishing triggered by CI detection » — et la construction échouait sur
  // « GitHub Personal Access Token is not set ». La publication d’une release
  // est une décision explicite (`npm run release:sign`), jamais un effet de bord
  // de l’empaquetage.
  const dist = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts.dist
  assert.match(dist, /electron-builder --win --x64 --publish never/)
  assert.ok(!/--publish (always|onTag|onTagOrDraft)/.test(dist))
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
