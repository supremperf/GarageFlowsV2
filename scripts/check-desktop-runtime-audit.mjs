#!/usr/bin/env node
/**
 * check-desktop-runtime-audit — porte de sécurité du RUNTIME EMPAQUETÉ DESKTOP.
 *
 * Pourquoi cette porte existe (défaut corrigé) : `scripts/audit-ci.js` audite
 * `npm audit --omit=dev`, ce qui couvre le runtime WEB/PWA (les `dependencies`
 * embarquées dans le serveur Next standalone), MAIS PAS Electron : Electron est
 * classé en `devDependencies` alors qu'il EST le runtime réellement distribué
 * dans l'application Windows. Une release pouvait donc paraître verte tout en
 * ignorant les vulnérabilités d'Electron.
 *
 * Portée : cette porte complète audit-ci.js. audit-ci = « Web Runtime Security »
 * (deps de prod). Celle-ci = « Desktop Packaged Runtime Security » : les paquets
 * réellement embarqués dans l'app Electron EN PLUS des deps de prod — c.-à-d.
 * Electron lui-même (les modules `electron/*.js` ne requièrent que des builtins
 * Node + des modules LOCAUX ; aucune dépendance native npm supplémentaire n'est
 * empaquetée, cf. inventaire ci-dessous). Ensemble, les deux portes couvrent
 * prod ∪ electron = tout ce qui atterrit sur le poste de l'utilisateur.
 *
 * Politique : toute vulnérabilité HIGH/CRITICAL du runtime desktop empaqueté fait
 * ÉCHOUER la release, SAUF dérogation explicite, motivée et DATÉE (réexamen). Une
 * dérogation expirée fait aussi échouer (force la réévaluation). Jamais de
 * `|| true` : c'est une porte bloquante.
 */
import { execFileSync } from 'node:child_process'

const IS_WINDOWS = process.platform === 'win32'

// Paquets réellement EMBARQUÉS dans l'app desktop mais classés hors `dependencies`
// (donc invisibles pour `npm audit --omit=dev`). Electron = le runtime lui-même.
const PACKAGED_RUNTIME_EXTRA = new Set(['electron'])

// ── Dérogations documentées (runtime desktop) ────────────────────────────────
// Chaque entrée : motif + date de réexamen (YYYY-MM-DD) + référence.
const ALLOW = {
  electron: {
    reason:
      'Electron 31.7.7 agrège des advisories (correctif = Electron 43, montée MAJEURE ' +
      'nécessitant une validation de packaging + lancement Windows réels — voir ' +
      'EXTERNAL_BLOCKERS.md #3). Exploitabilité réduite dans CE contexte : ' +
      'contextIsolation+sandbox+nodeIntegration:false+webSecurity, Fuses activés, ' +
      'la fenêtre ne charge QUE le contenu local de l\'app (aucun contenu web tiers, ' +
      'aucune extension), nav-guard confine la navigation, setWindowOpenHandler ' +
      'refuse tout hôte hors allowlist HTTPS. Aucune correction mineure disponible ' +
      '(fix isSemVerMajor).',
    until: '2026-10-31',
    ref: 'https://github.com/advisories?query=electron (voir GHSA agrégés)',
  },
}

function fullAuditJson() {
  try {
    const out = execFileSync('npm', ['audit', '--json'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: IS_WINDOWS,
    })
    return JSON.parse(out)
  } catch (err) {
    if (err.stdout) return JSON.parse(err.stdout.toString())
    throw err
  }
}

function main() {
  const report = fullAuditJson()
  const vulns = report.vulnerabilities || {}
  const today = new Date().toISOString().slice(0, 10)

  const blocking = [], derogated = [], expired = []

  for (const [name, info] of Object.entries(vulns)) {
    if (!PACKAGED_RUNTIME_EXTRA.has(name)) continue
    if (!['high', 'critical'].includes(info.severity)) continue
    const allow = ALLOW[name]
    if (!allow) blocking.push({ name, severity: info.severity, range: info.range })
    else if (allow.until < today) expired.push({ name, until: allow.until })
    else derogated.push({ name, severity: info.severity, until: allow.until })
  }

  console.log('Runtime desktop empaqueté audité (en plus des deps de prod) : ' +
    [...PACKAGED_RUNTIME_EXTRA].join(', '))

  if (derogated.length) {
    console.log('\nDérogations actives (high/critical, runtime desktop) :')
    for (const d of derogated) console.log(`  • ${d.name} (${d.severity}) — réexamen avant ${d.until}`)
  }
  if (expired.length) {
    console.error('\n❌  Dérogations EXPIRÉES — réévaluation requise :')
    for (const e of expired) console.error(`  • ${e.name} (échéance ${e.until})`)
  }
  if (blocking.length) {
    console.error('\n❌  Vulnérabilités high/critical NON dérogées dans le runtime desktop empaqueté :')
    for (const b of blocking) console.error(`  • ${b.name} (${b.severity}) ${b.range || ''}`)
  }
  if (blocking.length || expired.length) {
    console.error('\nRelease bloquée. Corrigez (montée de version), ou ajoutez une dérogation ' +
      'motivée et datée dans scripts/check-desktop-runtime-audit.mjs.')
    process.exit(1)
  }
  console.log('\n✅  Runtime desktop empaqueté : aucune vulnérabilité high/critical non dérogée.')
}

main()
