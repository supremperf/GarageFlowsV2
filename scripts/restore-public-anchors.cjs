#!/usr/bin/env node
'use strict'

/**
 * Remet AUTOMATIQUEMENT `_PK` et `_LINES` sur la clé de référence quand ils en
 * divergent, puis laisse `preflight:release` reprendre. Appelé par le preflight ;
 * utilisable seul : `npm run keys:restore`.
 *
 * ─── Pourquoi c'est sûr ──────────────────────────────────────────────────────
 *
 * L'ARBITRE est `REFERENCE_FP` (empreinte SHA-256 du SPKI de la clé de licence
 * de production, gelée par test). Une clé n'est écrite dans `_PK`/`_LINES` que
 * si SON empreinte calculée est EXACTEMENT `REFERENCE_FP` : il est impossible de
 * fabriquer une autre clé ayant la même empreinte. La provenance du texte de la
 * clé (fichier local, git, téléchargement GitHub) n'a donc aucune incidence sur
 * la sécurité : une source falsifiée est simplement écartée.
 *
 * Ce que ce script ne fait JAMAIS :
 *   - générer, dériver ou lire une clé privée ;
 *   - adopter la clé divergente (ce serait une rotation : `keys:sync`, approuvée) ;
 *   - modifier `REFERENCE_FP` ou la liste des clés retirées ;
 *   - choisir entre plusieurs déclarations ambiguës ;
 *   - détruire quoi que ce soit : les fichiers remplacés sont sauvegardés dans
 *     `.gf-anchor-backups/<horodatage>/`.
 * S'il ne peut pas prouver la clé de référence, il ne touche à rien et le
 * preflight reste BLOQUANT avec son diagnostic complet.
 *
 * ─── Pourquoi c'est la bonne direction ───────────────────────────────────────
 *
 * Les licences sont signées par la clé de production (serveur : GF_PRIVATE_KEY ;
 * poste de signature : keys/private.pem). Un exécutable dont `_PK` désigne une
 * clé générée localement REFUSE toutes ces licences sans message. Une vraie
 * rotation déplace les trois ancres ensemble (`keys:sync`) — `REFERENCE_FP`
 * compris ; deux ancres sur trois qui divergent ne sont donc jamais une rotation
 * approuvée.
 *
 * Désactivation : GF_NO_ANCHOR_RESTORE=1 (retour au refus pur) ;
 * GF_ANCHOR_RESTORE_NETWORK=0 (pas de téléchargement GitHub).
 */

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createPublicKey, createHash } = require('node:crypto')
const { inspectAnchors, ANCHORS } = require('./materialize-build-public-key.cjs')

/** Dépôt public d'origine : source de secours du TEXTE de la clé (vérifié par empreinte). */
const SOURCE_REPOSITORY = 'supremperf/GarageFlowsV2'
const NETWORK_REFS = Object.freeze(['main'])
const NETWORK_FILE = 'src/lib/license/public-key.ts'
const NETWORK_TIMEOUT_MS = 15000
const BACKUP_DIR = '.gf-anchor-backups'
const RETIRED_SOURCE = 'scripts/check-critical-files.js'
const LITERALS = ANCHORS.filter(a => a.kind === 'literal')

function fingerprintOf(pem) {
  return createHash('sha256').update(createPublicKey(pem).export({ type: 'spki', format: 'der' })).digest('hex')
}

/** PEM du littéral `const <variable> = [ … ]`, ou null (absent, ambigu, illisible). */
function literalPem(text, variable) {
  const blocks = [...String(text).matchAll(new RegExp(`const\\s+${variable}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'g'))]
  if (blocks.length !== 1) return null
  const lines = [...blocks[0][1].matchAll(/'([^']*)'/g)].map(m => m[1].trim()).filter(Boolean)
  if (lines[0] !== '-----BEGIN PUBLIC KEY-----') return null
  const pem = `${lines.join('\n')}\n`
  try { fingerprintOf(pem); return pem } catch { return null }
}

/** Le littéral réécrit, indentation et fins de ligne du fichier conservées. */
function rewriteLiteral(text, variable, pem) {
  const pattern = new RegExp(`(const\\s+${variable}\\s*=\\s*\\[)([\\s\\S]*?)(\\])`)
  const block = text.match(pattern)
  if (!block) throw new Error(`littéral ${variable} introuvable`)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const indent = block[2].match(/\n([ \t]+)'/)?.[1] ?? '  '
  const lines = pem.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const body = `${eol}${lines.map(l => `${indent}'${l}',`).join(eol)}${eol}`
  return text.replace(pattern, (_m, head, _old, tail) => `${head}${body}${tail}`)
}

function retiredFingerprints(root) {
  try {
    const text = fs.readFileSync(path.join(root, RETIRED_SOURCE), 'utf8')
    return new Set([...text.matchAll(/fp:\s*'([0-9a-f]{64})'/g)].map(m => m[1]))
  } catch { return new Set() }
}

/** Vrai seulement si `root` EST la racine d'un dépôt git (pas un dossier parent). */
function ownGitRepository(root) {
  try {
    const run = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: root, encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (run.status !== 0 || run.error) return false
    const norm = p => { const r = fs.realpathSync.native(p); return process.platform === 'win32' ? r.toLowerCase() : r }
    return norm(run.stdout.trim()) === norm(root)
  } catch { return false }
}

function gitHeadFile(root, file) {
  const run = spawnSync('git', ['show', `HEAD:${file}`], {
    cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
  })
  return run.status === 0 && !run.error ? run.stdout : null
}

/**
 * Cherche le TEXTE de la clé dont l'empreinte est `referenceFp`. Chaque candidat
 * est vérifié par empreinte ; un candidat différent est consigné et écarté.
 */
async function findReferencePem(root, referenceFp, { fetchImpl = systemTrustFetch, network = true } = {}) {
  const tried = []
  const consider = (source, pem) => {
    if (!pem) { tried.push({ source, outcome: 'indisponible' }); return null }
    let fp = null
    try { fp = fingerprintOf(pem) } catch { /* not a key */ }
    if (fp === referenceFp) { tried.push({ source, outcome: 'empreinte conforme' }); return { pem, source } }
    tried.push({ source, outcome: fp ? `autre clé (${fp.slice(0, 16)}…) — écartée` : 'illisible' })
    return null
  }

  // 1. Une ancre embarquée encore correcte (mise à jour partielle).
  for (const anchor of inspectAnchors(root).anchors) {
    if (anchor.kind === 'literal' && anchor.pem) {
      const hit = consider(`${anchor.file} (${anchor.variable})`, anchor.pem)
      if (hit) return { ...hit, tried }
    }
  }
  // 2. Ressource publique locale (écrite par une construction réussie précédente).
  {
    let pem = null
    try { pem = fs.readFileSync(path.join(root, 'keys', 'public.pem'), 'utf8') } catch { /* absent */ }
    const hit = consider('keys/public.pem', pem)
    if (hit) return { ...hit, tried }
  }
  // 3. Le commit extrait, si ce dossier est LUI-MÊME un dépôt git.
  if (ownGitRepository(root)) {
    for (const anchor of LITERALS) {
      const text = gitHeadFile(root, anchor.file)
      const hit = consider(`git HEAD:${anchor.file}`, text && literalPem(text, anchor.variable))
      if (hit) return { ...hit, tried }
    }
  } else {
    tried.push({ source: 'git', outcome: 'dossier hors dépôt git (ZIP) ou dépôt parent — ignoré' })
  }
  // 4. Le dépôt public d'origine (même vérification par empreinte).
  if (network && typeof fetchImpl === 'function') {
    for (const ref of NETWORK_REFS) {
      // Deux portes vers le MÊME fichier public : un proxy qui bloque l'une laisse souvent l'autre.
      const routes = [
        { label: `GitHub raw ${ref}`, url: `https://raw.githubusercontent.com/${SOURCE_REPOSITORY}/${ref}/${NETWORK_FILE}`, headers: {} },
        { label: `GitHub API ${ref}`, url: `https://api.github.com/repos/${SOURCE_REPOSITORY}/contents/${NETWORK_FILE}?ref=${ref}`,
          headers: { Accept: 'application/vnd.github.raw', 'User-Agent': 'garageflows-keys-restore' } },
      ]
      for (const route of routes) {
        let text = null
        try {
          const response = await fetchImpl(route.url, { headers: route.headers, signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS), redirect: 'follow' })
          if (response.ok) text = await response.text()
          else tried.push({ source: route.label, outcome: `HTTP ${response.status}` })
        } catch (error) {
          tried.push({ source: route.label, outcome: `réseau indisponible (${error.cause?.code || error.name || error.message})` })
        }
        if (text !== null) {
          const hit = consider(`${route.label} — ${SOURCE_REPOSITORY}/${NETWORK_FILE}`, literalPem(text, '_LINES'))
          if (hit) return { ...hit, tried }
        }
      }
    }
  } else {
    tried.push({ source: 'GitHub', outcome: 'téléchargement désactivé' })
  }
  return { pem: null, source: null, tried }
}

/**
 * GET HTTPS minimal, vérification TLS ACTIVE, avec les autorités de Node ET
 * celles du système (magasin Windows) : un antivirus ou un proxy d'entreprise
 * qui inspecte le HTTPS installe sa racine dans le magasin système, que le
 * `fetch` de Node ignore (UNABLE_TO_VERIFY_LEAF_SIGNATURE).
 */
function systemTrustFetch(url, { headers = {}, signal } = {}) {
  const https = require('node:https'), tls = require('node:tls')
  let ca = tls.rootCertificates
  try {
    if (typeof tls.getCACertificates === 'function') {
      ca = [...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])]
    }
  } catch { /* magasin système illisible : autorités de Node seules */ }
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers, ca, signal, timeout: NETWORK_TIMEOUT_MS }, response => {
      const chunks = []
      let size = 0
      response.on('data', chunk => {
        size += chunk.length
        if (size > 1024 * 1024) { request.destroy(new Error('réponse trop volumineuse')); return }
        chunks.push(chunk)
      })
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, text: async () => text })
      })
      response.on('error', reject)
    })
    request.on('timeout', () => request.destroy(Object.assign(new Error('délai dépassé'), { code: 'ETIMEDOUT' })))
    request.on('error', error => reject(Object.assign(new Error(error.message), { cause: { code: error.code } })))
  })
}

/**
 * Preuve, SANS lire de clé privée, qu'une autorité locale détient l'une des clés
 * divergentes : reçu de création de `config` portant cette empreinte, ou
 * keys/private.pem dont la moitié publique voisine (keys/public.pem, écrite avec
 * elle par config/keygen) n'est pas la clé de référence.
 */
function localAuthority(root, divergentFps, referenceFp) {
  const reasons = []
  // Reçu de création de `config` : lu par SON module (chemin et schéma définis une seule fois).
  try {
    const receipt = require('./config-keys.cjs').readState(root)
    if (receipt && divergentFps.includes(receipt.licensePublicFingerprint)) reasons.push('reçu de création de clés de `config` portant cette empreinte')
  } catch (error) {
    if (error && error.code !== 'MODULE_NOT_FOUND') reasons.push(`reçu de création de clés de \`config\` illisible (${error.message})`)
  }
  if (fs.existsSync(path.join(root, 'keys', 'private.pem'))) {
    let publicFp = null
    try { publicFp = fingerprintOf(fs.readFileSync(path.join(root, 'keys', 'public.pem'), 'utf8')) } catch { /* absent */ }
    if (publicFp !== referenceFp) reasons.push(`keys/private.pem présent (clé publique associée : ${publicFp ? `${publicFp.slice(0, 16)}…` : 'inconnue'})`)
  }
  return reasons.length ? reasons.join(' ; ') : null
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/** Écrit tout ou rien ; relit ; restaure les originaux au moindre échec. */
function writeAll(root, changes) {
  const staged = [], committed = []
  try {
    for (const c of changes) {
      const full = path.join(root, c.file)
      const temp = `${full}.gf-restore-${process.pid}.tmp`
      fs.writeFileSync(temp, c.next, { flag: 'wx' })
      staged.push({ ...c, full, temp })
    }
    for (const c of staged) { fs.renameSync(c.temp, c.full); committed.push(c) }
    for (const c of committed) if (fs.readFileSync(c.full, 'utf8') !== c.next) throw new Error(`relecture divergente : ${c.file}`)
  } catch (error) {
    for (const c of committed.reverse()) { try { fs.writeFileSync(c.full, c.previous) } catch { /* reported below */ } }
    for (const c of staged) { try { fs.unlinkSync(c.temp) } catch { /* already renamed */ } }
    throw new Error(`écriture interrompue (${error.code || error.message}) — originaux restaurés. ` +
      'Fermez le programme qui verrouille le fichier (éditeur, antivirus, OneDrive), puis relancez.')
  }
}

/**
 * @returns {{ restored: boolean, reason?: string, source?: string, files?: string[],
 *             backup?: string, movedPublicPem?: boolean, tried?: object[] }}
 */
async function restorePublicAnchors(root, options = {}) {
  const env = options.env || process.env
  const inspection = inspectAnchors(root)
  if (inspection.agree) return { restored: false, reason: 'ancrages déjà concordants' }
  const reference = inspection.anchors.find(a => a.id === 'reference')
  if (!inspection.expected || reference.error) {
    return { restored: false, reason: 'REFERENCE_FP absent, dupliqué ou mal formé : aucune référence sûre' }
  }
  if (retiredFingerprints(root).has(inspection.expected)) {
    return { restored: false, reason: 'REFERENCE_FP désigne une clé RETIRÉE : situation incohérente, intervention requise' }
  }
  for (const anchor of inspection.anchors.filter(a => a.kind === 'literal')) {
    // Fichier illisible ou déclaration absente/dupliquée : on ne devine pas où écrire.
    // Une clé illisible dans un littéral UNIQUE, elle, peut être remplacée.
    if (anchor.error && !anchor.error.startsWith('clé publique illisible')) {
      return { restored: false, reason: `${anchor.file} : ${anchor.error} — aucune réécriture approximative` }
    }
  }

  // Une autorité de licence LOCALE qui détient la clé divergente (créée par
  // `config`/keygen sur ce poste) signifie une création ou une rotation NON
  // TERMINÉE, pas une copie parasite : revenir à l'ancienne clé ici serait
  // défait au prochain `config` (qui resynchronise vers sa clé), et la poursuivre
  // changerait l'autorité de toutes les licences. Les deux sont des décisions.
  const divergentFps = inspection.anchors.filter(a => a.kind === 'literal' && a.fingerprint && a.fingerprint !== inspection.expected).map(a => a.fingerprint)
  const authority = localAuthority(root, divergentFps, inspection.expected)
  if (authority) {
    return {
      restored: false,
      decision: true,
      reason: `une autorité de licence LOCALE détient la clé divergente (${authority}) : création ou rotation lancée sur ce poste et non terminée — choix requis`,
      divergent: [...new Set(divergentFps)],
    }
  }

  const found = await findReferencePem(root, inspection.expected, {
    fetchImpl: options.fetchImpl,
    network: options.network ?? env.GF_ANCHOR_RESTORE_NETWORK !== '0',
  })
  if (!found.pem) {
    return { restored: false, reason: `texte de la clé de référence ${inspection.expected.slice(0, 16)}… introuvable`, tried: found.tried }
  }

  const divergent = inspection.anchors.filter(a => a.kind === 'literal' && a.fingerprint !== inspection.expected)
  const changes = divergent.map(anchor => {
    const previous = fs.readFileSync(path.join(root, anchor.file), 'utf8')
    return { file: anchor.file, variable: anchor.variable, from: anchor.fingerprint, previous, next: rewriteLiteral(previous, anchor.variable, found.pem) }
  })

  // Sauvegarde AVANT toute écriture : rien n'est perdu.
  const backup = path.join(BACKUP_DIR, stamp())
  for (const c of changes) {
    const target = path.join(root, backup, c.file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, c.previous, { flag: 'wx' })
  }
  writeAll(root, changes)

  const after = inspectAnchors(root)
  if (!after.agree) {
    for (const c of changes) fs.writeFileSync(path.join(root, c.file), c.previous)
    return { restored: false, reason: 'revérification après écriture en échec — originaux restaurés', tried: found.tried }
  }

  // keys/public.pem portant la clé divergente (keygen local) : déplacé dans la
  // sauvegarde, jamais supprimé — sinon materialize le refuserait juste après.
  let movedPublicPem = false
  const publicPem = path.join(root, 'keys', 'public.pem')
  try {
    const fp = fingerprintOf(fs.readFileSync(publicPem, 'utf8'))
    if (fp !== inspection.expected && changes.some(c => c.from === fp)) {
      const target = path.join(root, backup, 'keys', 'public.pem')
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(publicPem, target, fs.constants.COPYFILE_EXCL)
      fs.unlinkSync(publicPem)
      movedPublicPem = true
    }
  } catch { /* absent ou illisible : materialize décidera */ }

  return {
    restored: true,
    source: found.source,
    reference: inspection.expected,
    files: changes.map(c => `${c.file} (${c.variable}) ${c.from ? `${c.from.slice(0, 16)}…` : '(illisible)'} → ${inspection.expected.slice(0, 16)}…`),
    replacedFingerprints: [...new Set(changes.map(c => c.from).filter(Boolean))],
    backup: backup.split(path.sep).join('/'),
    movedPublicPem,
    tried: found.tried,
  }
}

function describe(result) {
  const lines = []
  if (result.restored) {
    lines.push('🔧 Clé publique de licence : ancrages divergents remis AUTOMATIQUEMENT sur la clé de référence.',
      `   Référence (REFERENCE_FP) : ${result.reference}`,
      `   Source du texte de la clé : ${result.source} — empreinte vérifiée.`)
    for (const f of result.files) lines.push(`   ✔ ${f}`)
    lines.push(`   Originaux sauvegardés : ${result.backup}/`)
    if (result.movedPublicPem) lines.push('   keys/public.pem (clé divergente) déplacé dans cette sauvegarde.')
    for (const fp of result.replacedFingerprints) {
      lines.push(`   ⚠️  La clé écartée ${fp.slice(0, 16)}… n'est PAS la clé de production : des licences signées`,
        '      avec elle seraient refusées. Si une rotation a réellement été décidée, elle se fait avec')
      lines.push('      `npm run keys:sync` (les trois ancres ensemble), pas en modifiant deux fichiers sur trois.')
      break
    }
  } else if (result.decision) {
    const fp = (result.divergent || [])[0] || ''
    lines.push(`Réparation automatique NON appliquée : ${result.reason}.`,
      `   Clé de la nouvelle autorité locale : ${fp.slice(0, 16)}…   Clé de référence (production) : REFERENCE_FP.`,
      '   A. Revenir à la clé de PRODUCTION (licences existantes et serveur conservés — cas habituel) :',
      '      déplacer hors du projet (ne pas supprimer) le dossier keys\\ et le reçu de création de',
      '      clés de `config` (generated-keys.json, dossier de configuration), puis relancer',
      '      `npm run dist` : la remise automatique s\'appliquera. Le keygen devra utiliser la clé',
      '      privée de production (`npm run keys:find-issuer` la cherche sur ce poste).',
      '   B. ADOPTER la nouvelle autorité (toutes les licences existantes deviendront invalides,',
      '      serveur Vercel et vitrine à aligner) : `npm run keys:sync`, puis déplacer',
      '      keys\\private.pem hors du projet (un installeur ne se construit jamais à côté d\'une',
      '      clé privée), puis `npm run dist`.')
  } else {
    lines.push(`Réparation automatique impossible : ${result.reason}.`)
    for (const t of result.tried || []) lines.push(`   – ${t.source} : ${t.outcome}`)
  }
  return lines.join('\n')
}

module.exports = { restorePublicAnchors, findReferencePem, rewriteLiteral, literalPem, describe, SOURCE_REPOSITORY, BACKUP_DIR }

if (require.main === module) {
  restorePublicAnchors(path.resolve(__dirname, '..')).then(result => {
    if (!result.restored && result.reason === 'ancrages déjà concordants') { console.log('✅ Ancrages de la clé publique déjà concordants.'); return }
    const text = describe(result)
    if (result.restored) console.log(text)
    else { console.error(`❌ ${text}`); process.exitCode = 1 }
  }).catch(error => { console.error(`❌ keys:restore : ${error.message}`); process.exitCode = 1 })
}
