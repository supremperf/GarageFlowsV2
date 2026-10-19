#!/usr/bin/env node
'use strict'

/**
 * Contrôles AVANT empaquetage — échoue tôt, avec la cause et le correctif.
 *
 * ─── La règle appliquée ici ──────────────────────────────────────────────────
 *
 * Une chaîne d’empaquetage doit s’arrêter au premier élément manquant, en le
 * NOMMANT. Les échecs tardifs — « NSIS : impossible de créer l’installeur »,
 * ou pire, un installeur produit qui plante à l’installation — coûtent des
 * dizaines de minutes et ne disent pas quoi corriger.
 *
 * Ce script ne construit rien et ne modifie rien : il lit, il vérifie, il parle.
 *
 *   1. version de Node compatible avec `engines`
 *   2. clé publique de vérification des mises à jour présente
 *   3. ressources Windows présentes (icône, modèle de base SQLite)
 *   4. scripts et configuration electron-builder cohérents
 *   5. cible d’empaquetage annoncée (Windows x64)
 */

const fs = require('node:fs')
const path = require('node:path')

const RACINE = path.resolve(__dirname, '..')
// Public resource only: no new pair, rotation, or private key required.
require('./materialize-build-public-key.cjs').materializePublicKey(RACINE)
const PROBLEMES = []
const AVERTISSEMENTS = []

function lire(p) {
  return fs.readFileSync(path.join(RACINE, p), 'utf8')
}

function fichierNonVide(p, description, obligatoire = true) {
  const chemin = path.join(RACINE, p)
  if (!fs.existsSync(chemin)) {
    if (obligatoire) PROBLEMES.push(`${description} introuvable : ${p}`)
    else AVERTISSEMENTS.push(`${description} introuvable : ${p}`)
    return false
  }
  if (fs.statSync(chemin).size === 0) {
    PROBLEMES.push(`${description} vide : ${p}`)
    return false
  }
  return true
}

// 1 ── Node : la version exigée par le projet (et par Electron 30+).
const { engines } = JSON.parse(lire('package.json'))
const nodeMajeur = Number(process.versions.node.split('.')[0])
if (engines?.node) {
  const majeurs = String(engines.node).match(/\d+/g)?.map(Number) ?? []
  const minimum = majeurs[0] ?? 22
  if (nodeMajeur < minimum) {
    PROBLEMES.push(
      `Node ${process.versions.node} est trop ancien (engines.node = ${engines.node}).\n` +
      `     Correctif : installer Node ${minimum} LTS puis relancer.`,
    )
  }
}
if (!process.versions.node.startsWith('22.')) {
  AVERTISSEMENTS.push(
    `Node ${process.versions.node} : la chaîne de release a été validée sur Node 22.x (voir .nvmrc / CI).`,
  )
}

// 2 ── Clé publique : sans elle, aucune mise à jour signée n’est vérifiable.
fichierNonVide('keys/public.pem', 'Clé publique de vérification des mises à jour')

// 3 ── Ressources Windows.
fichierNonVide('icon.ico', 'Icône Windows de l’installeur')
fichierNonVide('prisma/garageflow-template.db', 'Modèle de base SQLite livré avec l’application')

// 4 ── Vitrine : ce qui est empaqueté doit exister.
fichierNonVide('electron/main.js', 'Processus principal Electron')
fichierNonVide('electron/preload.js', 'Pont de préchargement Electron')

// 5 ── Sécurité : aucune clé privée ne doit se trouver dans le dépôt.
for (const cle of ['keys/private.pem', 'private.pem', 'keys/private-update.pem']) {
  if (fs.existsSync(path.join(RACINE, cle))) {
    PROBLEMES.push(
      `Clé PRIVÉE présente dans le dépôt : ${cle}\n` +
      '     Correctif : la retirer du poste et ne la conserver que dans le coffre de signature.',
    )
  }
}

// 6 ── Lisibilité des messages d’échec : la chaîne doit être celle attendue.
const scripts = JSON.parse(lire('package.json')).scripts ?? {}
const etapesAttendues = ['build', 'postbuild', 'dist', 'verify:standalone', 'check:artifact-secrets', 'check:artifact-fuses']
for (const etape of etapesAttendues) {
  if (!scripts[etape]) PROBLEMES.push(`script npm manquant : ${etape}`)
}

// 7 ── Cible annoncée : une seule, explicite.
console.log('')
console.log('🔎 Contrôles avant empaquetage')
console.log(`   Node ${process.versions.node} — ${process.platform}/${process.arch}`)
console.log('   Cible : Windows x64 (NSIS) — installeur utilisateur, sans droits administrateur')
console.log(`   Version empaquetée : ${JSON.parse(lire('package.json')).version}`)

if (process.platform !== 'win32') {
  AVERTISSEMENTS.push(
    'Empaquetage demandé depuis un système non-Windows.\n' +
    '     Le résultat dépend de Wine et de NSIS : la validation finale de l’installeur\n' +
    '     doit être faite sur Windows (installation, désinstallation, lancement).',
  )
}

if (AVERTISSEMENTS.length) {
  console.log('')
  for (const a of AVERTISSEMENTS) console.log(`⚠️  ${a}`)
}

if (PROBLEMES.length) {
  console.error('')
  console.error(`❌ Empaquetage refusé (${PROBLEMES.length} prérequis manquant(s)) :`)
  for (const p of PROBLEMES) console.error(`   • ${p}`)
  console.error('')
  process.exit(1)
}

console.log('✅ Prérequis réunis — poursuite de la construction.')
console.log('')
