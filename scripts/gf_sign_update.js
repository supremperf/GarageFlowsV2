#!/usr/bin/env node
'use strict'

/**
 * gf_sign_update.js — point d'entrée « une commande » pour signer un installeur.
 *
 *     npm run sign-update -- --file dist/GarageFlows-Setup-1.2.0.exe
 *
 * CE SCRIPT NE RÉIMPLÉMENTE AUCUNE CRYPTOGRAPHIE. Il :
 *   1. résout les paramètres manquants (version depuis le nom du fichier ou
 *      package.json, URL de téléchargement depuis GF_UPDATE_DOWNLOAD_BASE_URL) ;
 *   2. contrôle la clé privée Ed25519 (type, correspondance avec l'ancre
 *      publique du keyId, absence du dépôt) — sans jamais l'afficher ;
 *   3. délègue la signature à `scripts/sign-release-manifest.mjs`, seul
 *      producteur de manifeste accepté par les postes ;
 *   4. vérifie IMMÉDIATEMENT le manifeste produit avec le vérificateur RÉEL du
 *      client (`electron/update-verify.js`, via keygen-verify-update.cjs),
 *      l'ancre publique dérivée de la clé privée étant injectée pour ce seul
 *      processus. Un manifeste non vérifiable fait échouer la commande.
 *
 * SÉCURITÉ
 *   · clé privée : GF_UPDATE_SIGNING_KEY (PEM PKCS#8) ou
 *     GF_UPDATE_SIGNING_KEY_FILE / --key-file ; jamais écrite, jamais affichée,
 *     jamais journalisée ;
 *   · aucun secret dans la sortie : uniquement chemin, keyId, SHA-256, taille ;
 *   · les contrôles de cohérence du signeur restent actifs (version ↔
 *     package.json ↔ nom du fichier ↔ URL, domaine autorisé, anti-downgrade) ;
 *   · une clé qui ne correspond PAS à l'ancre publique déjà embarquée pour le
 *     keyId demandé est refusée : signer sous un keyId connu avec une autre clé
 *     produirait un manifeste que 100 % du parc rejetterait.
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const RACINE = path.resolve(__dirname, '..')
const SIGNEUR = path.join(RACINE, 'scripts', 'sign-release-manifest.mjs')
const VERIFICATEUR = path.join(RACINE, 'scripts', 'keygen-verify-update.cjs')
const VERIF_CLIENT = path.join(RACINE, 'electron', 'update-verify.js')

const KEY_ID_PAR_DEFAUT = 'gf-update-2026-2'
const BASE_URL_PAR_DEFAUT = 'https://api.garageflows.fr/downloads'

function args(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const cle = a.slice(2)
      const suivant = argv[i + 1]
      if (suivant === undefined || suivant.startsWith('--')) out[cle] = true
      else { out[cle] = suivant; i++ }
    } else out._.push(a)
  }
  return out
}

function mourir(message, code = 1) {
  console.error(`\n  ✗ ${message}\n`)
  process.exit(code)
}

function versionDuDepot() {
  try {
    return JSON.parse(fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8')).version
  } catch {
    return null
  }
}

function versionDansNom(nom) {
  const m = String(nom).match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/)
  return m ? m[1] : null
}

/** Lit la clé privée SANS jamais exposer son contenu. */
function lireClePrivee(a) {
  let pem = process.env.GF_UPDATE_SIGNING_KEY
  let origine = 'GF_UPDATE_SIGNING_KEY'
  const fichier = a['key-file'] && a['key-file'] !== true
    ? a['key-file']
    : process.env.GF_UPDATE_SIGNING_KEY_FILE

  if (!pem && fichier) {
    const absolu = path.resolve(process.cwd(), fichier)
    if (!fs.existsSync(absolu)) mourir(`Fichier de clé introuvable : ${fichier}`)
    try {
      const stat = fs.statSync(absolu)
      if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
        console.warn(`  ⚠ Clé privée lisible par d'autres comptes (${(stat.mode & 0o777).toString(8)}). `
          + 'Restreignez les permissions (chmod 600).')
      }
    } catch { /* le contrôle de permissions ne doit pas bloquer la signature */ }
    const relatif = path.relative(RACINE, absolu)
    if (!relatif.startsWith('..') && !path.isAbsolute(relatif)) {
      console.warn(`  ⚠ La clé privée se trouve DANS le dépôt (${relatif}). `
        + 'Déplacez-la hors du dossier de travail et vérifiez qu’elle n’est pas suivie par Git.')
    }
    try {
      pem = fs.readFileSync(absolu, 'utf8')
    } catch {
      mourir(`Impossible de lire le fichier de clé : ${fichier}`)
    }
    origine = 'fichier de clé'
  }

  if (!pem) {
    mourir(
      'aucune clé de signature configurée (GF_UPDATE_SIGNING_KEY ou GF_UPDATE_SIGNING_KEY_FILE).\n'
      + '    keyId connus des postes: gf-update-2026, gf-update-2026-2.\n'
      + '    Renseignez GF_UPDATE_SIGNING_KEY, ou choisissez le fichier de clé avec --key-file.',
    )
  }

  let cle
  try {
    cle = crypto.createPrivateKey(pem)
  } catch {
    mourir('clé invalide : PEM PKCS#8 Ed25519 attendu (le contenu n’est jamais affiché).')
  }
  if (cle.asymmetricKeyType !== 'ed25519') {
    mourir(`clé invalide : type « ${cle.asymmetricKeyType} » ; seul Ed25519 signe les mises à jour.`)
  }
  const publique = crypto.createPublicKey(cle).export({ type: 'spki', format: 'pem' }).toString()
  return { cle, publique, origine }
}

function main() {
  const a = args(process.argv.slice(2))
  if (a.help || a.h) {
    console.log(`
  Signature d'un installeur GarageFlows (Ed25519, manifeste vérifié immédiatement).

  USAGE
    npm run sign-update -- --file <installeur> [options]

  OPTIONS
    --file <chemin>          installeur à signer (obligatoire)
    --version <x.y.z>        défaut : version du nom de fichier, sinon package.json
    --download-url <URL>     défaut : ${BASE_URL_PAR_DEFAUT}/<nom-du-fichier>
    --key-id <id>            défaut : ${KEY_ID_PAR_DEFAUT}
    --key-file <PEM>         clé privée Ed25519 PKCS#8 (sinon variables d'environnement)
    --channel <canal>        stable (défaut)
    --arch <arch>            x64 (défaut)
    --platform <plateforme>  win32 (défaut)
    --out <chemin>           manifeste produit (défaut : à côté de l'installeur)
    --current-version <v>    version installée simulée (défaut 0.0.0 : pas d'anti-downgrade)
    --release-notes <texte>  notes publiées (2000 caractères max)

  La clé privée n'est jamais affichée ni journalisée. Le manifeste est vérifié
  par electron/update-verify.js, le module réellement exécuté sur les postes.
`)
    return
  }

  const fichier = a.file && a.file !== true ? a.file : null
  if (!fichier) {
    mourir('--file <chemin de l’installeur> est obligatoire.\n'
      + '    Exemple : npm run sign-update -- --file dist/GarageFlows-Setup-1.2.0.exe')
  }
  const absolu = path.resolve(process.cwd(), fichier)
  if (!fs.existsSync(absolu)) mourir(`installeur introuvable : ${fichier}`)
  const stat = fs.statSync(absolu)
  if (!stat.isFile()) mourir(`--file doit désigner un fichier : ${fichier}`)
  if (stat.size === 0) mourir(`fichier vide : ${fichier}`)

  const version = (a.version && a.version !== true ? a.version : null)
    || versionDansNom(path.basename(absolu))
    || versionDuDepot()
  if (!version) mourir('version introuvable : passez --version <x.y.z>.')

  const base = (process.env.GF_UPDATE_DOWNLOAD_BASE_URL || BASE_URL_PAR_DEFAUT).replace(/\/+$/, '')
  const downloadUrl = a['download-url'] && a['download-url'] !== true
    ? a['download-url']
    : `${base}/${encodeURIComponent(path.basename(absolu))}`

  const keyId = a['key-id'] && a['key-id'] !== true ? a['key-id'] : KEY_ID_PAR_DEFAUT
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(keyId)) mourir(`--key-id invalide : ${keyId}`)

  const { publique, origine } = lireClePrivee(a)

  // Correspondance keyId ↔ ancre publique déjà EMBARQUÉE. Signer sous un keyId
  // connu avec une autre clé est un refus, pas un avertissement : le parc
  // rejetterait le manifeste, silencieusement côté serveur.
  let ancres = {}
  try {
    ancres = require(VERIF_CLIENT).PUBLIC_KEYS || {}
  } catch {
    mourir('vérificateur client illisible (electron/update-verify.js).')
  }
  const ancreConnue = ancres[keyId]
  const empreintePublique = crypto.createHash('sha256').update(publique).digest('hex').slice(0, 16)
  if (ancreConnue) {
    const attendue = crypto.createPublicKey(ancreConnue).export({ type: 'spki', format: 'pem' }).toString()
    if (attendue !== publique) {
      mourir(
        `la clé fournie ne correspond PAS à l’ancre publique « ${keyId} » embarquée dans les postes.\n`
        + '    Un manifeste signé ainsi serait rejeté par tous les clients.\n'
        + '    Vérifiez la clé, ou utilisez le keyId de la nouvelle paire (déjà publiée dans une version).',
      )
    }
  } else {
    console.warn(`  ⚠ keyId « ${keyId} » inconnu des postes actuels : le manifeste ne sera installable `
      + 'qu’après diffusion d’une version embarquant cette clé publique.')
  }

  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(absolu)).digest('hex')
  const out = a.out && a.out !== true
    ? path.resolve(process.cwd(), a.out)
    : absolu.replace(/\.(exe|msi|dmg|zip|appimage|deb)$/i, '') + '.manifest.json'

  console.log('\n  Signature de mise à jour GarageFlows')
  console.log(`    fichier  : ${absolu}`)
  console.log(`    taille   : ${stat.size} octets`)
  console.log(`    sha256   : ${sha256}`)
  console.log(`    version  : ${version}`)
  console.log(`    keyId    : ${keyId}`)
  console.log(`    clé      : ${origine} (empreinte publique ${empreintePublique}…)`)
  console.log('')

  const argsSigneur = [
    SIGNEUR,
    '--file', absolu,
    '--version', String(version),
    '--download-url', downloadUrl,
    '--key-id', keyId,
    '--out', out,
  ]
  for (const opt of ['channel', 'arch', 'platform', 'min-version', 'release-notes']) {
    if (a[opt] && a[opt] !== true) argsSigneur.push(`--${opt}`, String(a[opt]))
  }

  const signature = spawnSync(process.execPath, argsSigneur, {
    cwd: RACINE,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  })
  if (signature.stdout) process.stdout.write(signature.stdout)
  if (signature.stderr) process.stderr.write(signature.stderr)
  if (signature.status !== 0) {
    mourir('signature interrompue : aucun manifeste exploitable n’a été produit.', signature.status || 1)
  }
  if (!fs.existsSync(out)) mourir(`le signeur n’a produit aucun manifeste à ${out}.`)

  // ── Vérification immédiate avec le vérificateur RÉEL du client ────────────
  const verification = spawnSync(process.execPath, [
    VERIFICATEUR,
    '--manifest', out,
    '--public-keys', JSON.stringify({ [keyId]: publique }),
    // 0.0.0 par défaut : la vérification à la signature atteste la SIGNATURE et
    // la cohérence du manifeste. L'anti-downgrade ne peut être jugé que par le
    // poste installé (version réellement présente), jamais par le build.
    '--current-version', String(
      a['current-version'] && a['current-version'] !== true ? a['current-version'] : '0.0.0',
    ),
  ], { cwd: RACINE, env: process.env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })

  let resultat = null
  try {
    resultat = JSON.parse((verification.stdout || '').trim().split('\n').pop())
  } catch {
    resultat = null
  }
  if (verification.status !== 0 || !resultat || resultat.ok !== true) {
    const raison = resultat && resultat.reason ? resultat.reason : 'vérificateur muet ou en erreur'
    mourir(
      `manifeste NON vérifié par le client : ${raison}\n`
      + `    Manifeste conservé pour diagnostic : ${out}\n`
      + '    NE PUBLIEZ PAS cet artefact.',
    )
  }

  const manifeste = JSON.parse(fs.readFileSync(out, 'utf8')).manifest
  const octets = fs.readFileSync(absolu)
  if (manifeste.sha256 !== crypto.createHash('sha256').update(octets).digest('hex')
      || manifeste.size !== octets.length) {
    mourir('le manifeste ne décrit pas les octets présents sur le disque : artefact incohérent.')
  }
  if (manifeste.keyId !== keyId) {
    mourir(`le manifeste porte keyId « ${manifeste.keyId} » au lieu de « ${keyId} ».`)
  }

  console.log('  ✓ Signature vérifiée par le module client (electron/update-verify.js)')
  console.log(`    manifeste : ${out}`)
  console.log(`    keyId     : ${resultat.keyId}`)
  console.log(`    sha256    : ${resultat.sha256}`)
  console.log(`    version   : ${resultat.version} (${resultat.channel}, ${resultat.platform}/${resultat.architecture})`)
  console.log('\n  Publiez CE manifeste avec l’installeur. Aucune clé privée n’a été affichée.\n')
}

main()
