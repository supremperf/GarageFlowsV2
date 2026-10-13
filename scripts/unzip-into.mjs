#!/usr/bin/env node
/**
 * unzip-into — extracteur ZIP minimal, SANS dépendance externe (Node + zlib).
 *
 * Supporte les entrées STORE (0) et DEFLATE (8) — ce que produit `git archive
 * --format=zip`. Lit le Central Directory (source d'autorité des noms/offsets),
 * puis chaque Local File Header pour localiser les données. Protégé contre le
 * « zip slip » (aucune écriture hors du dossier cible). Pas de ZIP64 (inutile
 * pour nos artefacts : < 4 Gio, < 65535 entrées).
 *
 * Usage : node scripts/unzip-into.mjs <archive.zip> <dossier-cible>
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import path from 'node:path'

const [, , zipArg, destArg] = process.argv
if (!zipArg || !destArg) {
  console.error('Usage: node scripts/unzip-into.mjs <archive.zip> <dossier-cible>')
  process.exit(2)
}
const dest = path.resolve(destArg)
const buf = readFileSync(zipArg)

const EOCD_SIG = 0x06054b50
const CEN_SIG = 0x02014b50
const LOC_SIG = 0x04034b50

// ── Localiser l'End Of Central Directory (recherche depuis la fin) ────────────
let eocd = -1
for (let i = buf.length - 22; i >= 0; i--) {
  if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break }
}
if (eocd < 0) { console.error('❌ EOCD introuvable — archive ZIP invalide.'); process.exit(1) }

const cdCount = buf.readUInt16LE(eocd + 10)
let off = buf.readUInt32LE(eocd + 16) // début du Central Directory

let extracted = 0
for (let n = 0; n < cdCount; n++) {
  if (buf.readUInt32LE(off) !== CEN_SIG) { console.error('❌ Entrée CD corrompue.'); process.exit(1) }
  const method = buf.readUInt16LE(off + 10)
  const compSize = buf.readUInt32LE(off + 20)
  const nameLen = buf.readUInt16LE(off + 28)
  const extraLen = buf.readUInt16LE(off + 30)
  const commentLen = buf.readUInt16LE(off + 32)
  const localOff = buf.readUInt32LE(off + 42)
  const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
  off += 46 + nameLen + extraLen + commentLen

  // Cible sécurisée (anti zip-slip) : doit rester sous `dest`.
  const target = path.resolve(dest, name)
  if (target !== dest && !target.startsWith(dest + path.sep)) {
    console.error(`❌ Entrée hors cible (zip slip) refusée : ${name}`)
    process.exit(1)
  }
  if (name.endsWith('/')) { mkdirSync(target, { recursive: true }); continue }

  // Local File Header : recalculer la position réelle des données.
  if (buf.readUInt32LE(localOff) !== LOC_SIG) { console.error(`❌ LFH invalide pour ${name}.`); process.exit(1) }
  const lNameLen = buf.readUInt16LE(localOff + 26)
  const lExtraLen = buf.readUInt16LE(localOff + 28)
  const dataStart = localOff + 30 + lNameLen + lExtraLen
  const raw = buf.subarray(dataStart, dataStart + compSize)

  let content
  if (method === 0) content = raw                 // STORE
  else if (method === 8) content = inflateRawSync(raw) // DEFLATE
  else { console.error(`❌ Méthode de compression non supportée (${method}) pour ${name}.`); process.exit(1) }

  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
  extracted++
}

console.log(`  ✓ ${extracted} fichier(s) extrait(s) → ${path.relative(process.cwd(), dest) || dest}`)
