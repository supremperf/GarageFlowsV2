#!/usr/bin/env node
'use strict'

/**
 * Produit MASTER5_EVIDENCE/SHA256SUMS au MÊME format que MASTER4_EVIDENCE :
 * `<sha256>  ./<chemin relatif au dossier de preuves>`, trié par empreinte.
 *
 * Il ne touche JAMAIS MASTER4_EVIDENCE : les preuves historiques restent
 * intactes et vérifiables indépendamment.
 *
 * Usage : node scripts/generate-master5-sums.mjs [--check]
 *   (sans argument) écrit le manifeste
 *   --check        recalcule et compare, sort 1 à la moindre divergence
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = process.cwd()
const DOSSIER = path.join(ROOT, 'MASTER5_EVIDENCE')
const MANIFESTE = path.join(DOSSIER, 'SHA256SUMS')
const check = process.argv.includes('--check')

if (!fs.existsSync(DOSSIER)) {
  console.error('MASTER5_EVIDENCE/ introuvable')
  process.exit(1)
}

/** Tous les fichiers du dossier de preuves, sauf le manifeste lui-même. */
function parcourir(dir, acc = []) {
  for (const entree of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const complet = path.join(dir, entree.name)
    if (entree.isSymbolicLink()) throw new Error(`lien symbolique refusé : ${complet}`)
    if (entree.isDirectory()) { parcourir(complet, acc); continue }
    if (!entree.isFile()) continue
    if (complet === MANIFESTE) continue
    acc.push(complet)
  }
  return acc
}

const empreinte = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')

const lignes = parcourir(DOSSIER)
  .map((f) => ({
    hash: empreinte(f),
    nom: './' + path.relative(DOSSIER, f).split(path.sep).join('/'),
  }))
  .sort((a, b) => a.hash.localeCompare(b.hash))
  .map(({ hash, nom }) => `${hash}  ${nom}`)

if (!check) {
  fs.writeFileSync(MANIFESTE, lignes.join('\n') + '\n', 'utf8')
  console.log(`[preuves] ${lignes.length} empreintes → MASTER5_EVIDENCE/SHA256SUMS`)
  process.exit(0)
}

const attendu = fs.readFileSync(MANIFESTE, 'utf8').replace(/\r\n/g, '\n').trim().split('\n')
const obtenu = lignes
let divergences = 0
const parse = (l) => { const m = /^([a-f0-9]{64})  (.+)$/.exec(l); return m ? { hash: m[1], nom: m[2] } : null }
const carteAttendue = new Map(attendu.map(parse).filter(Boolean).map((e) => [e.nom, e.hash]))
const carteObtenue = new Map(obtenu.map(parse).filter(Boolean).map((e) => [e.nom, e.hash]))

for (const [nom, hash] of carteObtenue) {
  if (!carteAttendue.has(nom)) { console.error(`AJOUTÉ    ${nom}`); divergences++ }
  else if (carteAttendue.get(nom) !== hash) { console.error(`MODIFIÉ   ${nom}`); divergences++ }
}
for (const nom of carteAttendue.keys()) {
  if (!carteObtenue.has(nom)) { console.error(`MANQUANT  ${nom}`); divergences++ }
}

if (divergences) {
  console.error(`[preuves] ${divergences} divergence(s) — le manifeste ne décrit pas les fichiers présents.`)
  process.exit(1)
}
console.log(`[preuves] ${carteObtenue.size}/${carteAttendue.size} empreintes vérifiées — manifeste conforme.`)
