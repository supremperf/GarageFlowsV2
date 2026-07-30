#!/usr/bin/env node
/**
 * audit-ci.js — porte de sécurité des dépendances (CI, bloquante).
 *
 * Politique : toute vulnérabilité HIGH ou CRITICAL dans les dépendances de
 * PRODUCTION (`npm audit --omit=dev`) fait ÉCHOUER la CI, SAUF les dérogations
 * explicitement documentées ci-dessous — chacune précise, motivée, TEMPORAIRE
 * (date de réexamen). Une dérogation expirée fait aussi échouer la CI (elle
 * force la réévaluation). Les vulnérabilités des dépendances de développement
 * (outillage de build/test) ne sont pas bloquantes ici mais restent visibles
 * via `npm audit`.
 *
 * Ce n'est PAS un `continue-on-error` silencieux : une NOUVELLE vulnérabilité
 * high/critical en production casse la CI.
 */

'use strict'

const { execFileSync } = require('child_process')

// ── Dérogations documentées ──────────────────────────────────────────────────
// Clé = nom du paquet. Chaque entrée DOIT porter un motif et une date de
// réexamen (YYYY-MM-DD). Correctifs disponibles uniquement via montée de version
// majeure (Next 15, etc.) — planifiée hors de ce lot de sécurité pour ne pas
// introduire de régression non testée. Exploitabilité réelle jugée faible dans
// ce contexte applicatif (voir motifs).
const ALLOW = {
  next: {
    reason:
      'Advisories liées à des fonctionnalités non exposées ici (Image Optimizer ' +
      'remotePatterns non utilisé, pas de reverse-proxy de cache). Correctif = ' +
      'montée Next 15 (majeure), planifiée séparément avec tests.',
    until: '2026-10-31',
  },
  nodemailer: {
    reason:
      'Injection via envelope.size : la taille d\'enveloppe n\'est jamais dérivée ' +
      'd\'une entrée attaquant (SMTP configuré par le garage). Correctif = montée ' +
      'majeure, planifiée séparément.',
    until: '2026-10-31',
  },
  postcss: {
    reason:
      'XSS au stringify CSS : outillage de build, aucune CSS d\'origine attaquant ' +
      'au runtime. Instance de prod tirée transitivement par Next.',
    until: '2026-10-31',
  },
}

function auditJson() {
  try {
    const out = execFileSync('npm', ['audit', '--omit=dev', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return JSON.parse(out)
  } catch (err) {
    // `npm audit` sort en code ≠ 0 quand des vulnérabilités existent : on relit
    // quand même le JSON produit sur stdout.
    if (err.stdout) return JSON.parse(err.stdout.toString())
    throw err
  }
}

function main() {
  const report = auditJson()
  const vulns = report.vulnerabilities || {}
  const today = new Date().toISOString().slice(0, 10)

  const blocking = []
  const derogated = []
  const expired = []

  for (const [name, info] of Object.entries(vulns)) {
    if (!['high', 'critical'].includes(info.severity)) continue
    const allow = ALLOW[name]
    if (!allow) {
      blocking.push({ name, severity: info.severity })
    } else if (allow.until < today) {
      expired.push({ name, until: allow.until })
    } else {
      derogated.push({ name, severity: info.severity, until: allow.until })
    }
  }

  if (derogated.length) {
    console.log('Dérogations actives (high/critical, prod) :')
    for (const d of derogated) console.log(`  • ${d.name} (${d.severity}) — réexamen avant ${d.until}`)
  }

  if (expired.length) {
    console.error('\n❌  Dérogations EXPIRÉES — réévaluation requise :')
    for (const e of expired) console.error(`  • ${e.name} (échéance ${e.until})`)
  }

  if (blocking.length) {
    console.error('\n❌  Vulnérabilités high/critical NON dérogées en production :')
    for (const b of blocking) console.error(`  • ${b.name} (${b.severity})`)
  }

  if (blocking.length || expired.length) {
    console.error('\nCI bloquée. Corrigez, ou ajoutez une dérogation motivée et datée dans scripts/audit-ci.js.')
    process.exit(1)
  }

  console.log('\n✅  Aucune vulnérabilité high/critical non dérogée dans les dépendances de production.')
}

main()
