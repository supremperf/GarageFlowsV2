#!/usr/bin/env node
'use strict'

/**
 * Vérifie l’ARTEFACT final : l’installeur Windows produit est-il celui attendu ?
 *
 * ─── Ce que ce script refuse de faire ────────────────────────────────────────
 *
 * Il ne se contente pas de vérifier qu’un fichier existe dans `dist/`. Un
 * `dist/` peut contenir :
 *
 *   • l’installeur d’une version PRÉCÉDENTE (numéro dans le nom ≠ package.json) ;
 *   • une archive vide ou tronquée (téléchargement/copie interrompus) ;
 *   • un fichier qui n’est pas un exécutable Windows ;
 *   • un installeur construit sur une sortie `standalone` incomplète, donc une
 *     application qui s’installe puis ne démarre pas.
 *
 * Chacun de ces cas a été produit au moins une fois pendant la mise au point de
 * cette chaîne. Le script les nomme, un par un, avec la sortie de secours.
 *
 * Codes de sortie : 0 = artefact conforme ; 1 = artefact non livrable.
 */

const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const RACINE = path.resolve(__dirname, '..')
const DIST = path.join(RACINE, 'dist')
const DECOMPRESSE = path.join(DIST, 'win-unpacked')

/** En dessous, ce n’est pas un installeur : c’est un fichier tronqué. */
const TAILLE_MINIMALE_OCTETS = 20 * 1024 * 1024

const { version, build } = JSON.parse(fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8'))
const { INSTALLER_NAME, peInfo, inspectNsis, publish } = require('./lib/windows-delivery.cjs')
const nomAttendu = INSTALLER_NAME
if (build.nsis.artifactName !== INSTALLER_NAME) throw new Error('NSIS artifactName differs from the single-file delivery contract')

function lister(dir, extension) {
  try {
    return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(extension))
  } catch {
    return []
  }
}

function sha256(chemin) {
  return createHash('sha256').update(fs.readFileSync(chemin)).digest('hex')
}

function octets(n) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} Go`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} Mo`
  return `${(n / 1024).toFixed(0)} Ko`
}

async function main() {
  const problemes = []
  const remarques = []

  if (!fs.existsSync(DIST)) {
    console.error('❌ Aucun dossier dist/ : la construction n’a pas été exécutée.')
    console.error('   Correctif : `npm run dist`.')
    process.exit(1)
  }

  // ── 1. L’installeur ────────────────────────────────────────────────────────
  const exeDist = lister(DIST, '.exe')
  // On écarte les utilitaires d’electron-builder (ex. e2e helpers) : un
  // installeur porte le nom produit et la version.
  const installeurs = exeDist.filter((f) => /Setup/i.test(f))

  if (!installeurs.length) {
    console.error('❌ Aucun installeur dans dist/ (fichier « … Setup <version>.exe » attendu).')
    console.error(`   Correctif : \`npm run dist\` — nom attendu : ${nomAttendu}`)
    if (exeDist.length) console.error(`   (fichiers .exe présents, sans « Setup » : ${exeDist.join(', ')})`)
    process.exit(1)
  }

  if (installeurs.length > 1) {
    remarques.push(`plusieurs installeurs présents (${installeurs.join(', ')}) — les plus anciens devraient être retirés de dist/`)
  }

  // Le bon installeur : celui qui porte la version de package.json.
  const cible = installeurs.find((f) => f === nomAttendu)
    ?? installeurs.find((f) => f.includes(version))
    ?? installeurs[0]

  if (cible !== nomAttendu) {
    problemes.push(
      `nom d’installeur inattendu : « ${cible} » (attendu « ${nomAttendu} »)\n` +
      '     Le numéro de version doit venir de package.json, une seule fois.',
    )
  }

  const cheminExe = path.join(DIST, cible)
  // Header and size are read from the same opened PE, not stat-then-open.
  const stat = peInfo(cheminExe, TAILLE_MINIMALE_OCTETS)

  if (stat.size < TAILLE_MINIMALE_OCTETS) {
    problemes.push(
      `installeur de ${octets(stat.size)} : trop petit pour contenir l’application (minimum ${octets(TAILLE_MINIMALE_OCTETS)})`,
    )
  }

  // ── 3. Contenu décompressé (preuve que la charge utile est là) ────────────
  if (!fs.existsSync(DECOMPRESSE)) {
    problemes.push('dossier dist/win-unpacked absent : impossible de vérifier la charge utile de l’installeur')
  } else {
    const attendus = [
      ['GarageFlows.exe',                           'exécutable de l’application'],
      [path.join('resources', 'app.asar'),          'archive applicative'],
      [path.join('resources', 'standalone', 'server.js'), 'serveur autonome embarqué'],
      [path.join('resources', 'icon.ico'),          'icône de l’application'],
    ]
    for (const [rel, description] of attendus) {
      const p = path.join(DECOMPRESSE, rel)
      if (!fs.existsSync(p)) {
        problemes.push(`${description} absent de win-unpacked/ : ${rel}`)
      } else if (fs.statSync(p).size === 0) {
        problemes.push(`${description} vide : ${rel}`)
      }
    }

    // Un `.env` dans les ressources embarquées = configuration de développement
    // livrée chez le client (secrets).
    const env = path.join(DECOMPRESSE, 'resources', 'standalone', '.env')
    if (fs.existsSync(env)) {
      problemes.push('un fichier .env est embarqué dans les ressources livrées (secret de développement exposé)')
    }
  }

  // ── 4. Verdict ────────────────────────────────────────────────────────────
  const empreinte = sha256(cheminExe)
  console.log('')
  console.log('📦 Artefact vérifié')
  console.log(`   ${path.relative(RACINE, cheminExe)}`)
  console.log(`   Taille : ${octets(stat.size)}`)
  console.log(`   SHA-256 : ${empreinte}`)
  console.log(`   Version : ${version} (source : package.json)`)

  if (remarques.length) {
    console.log('')
    for (const r of remarques) console.log(`ℹ️  ${r}`)
  }

  if (problemes.length) {
    console.error('')
    console.error(`❌ Installeur NON livrable (${problemes.length} problème(s)) :`)
    for (const p of problemes) console.error(`   • ${p}`)
    console.error('')
    process.exit(1)
  }

  console.log('')
  // Inspect THIS NSIS executable, not only its neighboring unpacked folder.
  const verification = await inspectNsis(RACINE, cheminExe)
  const receipt = await publish(RACINE, verification)
  console.log('WINDOWS_DELIVERY_RECEIPT ' + JSON.stringify(receipt))
  console.log('✅ Installeur complet vérifié et copié seul dans release/. Étape suivante :')
  console.log(`   npm run release:sign -- --file "release/${cible}" --version ${version} --download-url <URL_HTTPS_PUBLIQUE>`)
  console.log('')
}

main().catch(error => { console.error("Installeur non livrable : " + error.message); process.exitCode = 1 })
