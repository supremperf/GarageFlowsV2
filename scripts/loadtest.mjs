#!/usr/bin/env node
/**
 * loadtest.mjs — test de charge reproductible (à exécuter contre du STAGING).
 *
 * AUCUN résultat de charge n'est publié dans ce dépôt tant qu'une exécution
 * réelle n'a pas eu lieu sur l'infrastructure cible (règle anti-invention).
 *
 * Usage :  BASE_URL=https://staging.example npm exec -- node scripts/loadtest.mjs [connexions] [durée_s]
 * Paliers recommandés : 10 → 50 → 100 → 500 connexions ; mesurer p50/p95/p99,
 * erreurs, CPU/mémoire (côté hébergeur), latence BDD (sonde /api/admin/monitoring).
 * Cibles publiques sûres : /login, /api/health (les routes authentifiées
 * nécessitent un jeton de session — à injecter via HEADER_COOKIE).
 */
import { spawnSync } from 'node:child_process'
const base = process.env.BASE_URL
if (!base) { console.error('BASE_URL requis (JAMAIS la production).'); process.exit(1) }
if (/garageflows\.fr/.test(base) && process.env.ALLOW_PROD !== 'explicitly-yes') {
  console.error('Refus : cible ressemblant à la production (garde anti-accident).'); process.exit(1)
}
const conns = process.argv[2] ?? '50'
const dur = process.argv[3] ?? '30'
for (const path of ['/api/health', '/login']) {
  console.log(`\n═══ ${path} — ${conns} connexions, ${dur}s ═══`)
  const r = spawnSync('npx', ['--yes', 'autocannon', '-c', conns, '-d', dur, '--latency',
    ...(process.env.HEADER_COOKIE ? ['-H', `cookie: ${process.env.HEADER_COOKIE}`] : []),
    `${base}${path}`], { stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
