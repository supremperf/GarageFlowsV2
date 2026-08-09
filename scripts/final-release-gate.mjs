#!/usr/bin/env node
/**
 * final-release-gate.mjs — porte de sortie V13 (Production Candidate).
 *
 * Enchaîne TOUTES les vérifications exécutables dans l'environnement courant et
 * ne renvoie 0 que si chaque contrôle OBLIGATOIRE passe. Les contrôles
 * CONDITIONNELS (PostgreSQL réel, Redis réel) s'activent automatiquement quand
 * leur environnement est fourni — sinon ils sont AFFICHÉS comme non exécutés
 * (jamais comptés « verts » silencieusement : aucun résultat n'est inventé).
 *
 * Usage :
 *   node scripts/final-release-gate.mjs            # tout (build inclus)
 *   node scripts/final-release-gate.mjs --fast     # sans build ni e2e (pré-PR)
 *   TEST_POSTGRES_URL=… TEST_REDIS_URL=… node scripts/final-release-gate.mjs
 *
 * Sortie : tableau récapitulatif + code 0/1. Pensé pour être le DERNIER mot
 * avant un tag de release — et la commande unique à montrer en due diligence.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const FAST = process.argv.includes('--fast')
const results = []

/**
 * Exécute une étape.
 *
 * `shell: true` plutôt que `sh -c` : GarageFlows est un produit WINDOWS, et `sh`
 * n'existe pas sur un PATH Windows standard. Le lancement échouait donc pour les
 * DIX étapes à la fois, chacune affichant « ÉCHEC — exit null » et une sortie
 * `undefined` — la porte censée être le dernier mot avant une release était
 * inutilisable sur sa propre plateforme cible, et son échec de lancement était
 * visuellement indiscernable d'un vrai échec de contrôle. Node choisit ici
 * cmd.exe sous Windows et /bin/sh ailleurs ; les commandes n'utilisent que `&&`,
 * compris par les deux.
 *
 * `argv` (tableau) lance sans shell du tout : réservé aux étapes dont les
 * arguments ne doivent traverser aucune interprétation.
 */
function run(name, cmd, opts = {}) {
  const { mandatory = true, env = {}, skip = false, skipReason = '', argv = null } = opts
  if (skip) {
    results.push({ name, status: 'NON EXÉCUTÉ', mandatory: false, note: skipReason })
    return
  }
  const started = Date.now()
  process.stdout.write(`▶ ${name}… `)
  const spawnOpts = {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
  }
  const r = argv
    ? spawnSync(argv[0], argv.slice(1), spawnOpts)
    : spawnSync(cmd, { ...spawnOpts, shell: true })
  const ok = r.status === 0
  const secs = ((Date.now() - started) / 1000).toFixed(0)
  console.log(ok ? `OK (${secs}s)` : `ÉCHEC (${secs}s)`)

  // Un processus qui n'a pas pu DÉMARRER (status null + r.error) n'est pas un
  // contrôle en échec : le dire explicitement, jamais le maquiller en « exit null ».
  if (!ok && r.error) {
    console.error(`    LANCEMENT IMPOSSIBLE : ${r.error.message}`)
    results.push({ name, status: 'ÉCHEC', mandatory, note: `lancement impossible (${r.error.code || r.error.name})` })
    return
  }
  if (!ok) {
    const tail = `${r.stdout}`.split('\n').slice(-15).join('\n') + '\n' + `${r.stderr}`.split('\n').slice(-15).join('\n')
    console.error(tail.trim().split('\n').map((l) => `    ${l}`).join('\n'))
  }
  results.push({ name, status: ok ? 'OK' : 'ÉCHEC', mandatory, note: ok ? '' : `exit ${r.status}` })
}

const PG = process.env.TEST_POSTGRES_URL
const REDIS = process.env.TEST_REDIS_URL

console.log(`\n════ GarageFlows — FINAL RELEASE GATE${FAST ? ' (--fast)' : ''} ════\n`)

// 1-2. Statique
run('TypeScript (tsc --noEmit)', 'npx tsc --noEmit')
run('ESLint', 'npx next lint --quiet')

// 3. Gardes de cohérence (10 : marque, docs, PWA, monnaie ×3, migrations ×3, fichiers critiques)
run('Gardes de cohérence (check:consistency)', 'npm run check:consistency')

// 4. Tests unitaires + intégration (inclut monnaie, e-invoicing/formats, isolation
//    multi-tenant, autorisation, immuabilité, parcours métier E2E, sauvegardes).
//    Émet le rapport JSON et RÉGÉNÈRE la baseline machine (comptes de tests +
//    toolchain résolue) ET le bloc AUTO de la baseline humaine — en un seul
//    passage de la suite (pas de double exécution ; comptes lus depuis le
//    rapport, jamais codés en dur ici).
// La baseline machine capture la SUITE STANDARD (reproductible partout, sans
// service) : on neutralise TEST_POSTGRES_URL/TEST_REDIS_URL pour CE passage,
// afin que baseline.json ne contienne QUE le compte standard (les suites
// conditionnelles sont des étapes séparées ci-dessous). Le générateur met à jour
// la baseline humaine dans la foulée, AVANT le contrôle de cohérence 4b.
run('Suite de tests (vitest) + baseline machine + baseline humaine', FAST
  ? 'npm test'
  : 'npx vitest run --reporter=json --outputFile=artifacts/verification/test-results.json && node scripts/generate-verification-baseline.mjs',
  { env: { TEST_POSTGRES_URL: '', TEST_REDIS_URL: '' } })

// 4b. Cohérence documentaire CONTRE la baseline fraîchement régénérée : échoue
//     si un document — Y COMPRIS la baseline canonique elle-même — présente un
//     compte de tests ou une version de toolchain résolue divergents des mesures
//     réelles (anti-divergence de due diligence).
run('Cohérence documentaire (post-baseline)', 'node scripts/check-docs-consistency.mjs', { skip: FAST, skipReason: '--fast (déjà couvert par check:consistency)' })

// 5-6. Tests conditionnels sur infrastructures réelles
run('Tests PostgreSQL réels (concurrence numérotation/stock/licences/sessions)',
  'npx vitest run src/lib/__tests__/document-numbering.postgres.int.test.ts src/lib/__tests__/stock-concurrency.postgres.int.test.ts src/lib/__tests__/license-devices.postgres.int.test.ts src/lib/__tests__/licensed-session.postgres.int.test.ts',
  { skip: !PG, skipReason: 'TEST_POSTGRES_URL non fourni', mandatory: !!PG })
run('Migrations PostgreSQL sur base neuve + smoke test', null,
  { argv: [process.execPath, 'scripts/gate-fresh-postgres.mjs'], skip: !PG, skipReason: 'TEST_POSTGRES_URL non fourni', mandatory: !!PG })
run('Rate-limit distribué multi-instance (Redis réel)',
  'npx vitest run src/lib/__tests__/rate-limit-multi-instance.int.test.ts',
  { skip: !REDIS, skipReason: 'TEST_REDIS_URL non fourni', mandatory: !!REDIS })

// 7. Audit de dépendances de production (porte bloquante, dérogations datées)
run('Audit dépendances production (high/critical)', 'node scripts/audit-ci.js')

// 7bis. Audit du RUNTIME DESKTOP EMPAQUETÉ (Electron) — que `--omit=dev` ignore.
// Porte bloquante, dérogations datées (check-desktop-runtime-audit.mjs).
run('Audit runtime desktop empaqueté (Electron)', 'node scripts/check-desktop-runtime-audit.mjs')

// 7ter. Preuve de release : génère le manifeste commit-bound puis vérifie
// l'artefact (identité, cohérence version, absence de .env réel, fichiers
// critiques). Fonctionne aussi hors dépôt via `release:verify-artifact`.
run('Manifeste de release (commit-bound)', 'node scripts/generate-release-manifest.mjs')
run('Vérification d\'artefact (identité + cohérence + secrets)', 'node scripts/verify-artifact.mjs')

// 7quater. Preuve de release SUR ARTEFACT RÉEL : construit le ZIP de
// distribution (git archive HEAD + manifeste injecté + SHA-256), l'extrait dans
// un dossier SANS .git et y exécute verify-artifact en MODE ARTIFACT — prouve la
// chaîne complète (pas seulement en mode dépôt). L'installateur Windows NSIS
// reste EXTERNE (cf. EXTERNAL_BLOCKERS) ; ceci vérifie l'artefact source.
run('Empaquetage + vérification d\'artefact RÉEL (ZIP extrait, sans .git)',
  null, { argv: [process.execPath, 'scripts/package-artifact.mjs', '--verify'] })

// 8-9. Build + budget de perf (sautés en --fast)
run('Build de production (next build)', 'npm run build', {
  skip: FAST, skipReason: '--fast', env: {
    DATABASE_URL: process.env.DATABASE_URL || 'file:./prisma/dev.db',
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || 'gate-build-secret-0123456789abcdefghij',
    NEXTAUTH_URL: process.env.NEXTAUTH_URL || 'http://localhost:4028',
  },
})
run('Budget de performance (bundle client)', 'npm run check:perf-budget', {
  skip: FAST || !existsSync('.next/static'), skipReason: FAST ? '--fast' : '.next absent (lancez le build)',
})

// ── Récapitulatif ─────────────────────────────────────────────────────────────
console.log('\n════ RÉCAPITULATIF ════')
const width = Math.max(...results.map((r) => r.name.length))
for (const r of results) {
  const badge = r.status === 'OK' ? '✅' : r.status === 'ÉCHEC' ? '❌' : '⏭️ '
  console.log(`${badge} ${r.name.padEnd(width)}  ${r.status}${r.note ? ` — ${r.note}` : ''}`)
}
const failed = results.filter((r) => r.status === 'ÉCHEC' && r.mandatory)
const skipped = results.filter((r) => r.status === 'NON EXÉCUTÉ')
if (skipped.length) {
  console.log(`\n⚠ ${skipped.length} contrôle(s) NON EXÉCUTÉ(S) (environnement absent) — ils ne sont PAS réputés verts.`)
}
if (failed.length) {
  console.error(`\n❌ GATE ÉCHOUÉ : ${failed.length} contrôle(s) obligatoire(s) en échec.`)
  process.exit(1)
}
console.log('\n✅ GATE PASSÉ : tous les contrôles obligatoires exécutables sont verts.')
