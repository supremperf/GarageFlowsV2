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
import { fileURLToPath } from 'node:url'

const ALGO = 'Ed25519'
const PRODUIT = 'GarageFlow'
const HOTES_AUTORISES = new Set(['api.garageflows.fr', 'garageflows.fr', 'app.garageflows.fr'])
const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Extensions d'installeur acceptées, par plateforme. */
const EXTENSIONS = { win32: ['.exe'], darwin: ['.dmg', '.zip'], linux: ['.AppImage', '.deb'] }

/** Première version SemVer trouvée dans un texte (nom de fichier, URL…). */
function versionDans(texte) {
  const m = String(texte).match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/)
  return m ? m[1] : null
}

/** Version déclarée par le dépôt — la seule qui fasse autorité. */
function versionDuDepot() {
  try {
    return JSON.parse(fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8')).version ?? null
  } catch {
    return null
  }
}

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

const AIDE = `
  Signature d'un manifeste de mise à jour GarageFlows (Ed25519).

  USAGE
    node scripts/sign-release-manifest.mjs \\
      --file <chemin de l'installeur> \\
      --version <x.y.z> \\
      --download-url <https://…>

  OBLIGATOIRE
    --file <chemin>          installeur à signer (doit exister)
    --version <x.y.z>        version SemVer de CETTE release
    --download-url <url>     URL HTTPS publique de l'installeur

  FACULTATIF
    --channel <nom>          défaut : stable
    --platform <os>          défaut : win32   (win32 | darwin | linux)
    --arch <arch>            défaut : x64
    --key-id <id>            défaut : gf-update-2026-2 — DOIT être connu des postes
                             (PUBLIC_KEYS dans electron/update-verify.js)
    --min-version <x.y.z>    version minimale pouvant appliquer cette mise à jour
    --release-notes <texte>  2000 caractères au plus
    --out <chemin>           défaut : <installeur>.manifest.json
    --allow-mismatch         signe MALGRÉ une incohérence de version (voir plus bas)
    --gen-key --key-id <id>  génère une paire Ed25519 et sort
    --help                   affiche cette aide

  CONTRÔLES DE COHÉRENCE
    Un manifeste dont la version ne correspond pas à l'installeur qu'il désigne
    met TOUT LE PARC en boucle : chaque poste télécharge, vérifie l'empreinte
    (elle est juste), installe, redémarre sur l'ancienne version, et recommence.
    Il n'existe aucun recours logiciel côté poste. Sont donc vérifiés :
      · --version == version de package.json ;
      · la version présente dans le NOM du fichier == --version ;
      · la version présente dans l'URL de téléchargement == --version ;
      · extension du fichier cohérente avec --platform ;
      · URL en HTTPS et hôte dans la liste blanche des postes.
    --allow-mismatch lève les trois premiers contrôles, un par un et bruyamment.

  CLÉ PRIVÉE
    Lue dans GF_UPDATE_SIGNING_KEY (PEM PKCS#8) ou GF_UPDATE_SIGNING_KEY_FILE.
    Jamais lue depuis le dépôt, jamais écrite.
`

function main() {
  const a = args()

  if (a.help || a.h) { console.log(AIDE); return }
  if (a['gen-key']) return genererPaire(a['key-id'])

  const fichier = a.file
  if (!fichier || fichier === true) mourir(`--file <chemin de l'installeur> est obligatoire.\n${AIDE}`)
  // Aucun test d'existence préalable : la lecture ci-dessous échoue proprement
  // si le fichier est absent, et un répertoire y lève EISDIR — même verdict,
  // sans fenêtre de course entre le contrôle et l'usage.

  const version = a.version
  if (!version || version === true) mourir(`--version <x.y.z> est obligatoire.\n${AIDE}`)
  if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) mourir(`Version non SemVer : ${version}`)

  const downloadUrl = a['download-url']
  if (!downloadUrl || downloadUrl === true) mourir(`--download-url <https://…> est obligatoire.\n${AIDE}`)
  let hôte
  let cheminUrl = ''
  try {
    const u = new URL(downloadUrl)
    if (u.protocol !== 'https:') mourir('--download-url doit être en HTTPS.')
    hôte = u.hostname
    cheminUrl = decodeURIComponent(u.pathname)
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

  // ── Cohérence des TROIS identités (GF-013) ─────────────────────────────────
  // Le script contrôlait l'existence du fichier, le format de la version et le
  // domaine de l'URL — jamais leur CONCORDANCE. Signer l'installeur 1.1.0 encore
  // présent dans dist/ avec « --version 1.2.0 » produisait un manifeste
  // cryptographiquement valide dont l'empreinte correspondait bien aux octets
  // servis. Chaque poste l'acceptait (1.2.0 > 1.1.0), téléchargeait, vérifiait,
  // installait, quittait — puis redémarrait sur 1.1.0, et la vérification
  // horaire re-proposait 1.2.0. Boucle sans fin sur tout le parc, l'application
  // se fermant à chaque tentative, sans aucun recours logiciel côté poste.
  const plateforme = a.platform === undefined || a.platform === true ? 'win32' : a.platform
  const laisserPasser = a['allow-mismatch'] === true || a['allow-mismatch'] === 'true'
  const avertir = (message) => {
    if (!laisserPasser) mourir(`${message}\n    (--allow-mismatch pour signer malgré tout, en connaissance de cause)`)
    console.warn(`\n  ⚠ INCOHÉRENCE ACCEPTÉE PAR --allow-mismatch : ${message}\n`)
  }

  const versionDepot = versionDuDepot()
  if (versionDepot && versionDepot !== version) {
    avertir(`--version (${version}) ≠ version de package.json (${versionDepot}).`)
  }

  const nomFichier = path.basename(fichier)
  const versionNom = versionDans(nomFichier)
  if (!versionNom) {
    avertir(`Le nom « ${nomFichier} » ne porte aucune version : impossible de vérifier qu'il s'agit bien de l'installeur ${version}.`)
  } else if (versionNom !== version) {
    avertir(`Le fichier signé s'appelle « ${nomFichier} » (version ${versionNom}) alors que --version vaut ${version}.`)
  }

  const versionUrl = versionDans(path.basename(cheminUrl))
  if (versionUrl && versionUrl !== version) {
    avertir(`L'URL de téléchargement désigne la version ${versionUrl}, pas ${version} :\n    ${downloadUrl}`)
  }

  const extensionsAttendues = EXTENSIONS[plateforme]
  if (extensionsAttendues && !extensionsAttendues.includes(path.extname(nomFichier))) {
    mourir(
      `Extension « ${path.extname(nomFichier) || '(aucune)'} » incohérente avec --platform ${plateforme}.\n`
      + `    Attendu : ${extensionsAttendues.join(', ')}`,
    )
  }

  const octets = fs.readFileSync(fichier)
  if (octets.length === 0) mourir(`Fichier vide : ${fichier}`)
  const sha256 = crypto.createHash('sha256').update(octets).digest('hex')

  const manifest = {
    schemaVersion:      1,
    product:            PRODUIT,
    version,
    channel:            a.channel === undefined || a.channel === true ? 'stable' : a.channel,
    platform:           plateforme,
    architecture:       a.arch === undefined || a.arch === true ? 'x64' : a.arch,
    downloadUrl,
    sha256,
    size:               octets.length,
    fileName:           path.basename(fichier),
    // Défaut porté à gf-update-2026-2 le 15/08/2026 : la clé privée de
    // gf-update-2026 est introuvable, signer sous cet identifiant échouerait
    // faute de clé. Son ancre publique reste néanmoins déclarée côté postes.
    keyId:              a['key-id'] === undefined || a['key-id'] === true ? 'gf-update-2026-2' : a['key-id'],
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
