#!/usr/bin/env node
'use strict'

/**
 * Verdict final de production, strictement fail-closed.
 *
 * Entrée : artifacts/verification/production-readiness.json (ou --manifest).
 * Chaque contrôle requis doit avoir le statut `pass`, un code de sortie 0, au
 * moins une preuve textuelle et un marqueur de réussite réellement présent.
 * Les preuves sont couvertes par SHA256SUMS. Un statut blocked/fail/not_executed,
 * une preuve absente/modifiée, un marqueur manquant ou une exigence oubliée
 * impose NON PRÊT POUR LA PRODUCTION.
 *
 * Ce programme ne fabrique aucun résultat et n'exécute aucun service externe.
 * Les opérateurs remplacent un statut uniquement après avoir archivé la sortie
 * réelle de la procédure correspondante, puis régénéré les empreintes.
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const DEFAULT_MANIFEST = 'artifacts/verification/production-readiness.json'
const STATUSES = new Set(['pass', 'fail', 'blocked', 'not_executed'])
const SECTIONS = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'])

// La présence de chaque ID est obligatoire. Retirer une ligne de ce tableau est
// une modification de politique qui doit être relue avec les tests de release.
const REQUIRED_CHECKS = Object.freeze([
  ['repository.base', 'A'],
  ['repository.clean_release', 'A'],
  ['corrections.regressions', 'B'],
  ['tests.vitest', 'C'],
  ['tests.node', 'C'],
  ['tests.config', 'C'],
  ['tests.keygen', 'C'],
  ['tests.ocr_real', 'C'],
  ['tests.static', 'C'],
  ['tests.supply_chain', 'C'],
  ['prisma.native_linux', 'D'],
  ['prisma.native_windows', 'D'],
  ['database.sqlite_runtime', 'D'],
  ['database.postgres_runtime', 'D'],
  ['database.migrations_restore', 'D'],
  ['build.official', 'E'],
  ['build.standalone', 'E'],
  ['build.performance', 'E'],
  ['playwright.chromium', 'F'],
  ['playwright.authenticated_staging', 'F'],
  ['windows.installer', 'G'],
  ['windows.inspection', 'G'],
  ['windows.signature', 'G'],
  ['windows.install_launch_persist_uninstall', 'G'],
  ['windows.upgrade_hwid_offline_restore', 'G'],
  ['staging.postgres_redis', 'H'],
  ['staging.smtp_portal', 'H'],
  ['staging.einvoicing_update', 'H'],
  ['security.audit', 'I'],
  ['security.secret_scan_worktree_history', 'I'],
  ['security.hwid_source', 'I'],
  ['security.artifact', 'I'],
  ['compliance.sbom_notices', 'J'],
])

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function safeRelative(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0') &&
    !path.isAbsolute(value) && !/^[A-Za-z]:[\\/]/.test(value) &&
    !path.normalize(value).split(/[\\/]/).includes('..')
}

function parseSums(content, errors) {
  const sums = new Map()
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    const match = /^([a-f0-9]{64}) ([ *])(.+)$/.exec(line)
    if (!match) {
      errors.push(`SHA256SUMS ligne ${index + 1} invalide`)
      continue
    }
    const [, hash, , name] = match
    if (!safeRelative(name)) {
      errors.push(`SHA256SUMS chemin refusé à la ligne ${index + 1}`)
      continue
    }
    if (sums.has(name)) {
      errors.push(`SHA256SUMS entrée dupliquée : ${name}`)
      continue
    }
    sums.set(name, hash)
  }
  return sums
}

function evaluateManifest(manifest, repositoryRoot = ROOT) {
  const errors = []
  const checks = manifest && Array.isArray(manifest.checks) ? manifest.checks : []
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) errors.push('manifeste JSON objet requis')
  if (manifest?.schemaVersion !== 1) errors.push('schemaVersion doit valoir 1')
  if (typeof manifest?.generatedAt !== 'string' || Number.isNaN(Date.parse(manifest.generatedAt))) errors.push('generatedAt invalide')
  if (!/^[a-f0-9]{40}$/.test(manifest?.baseCommit || '')) errors.push('baseCommit SHA-1 requis')
  if (typeof manifest?.branch !== 'string' || !manifest.branch.trim()) errors.push('branche requise')
  if (!Array.isArray(manifest?.checks)) errors.push('checks tableau requis')

  const evidenceDeclaration = manifest?.evidenceRoot
  const verificationRoot = path.resolve(repositoryRoot, 'artifacts', 'verification')
  const evidenceRoot = safeRelative(evidenceDeclaration) ? path.resolve(repositoryRoot, evidenceDeclaration) : null
  if (!evidenceRoot || !inside(verificationRoot, evidenceRoot) || evidenceRoot === verificationRoot) {
    errors.push('evidenceRoot doit être un sous-dossier relatif de artifacts/verification')
  }

  let sums = new Map()
  const readableFiles = new Map()
  if (evidenceRoot && inside(verificationRoot, evidenceRoot)) {
    let rootStat
    try { rootStat = fs.lstatSync(evidenceRoot) } catch { /* erreur explicite ci-dessous */ }
    if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
      errors.push('evidenceRoot absent, non répertoire ou lien symbolique')
    } else {
      const realRoot = fs.realpathSync(evidenceRoot)
      if (!inside(verificationRoot, realRoot)) {
        errors.push('evidenceRoot réel hors du périmètre de preuves')
      } else {
        const sumsPath = path.join(evidenceRoot, 'SHA256SUMS')
        try {
          const stat = fs.lstatSync(sumsPath)
          if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid')
          sums = parseSums(fs.readFileSync(sumsPath, 'utf8'), errors)
        } catch {
          errors.push('SHA256SUMS régulier et lisible requis')
        }
        for (const [name, expected] of sums) {
          const file = path.resolve(evidenceRoot, name)
          try {
            if (!inside(realRoot, file)) throw new Error('outside')
            const stat = fs.lstatSync(file)
            if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not-regular')
            const realFile = fs.realpathSync(file)
            if (!inside(realRoot, realFile)) throw new Error('outside')
            if (sha256(file) !== expected) {
              errors.push(`empreinte de preuve divergente : ${name}`)
              continue
            }
            readableFiles.set(name, fs.readFileSync(file, 'utf8'))
          } catch {
            errors.push(`preuve du SHA256SUMS illisible ou non régulière : ${name}`)
          }
        }
      }
    }
  }

  const seen = new Set()
  for (const [index, check] of checks.entries()) {
    const id = typeof check?.id === 'string' ? check.id : `#${index + 1}`
    if (typeof check?.id !== 'string' || !check.id) errors.push(`contrôle ${id} : id requis`)
    if (seen.has(id)) errors.push(`contrôle dupliqué : ${id}`)
    seen.add(id)
    if (!SECTIONS.has(check?.section)) errors.push(`${id} : section A–K requise`)
    if (!STATUSES.has(check?.status)) errors.push(`${id} : statut inconnu`)
    if (typeof check?.command !== 'string' || !check.command.trim()) errors.push(`${id} : commande/procédure requise`)
    if (typeof check?.observedAt !== 'string' || Number.isNaN(Date.parse(check.observedAt))) errors.push(`${id} : observedAt invalide`)
    if (typeof check?.reason !== 'string' || !check.reason.trim()) errors.push(`${id} : justification requise`)

    if (check?.status === 'pass' && check.exitCode !== 0) errors.push(`${id} : pass exige exitCode 0`)
    if (check?.status === 'fail' && (!Number.isInteger(check.exitCode) || check.exitCode === 0)) errors.push(`${id} : fail exige un code non nul`)
    if (check?.status === 'not_executed' && check.exitCode !== null) errors.push(`${id} : not_executed exige exitCode null`)
    if (check?.status === 'blocked' && check.exitCode === 0) errors.push(`${id} : blocked ne peut pas avoir exitCode 0`)

    if (!Array.isArray(check?.evidence) || check.evidence.length === 0) {
      errors.push(`${id} : au moins une preuve requise`)
      continue
    }
    const names = []
    for (const name of check.evidence) {
      if (!safeRelative(name)) {
        errors.push(`${id} : chemin de preuve refusé`)
        continue
      }
      names.push(name)
      if (!sums.has(name)) errors.push(`${id} : preuve absente du SHA256SUMS : ${name}`)
      else if (!readableFiles.has(name)) errors.push(`${id} : preuve non vérifiée : ${name}`)
    }
    if (check.status === 'pass') {
      if (typeof check.passMarker !== 'string' || !check.passMarker) {
        errors.push(`${id} : passMarker requis`)
      } else if (!names.some((name) => readableFiles.get(name)?.includes(check.passMarker))) {
        errors.push(`${id} : marqueur de réussite absent des preuves`)
      }
    }
  }

  for (const [id, section] of REQUIRED_CHECKS) {
    const check = checks.find((candidate) => candidate?.id === id)
    if (!check) errors.push(`exigence critique absente du manifeste : ${id}`)
    else if (check.section !== section) errors.push(`${id} : section attendue ${section}`)
  }

  const passed = checks.filter((check) => check?.status === 'pass').length
  const blocking = checks.filter((check) => check?.status !== 'pass').length
  return {
    ready: errors.length === 0 && checks.length > 0 && blocking === 0 && REQUIRED_CHECKS.every(([id]) => seen.has(id)),
    errors,
    passed,
    blocking,
    total: checks.length,
  }
}

function loadAndEvaluate(manifestPath) {
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    return { ready: false, errors: [`manifeste illisible ou JSON invalide (${error.code || 'parse'})`], passed: 0, blocking: 0, total: 0 }
  }
  return evaluateManifest(manifest)
}

function main(argv) {
  const index = argv.indexOf('--manifest')
  if (index !== -1 && !argv[index + 1]) {
    console.error('NON PRÊT POUR LA PRODUCTION — --manifest exige un chemin')
    return 1
  }
  const declaration = index === -1 ? DEFAULT_MANIFEST : argv[index + 1]
  if (!safeRelative(declaration)) {
    console.error('NON PRÊT POUR LA PRODUCTION — chemin de manifeste relatif sûr requis')
    return 1
  }
  const result = loadAndEvaluate(path.resolve(ROOT, declaration))
  console.log('GarageFlows — contrôle final de production')
  console.log(`Manifeste : ${declaration}`)
  console.log(`Contrôles : ${result.passed} pass, ${result.blocking} bloquant(s), ${result.total} total`)
  for (const error of result.errors) console.error(`ERREUR: ${error}`)
  console.log(result.ready ? 'PRÊT POUR LA PRODUCTION' : 'NON PRÊT POUR LA PRODUCTION')
  return result.ready ? 0 : 1
}

if (require.main === module) process.exitCode = main(process.argv.slice(2))

module.exports = { DEFAULT_MANIFEST, REQUIRED_CHECKS, evaluateManifest, loadAndEvaluate }
