#!/usr/bin/env node
'use strict'

/**
 * `npm run keys:find-issuer` — retrouve sur CE poste la clé privée de licence de
 * PRODUCTION et l'installe pour le keygen.
 *
 * Problème traité : le keygen refuse de signer (KEY_MISMATCH_OR_ANCHOR_UNAVAILABLE)
 * parce que keys/private.pem n'est pas la clé dont l'empreinte est REFERENCE_FP —
 * typiquement après extraction d'un nouveau ZIP (qui ne contient jamais keys/) et
 * génération d'une paire locale. La bonne clé est souvent restée dans un ANCIEN
 * dossier du projet (Bureau, Documents, Téléchargements, OneDrive).
 *
 * Garanties :
 *   - lecture seule pendant la recherche ; aucune clé n'est AFFICHÉE ni journalisée
 *     (seulement des chemins et des empreintes publiques) ;
 *   - une clé n'est retenue que si l'empreinte SHA-256 du SPKI de SA moitié publique
 *     est EXACTEMENT REFERENCE_FP — jamais « la plus récente » ni « la première » ;
 *   - aucune clé n'est générée ; aucune ancre publique n'est modifiée ;
 *   - installation seulement si UNE clé vérifiée est trouvée ; la clé privée
 *     remplacée est DÉPLACÉE hors du projet (~/GarageFlows-cles-ecartees/<date>/),
 *     jamais supprimée ; `--dry-run` n'installe rien.
 *   - clé chiffrée : vérifiable avec `--ask-passphrase` (saisie masquée, en mémoire) ou
 *     `--passphrase-stdin` (keygen graphique : passphrase sur l'entrée standard).
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createPrivateKey, createPublicKey, createHash } = require('node:crypto')
const { inspectAnchors, materializePublicKey } = require('./materialize-build-public-key.cjs')

const ROOT = path.resolve(__dirname, '..')
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'release', 'AppData', '$Recycle.Bin', '.cache',
  '.venv', 'venv', '__pycache__', 'Windows', 'Program Files', 'Program Files (x86)', '.gf-anchor-backups', 'standalone'])
const ENV_NAMES = new Set(['.env', '.env.local', '.env.server.local', '.env.production', '.env.production.local', '.env.legacy-server.local'])
const MAX_DEPTH = 7
const MAX_ENTRIES = 400000
const MAX_MS = 90000

function publicFingerprint(key) {
  return createHash('sha256').update(createPublicKey(key).export({ type: 'spki', format: 'der' })).digest('hex')
}

/** Dossiers probables d'un ancien projet. Dédoublonnés par chemin réel. */
function defaultRoots(home = os.homedir(), project = ROOT) {
  const candidates = [path.dirname(project)]
  for (const name of ['Desktop', 'Bureau', 'Documents', 'Downloads', 'Téléchargements']) candidates.push(path.join(home, name))
  try {
    for (const entry of fs.readdirSync(home, { withFileTypes: true })) {
      if (entry.isDirectory() && /^OneDrive/i.test(entry.name)) candidates.push(path.join(home, entry.name))
    }
  } catch { /* profil illisible */ }
  const seen = new Set(), roots = []
  for (const c of candidates) {
    try { const real = fs.realpathSync.native(c); if (!seen.has(real)) { seen.add(real); roots.push(real) } } catch { /* absent */ }
  }
  return roots
}

/** Extrait les PEM privés candidats d'un fichier (PEM direct ou GF_PRIVATE_KEY base64 d'un .env). */
function candidatesFromFile(file, text) {
  const out = []
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) {
    for (const m of text.matchAll(/-----BEGIN ([A-Z ]*)PRIVATE KEY-----[\s\S]*?-----END \1PRIVATE KEY-----/g)) out.push({ file, origin: 'PEM', pem: m[0] })
  }
  if (ENV_NAMES.has(path.basename(file))) {
    for (const m of text.matchAll(/^\s*(?:export\s+)?GF_PRIVATE_KEY\s*=\s*["']?([A-Za-z0-9+/=\s]+?)["']?\s*$/gm)) {
      try {
        const pem = Buffer.from(m[1].replace(/\s+/g, ''), 'base64').toString('utf8')
        if (/PRIVATE KEY-----/.test(pem)) out.push({ file, origin: 'GF_PRIVATE_KEY', pem })
      } catch { /* valeur non base64 */ }
    }
  }
  return out
}

/** Parcours borné (profondeur, nombre d'entrées, durée) ; jamais de lien suivi. */
function scan(roots, { now = Date.now } = {}) {
  const found = [], start = now()
  let entries = 0, truncated = false
  const walk = (dir, depth) => {
    if (truncated) return
    let list
    try { list = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of list) {
      if (++entries > MAX_ENTRIES || now() - start > MAX_MS) { truncated = true; return }
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH && !SKIP_DIRS.has(entry.name)) walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      const isPem = /\.(pem|key)$/i.test(entry.name), isEnv = ENV_NAMES.has(entry.name)
      if (!isPem && !isEnv) continue
      // Un SEUL descripteur : taille et contenu proviennent du même fichier
      // ouvert. Un stat-puis-read sur le chemin laissait une fenêtre de course
      // (le fichier pouvait être remplacé entre les deux appels).
      let fd
      try { fd = fs.openSync(full, 'r') } catch { continue }
      try {
        const size = fs.fstatSync(fd).size
        if (size > (isEnv ? 1024 * 1024 : 64 * 1024)) continue
        let text
        try { text = fs.readFileSync(fd, 'utf8') } catch { continue }
        found.push(...candidatesFromFile(full, text))
      } finally {
        fs.closeSync(fd)
      }
    }
  }
  for (const root of roots) walk(root, 0)
  return { candidates: found, truncated, entries }
}

/** Classe chaque candidat : P-256 vérifiée (empreinte), chiffrée, ou autre. */
function classify(candidates, referenceFp, passphrase) {
  const result = { matches: [], others: new Map(), encrypted: [] }
  for (const c of candidates) {
    const encrypted = /ENCRYPTED/.test(c.pem)
    let key
    try { key = createPrivateKey(encrypted ? { key: c.pem, passphrase: passphrase ?? '' } : c.pem) } catch {
      if (encrypted) result.encrypted.push(c)
      continue
    }
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') continue
    const fp = publicFingerprint(key)
    if (fp === referenceFp) result.matches.push({ ...c, fp })
    else result.others.set(fp, [...(result.others.get(fp) || []), c.file])
  }
  return result
}

function stamp() { return new Date().toISOString().replace(/[:.]/g, '-') }

/** Installe la clé vérifiée dans keys/private.pem ; l'ancienne est déplacée hors du projet. */
function install(root, match, referenceFp, { backupBase = path.join(os.homedir(), 'GarageFlows-cles-ecartees'), passphrase } = {}) {
  const readKey = pem => createPrivateKey(/ENCRYPTED/.test(pem) ? { key: pem, passphrase: passphrase ?? '' } : pem)
  const keysDir = path.join(root, 'keys')
  const target = path.join(keysDir, 'private.pem')
  const publicTarget = path.join(keysDir, 'public.pem')
  fs.mkdirSync(keysDir, { recursive: true })
  const moved = []
  const backupDir = path.join(backupBase, stamp())
  const setAside = (file, label) => {
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 })
    const dest = path.join(backupDir, path.basename(file))
    fs.copyFileSync(file, dest, fs.constants.COPYFILE_EXCL)
    try { fs.chmodSync(dest, 0o600) } catch { /* Windows */ }
    if (!fs.readFileSync(dest).equals(fs.readFileSync(file))) throw new Error(`copie de sauvegarde divergente (${label})`)
    fs.unlinkSync(file)
    moved.push({ label, to: dest })
  }

  // Pas de existsSync-puis-read : on lit directement et on traite ENOENT.
  // Le fichier peut changer entre les deux appels, et une clé apparue après le
  // test serait écrasée sans être mise de côté.
  let currentPem = null
  try { currentPem = fs.readFileSync(target, 'utf8') } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
  if (currentPem !== null) {
    let currentFp = null
    try { currentFp = publicFingerprint(readKey(currentPem)) } catch { /* chiffrée sans passphrase / illisible */ }
    if (currentFp === referenceFp) return { installed: false, already: true, moved }
    setAside(target, 'keys/private.pem (clé non conforme)')
  }
  try {
    const fp = publicFingerprint(fs.readFileSync(publicTarget, 'utf8'))
    if (fp !== referenceFp) setAside(publicTarget, 'keys/public.pem (clé non conforme)')
  } catch { /* absent : recréé ci-dessous */ }

  // Contenu exact du PEM vérifié (les octets d'origine pour un fichier PEM).
  fs.writeFileSync(target, match.pem.endsWith('\n') ? match.pem : `${match.pem}\n`, { flag: 'wx', mode: 0o600 })
  // Relecture RÉELLE, clé chiffrée comprise (elle a été vérifiée avec cette passphrase).
  const check = publicFingerprint(readKey(fs.readFileSync(target, 'utf8')))
  if (check !== referenceFp) throw new Error('relecture de keys/private.pem divergente')
  materializePublicKey(root) // keys/public.pem = clé de référence (depuis les ancres concordantes)
  return { installed: true, moved, backupDir: moved.length ? backupDir : null }
}

async function askHidden(prompt) {
  if (!process.stdin.isTTY) throw new Error('--ask-passphrase exige un terminal interactif')
  process.stdout.write(prompt)
  return new Promise(resolve => {
    let value = ''
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8')
    const onData = ch => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', onData)
        process.stdout.write('\n'); resolve(value)
      } else if (ch === '\u0003') { process.stdout.write('\n'); process.exit(130) }
      else if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
      else value += ch
    }
    process.stdin.on('data', onData)
  })
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', c => { data += c; if (data.length > 4096) reject(new Error('passphrase trop longue')) })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}

async function main(argv = process.argv.slice(2), { root = ROOT, roots, log = console.log, error = console.error, backupBase, passphrase } = {}) {
  const dryRun = argv.includes('--dry-run')
  const inspection = inspectAnchors(root)
  if (!inspection.agree) {
    error('❌ Les ancres de clé publique ne concordent pas : lancer d\'abord `npm run keys:restore` (ou `npm run dist`).')
    return 1
  }
  const referenceFp = inspection.expected
  if (argv.includes('--ask-passphrase') && passphrase === undefined) passphrase = await askHidden('Passphrase des clés chiffrées (masquée, en mémoire uniquement) : ')
  // Keygen graphique : passphrase transmise par stdin (jamais en argument, jamais affichée).
  if (argv.includes('--passphrase-stdin') && passphrase === undefined) passphrase = (await readStdin()).replace(/\r?\n$/, '') || undefined
  const searchRoots = roots || defaultRoots(os.homedir(), root)
  log(`🔎 Recherche de la clé privée de licence de production (empreinte ${referenceFp.slice(0, 16)}…)`)
  for (const r of searchRoots) log(`   • ${r}`)
  const { candidates, truncated } = scan(searchRoots)
  const result = classify(candidates, referenceFp, passphrase)
  if (truncated) log('   (recherche bornée : limite de durée ou de fichiers atteinte)')

  const distinct = [...new Map(result.matches.map(m => [m.fp, m])).values()]
  if (result.matches.length) {
    log(`\n✅ Clé de PRODUCTION trouvée (${result.matches.length} copie(s), empreinte vérifiée) :`)
    for (const m of result.matches) log(`   • ${m.file}${m.origin === 'GF_PRIVATE_KEY' ? ' (GF_PRIVATE_KEY)' : ''}`)
  } else {
    log('\n❌ Aucune clé privée correspondant à la production sur les emplacements parcourus.')
  }
  if (result.others.size) {
    log('\n   Autres clés P-256 trouvées — NE signent PAS des licences valides pour ce logiciel :')
    for (const [fp, files] of result.others) log(`   • ${fp.slice(0, 16)}… : ${[...new Set(files)].slice(0, 4).join(' | ')}${files.length > 4 ? ' …' : ''}`)
  }
  if (result.encrypted.length) {
    log('\n   Clés CHIFFRÉES non vérifiées (relancer avec --ask-passphrase) :')
    for (const c of result.encrypted) log(`   • ${c.file}`)
  }

  if (!distinct.length) {
    log('\n   Où chercher ensuite : clé USB / disque de sauvegarde, ancien PC, coffre de mots de passe,')
    log('   ou relancer avec --ask-passphrase si une clé chiffrée est listée. Sans cette clé, aucune')
    log('   licence valide ne peut être signée localement ; changer d\'autorité est une ROTATION')
    log('   (licences existantes invalidées) : voir docs/VERIFICATION_CLE_EMETTRICE.md.')
    return 1
  }
  if (dryRun) { log('\n(--dry-run : rien installé)'); return 0 }

  const outcome = install(root, distinct[0], referenceFp, { backupBase, passphrase })
  if (outcome.already) { log('\n✅ keys/private.pem est déjà la clé de production : rien à faire.'); return 0 }
  log('\n🔧 Clé de production installée dans keys/private.pem (empreinte revérifiée) ; keys/public.pem aligné.')
  if (/ENCRYPTED/.test(distinct[0].pem)) log('   Clé CHIFFRÉE (installée telle quelle, jamais déchiffrée sur disque) : saisir sa passphrase dans le keygen (Clés ECC → Passphrase).')
  for (const m of outcome.moved) log(`   ↪ ${m.label} déplacée hors du projet : ${m.to}`)
  log('   Le keygen peut signer. Rappel : `npm run dist` refuse un keys/private.pem dans le projet —')
  log('   déplacer keys\\private.pem hors du dossier avant de construire l\'installeur.')
  return 0
}

module.exports = { main, scan, classify, install, candidatesFromFile, defaultRoots }

if (require.main === module) {
  main().then(code => { process.exitCode = code }, e => { console.error(`❌ keys:find-issuer : ${e.message}`); process.exitCode = 1 })
}
