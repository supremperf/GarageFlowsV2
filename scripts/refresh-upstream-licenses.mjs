#!/usr/bin/env node
'use strict'

/**
 * Récupère — et verrouille par empreinte — les textes de licence des paquets de
 * production qui n'en embarquent aucun.
 *
 * POURQUOI UN SCRIPT SÉPARÉ : `scripts/gen-third-party-notices.mjs` doit rester
 * DÉTERMINISTE et HORS-LIGNE (c'est ce que vérifie `npm run sbom:verify`). Un
 * accès réseau pendant la génération rendrait les notices dépendantes de l'état
 * d'Internet au moment du build : un dépôt renommé, un tag déplacé ou une
 * coupure suffiraient à produire deux fichiers différents pour un même commit,
 * ou à faire échouer un build de release. La récupération est donc explicite,
 * rare, et son résultat est versionné sous docs/licenses/upstream/.
 *
 * Usage :
 *   node scripts/refresh-upstream-licenses.mjs            # récupère ce qui manque
 *   node scripts/refresh-upstream-licenses.mjs --check    # vérifie, n'écrit rien, sort 1 si dérive
 *   node scripts/refresh-upstream-licenses.mjs --force    # re-télécharge tout
 *
 * `--check` n'accède JAMAIS au réseau : il recalcule les empreintes locales.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = process.cwd()
const STORE = path.join(ROOT, 'docs', 'licenses', 'upstream')
const MANIFEST = path.join(STORE, 'sources.json')

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const force = args.includes('--force')

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')

/** Normalisation identique à celle appliquée dans les notices : LF, pas d'espaces en fin de ligne. */
function normalise(text) {
  return text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/[ \t]+$/g, '')).join('\n').trim() + '\n'
}

function readManifest() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    throw new Error('sources.json: aucune entrée')
  }
  for (const entry of manifest.entries) {
    for (const field of ['package', 'version', 'license', 'file', 'sourceKind', 'sourceUrl', 'rationale']) {
      if (!entry[field]) throw new Error(`sources.json: champ « ${field} » manquant pour ${entry.package ?? '?'}`)
    }
    // Un nom de fichier, jamais un chemin : le magasin reste plat et non traversable.
    if (entry.file.includes('/') || entry.file.includes('\\') || entry.file.startsWith('.')) {
      throw new Error(`sources.json: nom de fichier invalide « ${entry.file} »`)
    }
    if (typeof entry.holderDeclared !== 'boolean') {
      throw new Error(`sources.json: holderDeclared doit être booléen pour ${entry.package}`)
    }
  }
  return manifest
}

async function fetchText(url) {
  const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'garageflows-license-refresh' } })
  if (!response.ok) throw new Error(`HTTP ${response.status} sur ${url}`)
  const text = await response.text()
  if (!text.trim()) throw new Error(`réponse vide sur ${url}`)
  return text
}

let drift = 0
const manifest = readManifest()

for (const entry of manifest.entries) {
  const target = path.join(STORE, entry.file)
  const label = `${entry.package}@${entry.version}`
  let present = null
  try { present = fs.readFileSync(target, 'utf8') } catch { /* absent */ }

  if (checkOnly) {
    if (present === null) { console.error(`[licences] MANQUANT  ${label} → ${entry.file}`); drift++; continue }
    const digest = sha256(Buffer.from(present, 'utf8'))
    if (!entry.sha256) { console.error(`[licences] NON VERROUILLÉ  ${label} (sha256 absent du manifeste)`); drift++; continue }
    if (digest !== entry.sha256) { console.error(`[licences] DÉRIVE  ${label} (empreinte locale ≠ manifeste)`); drift++; continue }
    console.log(`[licences] OK  ${label}  ${digest.slice(0, 16)}…`)
    continue
  }

  if (present !== null && !force && entry.sha256 === sha256(Buffer.from(present, 'utf8'))) {
    console.log(`[licences] inchangé  ${label}`)
    continue
  }

  const text = normalise(await fetchText(entry.sourceUrl))
  const digest = sha256(Buffer.from(text, 'utf8'))
  if (present !== null && entry.sha256 && digest !== entry.sha256 && !force) {
    console.error(`[licences] REFUSÉ  ${label} : la source amont a changé (${entry.sha256.slice(0, 16)}… → ${digest.slice(0, 16)}…).`)
    console.error('           Relire la nouvelle version, puis relancer avec --force pour l\'accepter.')
    drift++
    continue
  }
  fs.mkdirSync(STORE, { recursive: true })
  fs.writeFileSync(target, text, 'utf8')
  entry.sha256 = digest
  entry.retrievedAt = new Date().toISOString().slice(0, 10)
  console.log(`[licences] récupéré  ${label}  ${digest.slice(0, 16)}…  (${text.length} octets)`)
}

if (!checkOnly) {
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
}

if (drift) {
  console.error(`[licences] ${drift} problème(s)`)
  process.exit(1)
}
console.log(`[licences] ${manifest.entries.length} entrée(s) ${checkOnly ? 'vérifiée(s)' : 'à jour'}`)
