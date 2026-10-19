#!/usr/bin/env node
'use strict'
// Restores ONLY the already-pinned PUBLIC build resource (keys/public.pem).
// This is not an independent check of the publisher's external signing
// authority, nor a rotation: it never creates, derives or reads a private key.
//
// ─── The three PUBLIC anchors of the licence key (ES256 / P-256) ─────────────
//   1. electron/main.js                         `const _PK = [ … ]`     (desktop binary)
//   2. src/lib/license/public-key.ts            `const _LINES = [ … ]`  (Next.js server / PWA)
//   3. src/lib/license/__tests__/public-key-consistency.test.ts
//                                               `const REFERENCE_FP = '<sha256>'`
// (3) is the PINNED fingerprint (SHA-256 of the SPKI DER) of the production
// issuer key — the only anchor that is not a key itself, hence the referee.
// All three are committed and MUST designate the same key. They only move
// together, through `npm run keys:sync` after an operator-approved rotation.
//
// A disagreement is ALWAYS blocking: a desktop build whose `_PK` differs from
// the key that signs licences refuses every licence silently (verify → false).
// What changed here is the DIAGNOSTIC: the error now names each anchor, its
// fingerprint (public data), whether it is a retired key, whether the file is
// locally modified compared with the checked-out commit, and the safe remedy.
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createPublicKey, createHash } = require('node:crypto')

const ANCHORS = Object.freeze([
  { id: 'electron', file: 'electron/main.js', variable: '_PK', kind: 'literal' },
  { id: 'server', file: 'src/lib/license/public-key.ts', variable: '_LINES', kind: 'literal' },
  { id: 'reference', file: 'src/lib/license/__tests__/public-key-consistency.test.ts', variable: 'REFERENCE_FP', kind: 'fingerprint' },
])
const RETIRED_SOURCE = 'scripts/check-critical-files.js'

function fingerprint(pem) {
  if (!pem.startsWith('-----BEGIN PUBLIC KEY-----')) throw new Error('Expected public SPKI key')
  return createHash('sha256').update(createPublicKey(pem).export({ type: 'spki', format: 'der' })).digest('hex')
}

/** Reads ONE anchor. Ambiguity (0 or ≥2 declarations) is refused, never resolved by "first match". */
function readAnchor(root, anchor) {
  const result = { ...anchor, fingerprint: null, error: null }
  let text
  try { text = fs.readFileSync(path.join(root, anchor.file), 'utf8') } catch (error) {
    result.error = `fichier illisible (${error.code || error.message})`
    return result
  }
  if (anchor.kind === 'fingerprint') {
    const found = [...text.matchAll(new RegExp(`const\\s+${anchor.variable}\\s*=\\s*'([^']*)'`, 'g'))]
    if (found.length !== 1) { result.error = `${found.length} déclaration(s) de ${anchor.variable} (exactement 1 attendue)`; return result }
    if (!/^[0-9a-f]{64}$/.test(found[0][1])) { result.error = `${anchor.variable} n'est pas une empreinte SHA-256 hexadécimale minuscule`; return result }
    result.fingerprint = found[0][1]
    return result
  }
  const blocks = [...text.matchAll(new RegExp(`const\\s+${anchor.variable}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'g'))]
  if (blocks.length !== 1) { result.error = `${blocks.length} littéral(aux) ${anchor.variable} (exactement 1 attendu)`; return result }
  const pem = [...blocks[0][1].matchAll(/'([^']*)'/g)].map(m => m[1]).join('\n') + '\n'
  try { result.fingerprint = fingerprint(pem); result.pem = pem } catch (error) {
    result.error = `clé publique illisible (${error.message})`
  }
  return result
}

function retiredFingerprints(root) {
  try {
    const text = fs.readFileSync(path.join(root, RETIRED_SOURCE), 'utf8')
    return new Map([...text.matchAll(/\{\s*fp:\s*'([0-9a-f]{64})',\s*retired:\s*'([^']*)'\s*\}/g)].map(m => [m[1], m[2]]))
  } catch { return new Map() }
}

/**
 * Best-effort, read-only: which anchor files differ from the checked-out commit?
 * Returns null when this project is not ITSELF a git repository (ZIP download,
 * no git on PATH, or a PARENT folder that happens to be a repository — where
 * every project file would show up as untracked, not "modified"). Never blocks.
 */
function locallyModified(root, files) {
  try {
    const opts = { cwd: root, encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    const top = spawnSync('git', ['rev-parse', '--show-toplevel'], opts)
    if (top.status !== 0 || top.error) return null
    const norm = p => { const r = fs.realpathSync.native(p); return process.platform === 'win32' ? r.toLowerCase() : r }
    if (norm(top.stdout.trim()) !== norm(root)) return null
    const run = spawnSync('git', ['status', '--porcelain', '--', ...files], opts)
    if (run.status !== 0 || run.error) return null
    // Untracked ("??") is not "modified compared with the commit".
    const changed = run.stdout.split(/\r?\n/).filter(line => line && !line.startsWith('??')).map(line => line.slice(3).trim().replace(/\\/g, '/'))
    return new Map(files.map(file => [file, changed.includes(file)]))
  } catch { return null }
}

/** Read-only inspection shared by the materializer, its tests and diagnostics. */
function inspectAnchors(root) {
  const anchors = ANCHORS.map(anchor => readAnchor(root, anchor))
  const reference = anchors.find(a => a.id === 'reference')
  const expected = reference.fingerprint
  const agree = Boolean(expected) && anchors.every(a => !a.error && a.fingerprint === expected)
  return { anchors, expected, agree }
}

function short(fp) { return fp ? `${fp.slice(0, 16)}…` : '(illisible)' }

function explainDisagreement(root, inspection) {
  const { anchors, expected } = inspection
  const retired = retiredFingerprints(root)
  const modified = locallyModified(root, anchors.map(a => a.file))
  const [electron, server] = anchors
  const lines = ['Public anchors disagree; no key file written', '', 'Ancrages publics de la clé de licence (empreintes SHA-256 SPKI — données publiques) :']
  for (const anchor of anchors) {
    const state = anchor.error ? `ERREUR : ${anchor.error}`
      : anchor.fingerprint === expected ? `${anchor.fingerprint}  ✓`
      : `${anchor.fingerprint}  ✗ DIFFÉRENTE`
    const notes = []
    if (anchor.fingerprint && retired.has(anchor.fingerprint)) notes.push(`clé RETIRÉE (${retired.get(anchor.fingerprint)})`)
    if (modified && modified.get(anchor.file)) notes.push('modifié localement (git status)')
    lines.push(`  • ${anchor.file} (${anchor.variable})`, `      ${state}${notes.length ? `  — ${notes.join(' ; ')}` : ''}`)
  }
  if (!modified) lines.push('  (dossier hors dépôt git — ZIP ou dépôt parent : état local des fichiers non déterminé)')

  lines.push('', 'Cause probable :')
  if (!expected) {
    lines.push('  REFERENCE_FP est absent, dupliqué ou mal formé : la forme de l’ancre a changé.',
      '  Ce script ne choisit JAMAIS une clé à la place de l’empreinte de référence.')
  } else if (electron.fingerprint && electron.fingerprint === server.fingerprint) {
    lines.push(`  Les deux clés embarquées (_PK, _LINES) désignent la même clé ${short(electron.fingerprint)},`,
      `  mais pas la clé de référence ${short(expected)}. Une clé a été régénérée ou recopiée`,
      '  localement (keygen.py --init, copie manuelle d’un tableau, rotation interrompue,',
      '  fusion git) sans passer par `npm run keys:sync`.')
  } else {
    lines.push('  Les littéraux embarqués ne désignent pas la même clé entre eux : mise à jour PARTIELLE',
      '  (copie manuelle dans un seul fichier, synchronisation interrompue ou fusion git).')
  }

  const files = anchors.map(a => a.file).join(' ')
  lines.push('', 'Correctif sûr (aucune clé n’est générée ; seule la clé de référence peut être rétablie) :',
    '  `npm run dist` / `npm run keys:restore` rétablissent _PK et _LINES automatiquement dès que le',
    '  texte de la clé de REFERENCE_FP est prouvé (ancre restée correcte, keys/public.pem, git, GitHub).',
    '  A. Aucune rotation de clé n’a été APPROUVÉE (cas normal) — revenir aux ancrages d’origine :',
    ...(modified ? [
      `       git diff -- ${files}`,
      '       (conserver ailleurs toute autre modification de ces fichiers, puis)',
      `       git restore --source=HEAD -- ${files}`,
    ] : [
      '       dossier sans git (ZIP) : relancer `npm run dist` avec un accès Internet (texte de la clé',
      '       récupéré sur GitHub puis vérifié par empreinte), ou ré-extraire electron/main.js et',
      '       src/lib/license/public-key.ts depuis l’archive d’origine.',
    ]),
    '  B. Une rotation a été approuvée ET la clé privée correspondante est détenue :',
    '       placer SA clé publique dans keys/public.pem, puis `npm run keys:sync` et `npm run keys:check`,',
    '       vérifier `python scripts/keygen_trust.py --verify-key-match`, et mettre à jour la vitrine.',
    '  Puis relancer `npm run dist`. Voir docs/VERIFICATION_CLE_EMETTRICE.md.')
  return lines.join('\n')
}

function materializePublicKey(root) {
  const inspection = inspectAnchors(root)
  if (!inspection.agree) {
    const error = new Error(explainDisagreement(root, inspection))
    error.code = 'GF_PUBLIC_ANCHORS_DISAGREE'
    error.anchors = inspection.anchors.map(({ file, variable, fingerprint: fp, error: problem }) => ({ file, variable, fingerprint: fp, error: problem }))
    throw error
  }
  const { expected } = inspection
  const electron = inspection.anchors.find(a => a.id === 'electron').pem
  const directory = path.join(root, 'keys'), target = path.join(directory, 'public.pem')
  fs.mkdirSync(directory, { recursive: true })
  if (!fs.lstatSync(directory).isDirectory()) throw new Error('Refusing non-directory key path')
  try { fs.writeFileSync(target, electron, { flag: 'wx', mode: 0o644 }); return 'created' }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    // Read/check the SAME opened object. Never lstat-then-read the path.
    const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
    try {
      let actual = null
      try { actual = fs.fstatSync(fd).isFile() ? fingerprint(fs.readFileSync(fd, 'utf8')) : null } catch { actual = null }
      if (actual !== expected) {
        const problem = new Error('Existing public key differs; preserved without modification\n' +
          `  keys/public.pem : ${actual || '(illisible ou non PEM public)'}\n` +
          `  ancrages        : ${expected}\n` +
          '  keys/public.pem n’est pas versionné : il provient d’un keygen local. S’il ne\n' +
          '  correspond pas à la clé privée de production, le déplacer hors du dépôt (ne pas le\n' +
          '  supprimer sans sauvegarde) puis relancer ; sinon suivre la procédure de rotation.')
        problem.code = 'GF_PUBLIC_RESOURCE_DIFFERS'
        throw problem
      }
    } finally { fs.closeSync(fd) }
    return 'unchanged'
  }
}

module.exports = { materializePublicKey, inspectAnchors, ANCHORS }
if (require.main === module) {
  try {
    console.log('Public build resource:', materializePublicKey(path.resolve(__dirname, '..')))
    console.log('Embedded anchors checked; external signing authority NOT independently verified.')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
