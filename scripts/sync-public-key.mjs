#!/usr/bin/env node
/**
 * sync-public-key.mjs — propage keys/public.pem dans TOUS ses points d'ancrage.
 *
 * POURQUOI CE SCRIPT EXISTE
 * La clé publique ECC P-256 qui vérifie les licences est recopiée à la main dans
 * trois endroits du dépôt (deux littéraux + une empreinte de test). À chaque
 * régénération de paire, l'opérateur en met à jour une partie et oublie le
 * reste — le scénario s'est produit deux fois (f6ef4db puis a6fbff7), avec la
 * même conséquence : `verify()` renvoie `false` sans message et l'utilisateur
 * est verrouillé hors de son propre logiciel.
 *
 * `check:public-key` DÉTECTE la divergence ; ce script la RÉPARE, en une
 * commande, à partir de la seule source de vérité locale : keys/public.pem, le
 * fichier dont keys/private.pem signe réellement les licences.
 *
 * Usage :
 *   node scripts/sync-public-key.mjs           # écrit les fichiers
 *   node scripts/sync-public-key.mjs --check   # n'écrit rien, sort 1 si divergence
 *
 * RAPPEL : la vitrine (garagesite3) vit dans un AUTRE dépôt — aucun script local
 * ne peut l'atteindre. Après une rotation, elle reste à mettre à jour à la main.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createPublicKey, createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PEM = path.join(ROOT, 'keys', 'public.pem')
const CHECK_ONLY = process.argv.includes('--check')

const LITERALS = [
  { file: path.join(ROOT, 'electron', 'main.js'), varName: '_PK', label: 'electron/main.js (_PK)' },
  { file: path.join(ROOT, 'src', 'lib', 'license', 'public-key.ts'), varName: '_LINES', label: 'src/lib/license/public-key.ts (_LINES)' },
]
const FP_ANCHOR = {
  file: path.join(ROOT, 'src', 'lib', 'license', '__tests__', 'public-key-consistency.test.ts'),
  varName: 'REFERENCE_FP',
  label: 'src/lib/license/__tests__/public-key-consistency.test.ts (REFERENCE_FP)',
}

function fail(msg) {
  console.error(`\n❌ sync:public-key — ${msg}\n`)
  process.exit(1)
}

/** Empreinte canonique : SHA-256 du DER SPKI (insensible aux fins de ligne). */
function fingerprint(pem) {
  return createHash('sha256').update(createPublicKey(pem).export({ type: 'spki', format: 'der' })).digest('hex')
}

if (!existsSync(PEM)) {
  // keys/public.pem est gitignoré : hors de la machine de build il n'existe pas.
  // En lecture seule on le DIT plutôt que d'échouer ; en écriture, sans source de
  // vérité, il n'y a rien à propager (règle « pas de fausse validation »).
  if (CHECK_ONLY) {
    console.log('⏭️  sync:public-key --check — NON EXÉCUTÉ : keys/public.pem absent (gitignoré).')
    console.log('   AUCUNE comparaison n\'a eu lieu. La cohérence interne des ancrages reste,')
    console.log('   elle, vérifiée par check:critical-files.')
    process.exit(0)
  }
  fail('keys/public.pem est absent (il est gitignoré). Placez la clé publique de\n' +
    '   votre keygen à cet emplacement — c\'est la seule source de vérité de ce script.')
}

let referencePem
try {
  referencePem = readFileSync(PEM, 'utf8').replace(/\r\n/g, '\n').trim()
  createPublicKey(referencePem)
} catch (e) {
  fail(`keys/public.pem illisible ou n'est pas une clé publique valide : ${e.message}`)
}
const referenceFp = fingerprint(referencePem)
const pemLines = referencePem.split('\n').map((l) => l.trim()).filter(Boolean)

const changes = []

/** Réécrit un littéral `const <varName> = [ '…', … ]` en conservant son indentation. */
function syncLiteral({ file, varName, label }) {
  const source = readFileSync(file, 'utf8')
  const block = source.match(new RegExp(`(const\\s+${varName}\\s*=\\s*\\[)([\\s\\S]*?)(\\])`))
  if (!block) {
    fail(`littéral \`const ${varName} = [...]\` introuvable dans ${label} — la clé publique\n` +
      '   embarquée a changé de forme : METTEZ CE SCRIPT À JOUR, ne le contournez pas.')
  }

  const current = Array.from(block[2].matchAll(/'([^']*)'/g), (m) => m[1]).join('\n')
  let currentFp = null
  try { currentFp = fingerprint(current) } catch { /* littéral illisible : on le remplace */ }
  if (currentFp === referenceFp) return

  // Indentation reprise de la première entrée existante, sinon deux espaces.
  const indent = block[2].match(/\n([ \t]+)'/)?.[1] ?? '  '
  const body = `\n${pemLines.map((l) => `${indent}'${l}',`).join('\n')}\n`
  changes.push({ label, from: currentFp, file, next: source.replace(block[0], `${block[1]}${body}${block[3]}`) })
}

/** Réécrit `const REFERENCE_FP = '<hex>'` en conservant le commentaire de fin de ligne. */
function syncFingerprintAnchor({ file, varName, label }) {
  const source = readFileSync(file, 'utf8')
  const m = source.match(new RegExp(`(const\\s+${varName}\\s*=\\s*')([0-9a-f]{64})(')`))
  if (!m) {
    fail(`\`const ${varName} = '<64 hex>'\` introuvable dans ${label} — l'ancre d'empreinte\n` +
      '   a changé de forme : METTEZ CE SCRIPT À JOUR, ne le contournez pas.')
  }
  if (m[2] === referenceFp) return
  changes.push({ label, from: m[2], file, next: source.replace(m[0], `${m[1]}${referenceFp}${m[3]}`) })
}

/**
 * Inscrit la clé sortante dans la liste des empreintes RETIRÉES de
 * check-critical-files.js, pour qu'un retour en arrière soit refusé par la garde
 * au lieu de reverrouiller l'utilisateur hors de son logiciel sans message.
 */
function retireOutgoing(outgoingFp) {
  const file = path.join(ROOT, 'scripts', 'check-critical-files.js')
  const source = readFileSync(file, 'utf8')
  const m = source.match(/(const\s+RETIRED_FINGERPRINTS\s*=\s*\[)([\s\S]*?)(\n\])/)
  if (!m) {
    console.warn('⚠ RETIRED_FINGERPRINTS introuvable dans scripts/check-critical-files.js —\n' +
      `   ajoutez l'empreinte sortante ${outgoingFp} à la main.`)
    return
  }

  const entries = Array.from(m[2].matchAll(/\{\s*fp:\s*'([0-9a-f]{64})',\s*retired:\s*'([^']*)'\s*\},?/g),
    (e) => ({ fp: e[1], retired: e[2] }))

  // Une re-rotation peut ramener une clé anciennement retirée : elle redevient
  // active et doit QUITTER la liste, sans quoi la garde refuserait la bonne clé.
  const revived = entries.some((e) => e.fp === referenceFp)
  const kept = entries.filter((e) => e.fp !== referenceFp)
  const already = kept.some((e) => e.fp === outgoingFp)
  if (already && !revived) return

  const today = new Date().toISOString().slice(0, 10)
  if (!already) kept.push({ fp: outgoingFp, retired: `${today} (rotation)` })

  const body = `\n${kept.map((e) => `  { fp: '${e.fp}', retired: '${e.retired}' },`).join('\n')}`
  const notes = []
  if (!already) notes.push(`empreinte sortante ${outgoingFp.slice(0, 16)}… inscrite comme retirée`)
  if (revived) notes.push(`empreinte réactivée ${referenceFp.slice(0, 16)}… retirée de la liste`)
  changes.push({
    label: 'scripts/check-critical-files.js (RETIRED_FINGERPRINTS)',
    from: '(liste)',
    file,
    next: source.replace(m[0], `${m[1]}${body}${m[3]}`),
    note: notes.join(' ; '),
  })
}

const outgoing = (() => {
  const pem = (() => {
    const src = readFileSync(LITERALS[1].file, 'utf8')
    const b = src.match(/const\s+_LINES\s*=\s*\[([\s\S]*?)\]/)
    return b ? Array.from(b[1].matchAll(/'([^']*)'/g), (x) => x[1]).join('\n') : null
  })()
  try { return pem ? fingerprint(pem) : null } catch { return null }
})()

for (const l of LITERALS) syncLiteral(l)
syncFingerprintAnchor(FP_ANCHOR)
if (outgoing && outgoing !== referenceFp) retireOutgoing(outgoing)

if (changes.length === 0) {
  console.log(`✅ sync:public-key — ${LITERALS.length + 1} ancrages déjà alignés sur keys/public.pem (${referenceFp.slice(0, 16)}…)`)
  process.exit(0)
}

if (CHECK_ONLY) {
  console.error(`\n❌ sync:public-key --check — ${changes.length} ancrage(s) divergent(s) de keys/public.pem :\n`)
  for (const c of changes) console.error(`   ${c.label}\n      attendu ${referenceFp}\n      trouvé  ${c.from ?? '(illisible)'}`)
  console.error('\n   Réparez d\'une commande : npm run keys:sync\n')
  process.exit(1)
}

for (const c of changes) {
  writeFileSync(c.file, c.next)
  console.log(`✔ ${c.label}\n    ${c.note ?? `${c.from ?? '(illisible)'} → ${referenceFp}`}`)
}
console.log(`\n✅ sync:public-key — ${changes.length} ancrage(s) réalignés sur ${referenceFp.slice(0, 16)}…`)
console.log('   N\'OUBLIEZ PAS la vitrine garagesite3 (autre dépôt) : elle doit porter la MÊME clé.')
