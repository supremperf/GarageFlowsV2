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

function run(name, cmd, opts = {}) {
  const { mandatory = true, env = {}, skip = false, skipReason = '' } = opts
  if (skip) {
    results.push({ name, status: 'NON EXÉCUTÉ', mandatory: false, note: skipReason })
    return
  }
  const started = Date.now()
  process.stdout.write(`▶ ${name}… `)
  const r = spawnSync('sh', ['-c', cmd], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
  })
  const ok = r.status === 0
  const secs = ((Date.now() - started) / 1000).toFixed(0)
  console.log(ok ? `OK (${secs}s)` : `ÉCHEC (${secs}s)`)
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
//    Émet le rapport JSON et RÉGÉNÈRE la baseline machine (comptes de tests) —
//    en un seul passage de la suite (pas de double exécution).
run('Suite de tests (vitest) + baseline machine', FAST
  ? 'npm test'
  : 'npx vitest run --reporter=json --outputFile=artifacts/verification/test-results.json && node scripts/generate-verification-baseline.mjs')

// 4b. Cohérence documentaire CONTRE la baseline fraîchement régénérée : échoue
//     si un document présente un compte de tests / une source canonique
//     divergents des mesures réelles (anti-divergence de due diligence).
run('Cohérence documentaire (post-baseline)', 'node scripts/check-docs-consistency.mjs', { skip: FAST, skipReason: '--fast (déjà couvert par check:consistency)' })

// 5-6. Tests conditionnels sur infrastructures réelles
run('Tests PostgreSQL réels (concurrence numérotation/stock/licences/sessions)',
  'npx vitest run src/lib/__tests__/document-numbering.postgres.int.test.ts src/lib/__tests__/stock-concurrency.postgres.int.test.ts src/lib/__tests__/license-devices.postgres.int.test.ts src/lib/__tests__/licensed-session.postgres.int.test.ts',
  { skip: !PG, skipReason: 'TEST_POSTGRES_URL non fourni', mandatory: !!PG })
run('Migrations PostgreSQL sur base neuve + smoke test',
  `sh -c 'psql "$TEST_POSTGRES_URL" -c "DROP DATABASE IF EXISTS gf_gate_check" -c "CREATE DATABASE gf_gate_check" >/dev/null && DATABASE_URL="\${TEST_POSTGRES_URL%/*}/gf_gate_check" DIRECT_URL="\${TEST_POSTGRES_URL%/*}/gf_gate_check" node scripts/validate-server-db.js'`,
  { skip: !PG, skipReason: 'TEST_POSTGRES_URL non fourni', mandatory: !!PG })
run('Rate-limit distribué multi-instance (Redis réel)',
  'npx vitest run src/lib/__tests__/rate-limit-multi-instance.int.test.ts',
  { skip: !REDIS, skipReason: 'TEST_REDIS_URL non fourni', mandatory: !!REDIS })

// 7. Audit de dépendances de production (porte bloquante, dérogations datées)
run('Audit dépendances production (high/critical)', 'node scripts/audit-ci.js')

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
