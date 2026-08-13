#!/usr/bin/env node
/**
 * Signature d'un manifeste de mise à jour (Ed25519).
 *
 * ─── Pourquoi cet outil existe (GF-FINAL-021) ───────────────────────────────
 * `electron/update-verify.js` embarque une clé publique en dur, donc
 * `signingConfigured()` rend TOUJOURS vrai, donc `app:install-update` refuse
 * toute installation dépourvue de manifeste signé Ed25519 valide.
 *
 * Or AUCUN outil du dépôt ne produisait un tel manifeste. Le seul script au nom
 * évocateur, `npm run release:manifest`
 * (`scripts/generate-release-manifest.mjs`), écrit un fichier de PROVENANCE DE
 * BUILD — `{productName, packageVersion, appId, git, buildId, generatedAt,
 * environment, toolchain, tests}` — sans `manifest`, sans `signature`, sans
 * `sha256` ni `downloadUrl`. L'écran « Réglages → Mises à jour » et le message
 * d'erreur de `POST /api/admin/updates` désignaient pourtant ce script :
 * l'administrateur téléversait `release-manifest.json` et recevait
 * « Ce fichier n'est pas un manifeste signé ». S'il publiait sans manifeste,
 * chaque poste affichait « Mise à jour non signée : installation manuelle
 * requise ».
 *
 * Conséquence : AUCUNE mise à jour n'était installable sur le parc, quelle que
 * soit la source. C'est cet outil qui manquait.
 *
 * ─── Usage ──────────────────────────────────────────────────────────────────
 *   node scripts/sign-release-manifest.mjs \
 *     --file dist/GarageFlows-Setup-1.2.0.exe \
 *     --version 1.2.0 \
 *     --download-url https://api.garageflows.fr/downloads/GarageFlows-Setup-1.2.0.exe \
 *     [--channel stable] [--platform win32] [--arch x64] \
 *     [--key-id gf-update-2026] [--min-version 1.0.0] \
 *     [--out dist/GarageFlows-Setup-1.2.0.manifest.json]
 *
 * La clé PRIVÉE est lue dans `GF_UPDATE_SIGNING_KEY` (PEM PKCS#8 complet) ou
 * dans le fichier désigné par `GF_UPDATE_SIGNING_KEY_FILE`. Elle n'est jamais
 * lue depuis le dépôt et n'est jamais écrite nulle part.
 *
 * ─── Génération d'une paire de clés ─────────────────────────────────────────
 *   node scripts/sign-release-manifest.mjs --gen-key --key-id gf-update-2027
 *
 * ATTENTION : un poste n'accepte que les `keyId` présents dans `PUBLIC_KEYS`
 * (electron/update-verify.js). Une nouvelle clé n'a d'effet que sur les postes
 * ayant DÉJÀ reçu une version qui la connaît. Lors d'une rotation, AJOUTER la
 * nouvelle clé sans retirer l'ancienne tant que des releases signées par elle
 * circulent — sinon le parc installé cesse de pouvoir se mettre à jour, et il
 * n'y a plus de chemin logiciel pour le réparer.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const ALGO = 'Ed25519'
const PRODUIT = 'GarageFlow'
const HOTES_AUTORISES = new Set(['api.garageflows.fr', 'garageflows.fr', 'app.garageflows.fr'])

// ─── Sérialisation canonique — DOIT être identique à electron/update-verify.js ─
// Toute divergence produit une signature que le client rejette sans expliquer
// pourquoi : c'est la panne la plus coûteuse à diagnostiquer de cette chaîne.
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep)
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((acc, k) => { acc[k] = sortDeep(v[k]); return acc }, {})
  }
  return v
}
const canonicalize = (v) => JSON.stringify(sortDeep(v))

function args() {
  const out = {}
  const a = process.argv.slice(2)
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue
    const cle = a[i].slice(2)
    const suivant = a[i + 1]
    if (suivant === undefined || suivant.startsWith('--')) out[cle] = true
    else { out[cle] = suivant; i++ }
  }
  return out
}

function mourir(message) {
  console.error(`\n  ✗ ${message}\n`)
  process.exit(1)
}

function cléPrivée() {
  const pem = process.env.GF_UPDATE_SIGNING_KEY
    || (process.env.GF_UPDATE_SIGNING_KEY_FILE && fs.readFileSync(process.env.GF_UPDATE_SIGNING_KEY_FILE, 'utf8'))
  if (!pem) {
    mourir(
      'Clé privée de signature absente.\n'
      + '    Renseignez GF_UPDATE_SIGNING_KEY (PEM PKCS#8) ou GF_UPDATE_SIGNING_KEY_FILE.\n'
      + '    Pour créer une paire : node scripts/sign-release-manifest.mjs --gen-key --key-id <id>',
    )
  }
  let clé
  try {
    clé = crypto.createPrivateKey(pem)
  } catch {
    mourir('Clé privée illisible : un PEM PKCS#8 Ed25519 est attendu.')
  }
  if (clé.asymmetricKeyType !== 'ed25519') {
    mourir(`Clé de type « ${clé.asymmetricKeyType} » : seul Ed25519 est accepté.`)
  }
  return clé
}

function genererPaire(keyId) {
  if (!keyId || keyId === true) {
    mourir('--gen-key exige --key-id <identifiant> (ex. gf-update-2027).')
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

  console.log('\n  Paire Ed25519 générée.\n')
  console.log('  ── CLÉ PRIVÉE — à conserver HORS du dépôt (coffre / secret CI) ──\n')
  console.log(priv)
  console.log('  ── CLÉ PUBLIQUE — à AJOUTER dans electron/update-verify.js ──\n')
  console.log(`  PUBLIC_KEYS['${keyId}'] =\n`)
  console.log(pub.split('\n').filter(Boolean).map((l) => `    '${l}\\n' +`).join('\n').replace(/ \+$/, ''))
  console.log('\n  RAPPEL : AJOUTER cette clé sans RETIRER les anciennes tant que des')
  console.log('  releases signées par elles circulent. Un poste ne connaît que les clés')
  console.log('  présentes dans la version qu\'il exécute déjà : retirer une clé encore')
  console.log('  utilisée coupe la mise à jour du parc installé, sans recours logiciel.\n')
}

function main() {
  const a = args()

  if (a['gen-key']) return genererPaire(a['key-id'])

  const fichier = a.file
  if (!fichier || fichier === true) mourir('--file <chemin de l\'installeur> est obligatoire.')
  if (!fs.existsSync(fichier)) mourir(`Fichier introuvable : ${fichier}`)

  const version = a.version
  if (!version || version === true) mourir('--version <x.y.z> est obligatoire.')
  if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) mourir(`Version non SemVer : ${version}`)

  const downloadUrl = a['download-url']
  if (!downloadUrl || downloadUrl === true) mourir('--download-url <https://…> est obligatoire.')
  let hôte
  try {
    const u = new URL(downloadUrl)
    if (u.protocol !== 'https:') mourir('--download-url doit être en HTTPS.')
    hôte = u.hostname
  } catch {
    mourir(`--download-url invalide : ${downloadUrl}`)
  }
  // Contrôlé ICI, à la signature, plutôt que découvert par le parc : un
  // manifeste signé vers un domaine hors liste blanche est rejeté par CHAQUE
  // poste, sans possibilité de le corriger autrement qu'en re-signant.
  if (!HOTES_AUTORISES.has(hôte)) {
    mourir(
      `Domaine « ${hôte} » absent de la liste blanche des postes.\n`
      + `    Autorisés : ${[...HOTES_AUTORISES].join(', ')}\n`
      + '    (voir ALLOWED_DOWNLOAD_HOSTS dans electron/update-verify.js)',
    )
  }

  const octets = fs.readFileSync(fichier)
  const sha256 = crypto.createHash('sha256').update(octets).digest('hex')

  const manifest = {
    schemaVersion:      1,
    product:            PRODUIT,
    version,
    channel:            a.channel === undefined || a.channel === true ? 'stable' : a.channel,
    platform:           a.platform === undefined || a.platform === true ? 'win32' : a.platform,
    architecture:       a.arch === undefined || a.arch === true ? 'x64' : a.arch,
    downloadUrl,
    sha256,
    size:               octets.length,
    fileName:           path.basename(fichier),
    keyId:              a['key-id'] === undefined || a['key-id'] === true ? 'gf-update-2026' : a['key-id'],
    signatureAlgorithm: ALGO,
    releasedAt:         new Date().toISOString(),
    ...(a['min-version'] && a['min-version'] !== true ? { minVersion: a['min-version'] } : {}),
    ...(a['release-notes'] && a['release-notes'] !== true ? { releaseNotes: String(a['release-notes']).slice(0, 2000) } : {}),
  }

  const signature = crypto
    .sign(null, Buffer.from(canonicalize(manifest), 'utf8'), cléPrivée())
    .toString('base64')

  const signé = { manifest, signature }
  const sortie = a.out && a.out !== true
    ? a.out
    : path.join(path.dirname(fichier), `${path.basename(fichier, path.extname(fichier))}.manifest.json`)

  fs.writeFileSync(sortie, `${JSON.stringify(signé, null, 2)}\n`, 'utf8')

  console.log('\n  ✓ Manifeste signé écrit.\n')
  console.log(`    fichier   : ${sortie}`)
  console.log(`    version   : ${manifest.version} (${manifest.channel}, ${manifest.platform}/${manifest.architecture})`)
  console.log(`    sha256    : ${manifest.sha256}`)
  console.log(`    taille    : ${manifest.size} octets`)
  console.log(`    keyId     : ${manifest.keyId}`)
  console.log('\n  Téléversez CE fichier — et non release-manifest.json — dans')
  console.log('  Zone Administrateur → Mises à jour, avec l\'installeur.\n')
}

main()
