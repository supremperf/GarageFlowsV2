#!/usr/bin/env node
'use strict'

/**
 * Assemble le dossier de preuves MASTER 5 attendu par `npm run readiness:final`.
 *
 * Ce script ne juge RIEN et ne fabrique AUCUN résultat : il copie des journaux
 * déjà produits par des exécutions réelles, calcule leurs empreintes et écrit le
 * manifeste décrit par `scripts/production-readiness.cjs`. Les statuts et les
 * justifications sont fournis en entrée (master5-readiness-input.json) : le
 * verdict reste celui du vérificateur, jamais celui de ce script.
 *
 * Usage :
 *   node scripts/build-master5-readiness.mjs \
 *     --input artifacts/verification/master5-readiness-input.json
 *
 * Règles appliquées, volontairement strictes :
 *   · une preuve déclarée mais absente du disque fait ÉCHOUER l'assemblage ;
 *   · un `passMarker` introuvable dans les preuves du contrôle fait ÉCHOUER
 *     l'assemblage ici, avant même le vérificateur — pour qu'un marqueur erroné
 *     ne puisse jamais être découvert trop tard ;
 *   · les empreintes sont recalculées à chaque exécution sur les octets copiés.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const ROOT = process.cwd()
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}

const inputPath = path.resolve(ROOT, option('--input', 'artifacts/verification/master5-readiness-input.json'))
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'))

const evidenceRoot = path.resolve(ROOT, input.evidenceRoot)
const verificationRoot = path.resolve(ROOT, 'artifacts', 'verification')
if (!evidenceRoot.startsWith(verificationRoot + path.sep)) {
  throw new Error('evidenceRoot doit être un sous-dossier de artifacts/verification')
}

/** Identité git réelle, jamais saisie à la main. */
function gitIdentity() {
  const run = (...gitArgs) => execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8' }).trim()
  const commit = run('rev-parse', 'HEAD')
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('HEAD n’est pas un SHA-1 complet')
  return {
    commit,
    branch: run('rev-parse', '--abbrev-ref', 'HEAD'),
    dirty: run('status', '--porcelain').length > 0,
  }
}

const git = gitIdentity()

fs.rmSync(evidenceRoot, { recursive: true, force: true })
fs.mkdirSync(evidenceRoot, { recursive: true })

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

// ── Copie des journaux déclarés ───────────────────────────────────────────────
const copied = new Map() // nom dans le dossier de preuves -> chemin source
for (const [name, source] of Object.entries(input.evidenceFiles)) {
  if (name.includes('/') || name.includes('\\') || name.startsWith('.')) {
    throw new Error(`nom de preuve invalide : ${name}`)
  }
  const from = path.resolve(ROOT, source)
  if (!fs.existsSync(from) || !fs.statSync(from).isFile()) {
    throw new Error(`preuve déclarée introuvable : ${source}`)
  }
  fs.copyFileSync(from, path.join(evidenceRoot, name))
  copied.set(name, source)
}

// ── SHA256SUMS sur les octets réellement copiés ───────────────────────────────
const sums = [...copied.keys()].sort()
  .map((name) => `${sha256(path.join(evidenceRoot, name))}  ${name}`)
fs.writeFileSync(path.join(evidenceRoot, 'SHA256SUMS'), sums.join('\n') + '\n', 'utf8')

// ── Contrôle préalable des marqueurs de réussite ──────────────────────────────
const problems = []
for (const check of input.checks) {
  for (const name of check.evidence) {
    if (!copied.has(name)) problems.push(`${check.id} : preuve non déclarée dans evidenceFiles : ${name}`)
  }
  if (check.status === 'pass') {
    if (!check.passMarker) { problems.push(`${check.id} : passMarker requis`); continue }
    const found = check.evidence.some((name) => {
      if (!copied.has(name)) return false
      return fs.readFileSync(path.join(evidenceRoot, name), 'utf8').includes(check.passMarker)
    })
    if (!found) problems.push(`${check.id} : marqueur « ${check.passMarker} » absent de ses preuves`)
  }
}
if (problems.length) {
  console.error('Assemblage refusé :')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

// ── Manifeste ─────────────────────────────────────────────────────────────────
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  baseCommit: git.commit,
  branch: git.branch,
  evidenceRoot: input.evidenceRoot,
  notes: input.notes ?? null,
  workingTreeDirtyAtAssembly: git.dirty,
  checks: input.checks,
}
const manifestPath = path.resolve(ROOT, input.manifestPath)
fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')

const byStatus = {}
for (const check of input.checks) byStatus[check.status] = (byStatus[check.status] || 0) + 1
console.log(`[readiness] ${copied.size} preuve(s) copiée(s) → ${input.evidenceRoot}`)
console.log(`[readiness] commit ${git.commit.slice(0, 9)}${git.dirty ? ' (arbre modifié)' : ''} sur ${git.branch}`)
console.log(`[readiness] ${input.checks.length} contrôle(s) : ${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(', ')}`)
console.log(`[readiness] manifeste → ${input.manifestPath}`)
