/**
 * docs-consistency.mjs — cœur TESTABLE du garde-fou de cohérence documentaire.
 *
 * Vérifie, sur un dossier de documentation, qu'il n'existe AUCUNE contradiction
 * de due diligence entre documents actifs :
 *   1. exactement UNE source canonique (marqueur `doc-role: canonical-baseline`) ;
 *   2. aucune revendication canonique forte (« seule source de vérité »,
 *      « source de vérité unique », « single source of truth ») hors du fichier
 *      canonique — sauf en pointeur explicite vers lui ;
 *   3. aucun compte de tests COURANT ≠ baseline dans un doc actif non-journal ;
 *   4. aucune affirmation de statut trop favorable (production ready, aucun
 *      bloqueur, inviolable…).
 *
 * Marqueurs de document (en tête) :
 *   - `doc-status: historique` → doc ignoré (instantané figé).
 *   - `doc-numbers: journal`   → comptes datés point-dans-le-temps : exempté du
 *     contrôle de compte COURANT (règles 2 et 4 s'appliquent quand même).
 *
 * `checkDocsConsistency(root, { baseline })` → { ok, violations, scanned }.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const CANONICAL = 'docs/audit/FINAL_VERIFICATION_BASELINE.md'
const CANONICAL_MARKER = 'doc-role: canonical-baseline'

/** Minuscules + suppression des accents (comparaison robuste). */
function norm(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

const FORBIDDEN_STATUS = [
  { re: /aucun(e)?\s+bloqu(eur|ant)/, label: '« aucun bloqueur/bloquant »' },
  { re: /zero\s+bloqu(eur|ant)/, label: '« zéro bloqueur »' },
  { re: /production[\s-]?ready/, label: '« production ready »' },
  { re: /100\s*%\s*(pret|prete|ready|prod)/, label: '« 100 % prêt »' },
  { re: /tous\s+les\s+tests\s+passent/, label: '« tous les tests passent »' },
  { re: /aucune\s+action\s+(necessaire|requise)/, label: '« aucune action nécessaire/requise »' },
  { re: /inviolable/, label: '« inviolable » (aucune protection logicielle locale ne l\'est)' },
]

// Revendications canoniques FORTES (normalisées).
const CANONICAL_CLAIMS = [
  'seule source de verite',
  'source de verite unique',
  'unique source de verite',
  'single source of truth',
]

/** Une ligne « discute/nie » un terme si elle porte un marqueur de citation. */
function isNeutralizedLine(n, line) {
  if (n.includes('ne jamais') || n.includes('ne pas annoncer') || n.includes('interdit')) return true
  if ((line.includes('«') || line.includes('»')) && n.includes('inviolable')) return true
  return false
}

/** Marqueur historique de section (par titre) ou de ligne. */
function isHistoricalContext(n) {
  return n.includes('historique') || n.includes('historical') ||
    n.includes('not current') || n.includes('divergent') || n.includes('instantane')
}

function collectMarkdown(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) collectMarkdown(p, out)
    else if (entry.toLowerCase().endsWith('.md')) out.push(p)
  }
}

/**
 * @param {string} root  dossier racine à scanner
 * @param {{baseline?: {tests?: {total?: number, passed?: number}}}} opts
 */
export function checkDocsConsistency(root, opts = {}) {
  const baseline = opts.baseline ?? null
  const files = []
  collectMarkdown(root, files)
  const violations = []

  // Comptes de tests COURANTS autorisés (issus de la baseline machine).
  const allowedCounts = new Set()
  if (baseline?.tests?.total != null) allowedCounts.add(Number(baseline.tests.total))
  if (baseline?.tests?.passed != null) allowedCounts.add(Number(baseline.tests.passed))

  let canonicalMarkerCount = 0
  const canonicalHolders = []

  for (const file of files) {
    const rel = relative(root, file).split('\\').join('/')
    const raw = readFileSync(file, 'utf8')
    const nraw = norm(raw)
    const isCanonical = rel === CANONICAL || nraw.includes(norm(CANONICAL_MARKER))
    if (nraw.includes(norm(CANONICAL_MARKER))) { canonicalMarkerCount++; canonicalHolders.push(rel) }

    if (nraw.includes('doc-status: historique')) continue // annexe figée : ignorée
    const isJournal = nraw.includes('doc-numbers: journal')

    const lines = raw.split('\n')
    let sectionHistorical = false
    lines.forEach((line, i) => {
      const n = norm(line)
      if (line.startsWith('#')) sectionHistorical = isHistoricalContext(n) // titre de section
      const lineHistorical = sectionHistorical || isHistoricalContext(n)

      // (2) Revendication canonique forte hors fichier canonique.
      if (!isCanonical) {
        for (const claim of CANONICAL_CLAIMS) {
          if (n.includes(claim)) {
            // Autorisé UNIQUEMENT en pointeur explicite vers le fichier canonique.
            if (!n.includes('final_verification_baseline')) {
              violations.push({ file: rel, line: i + 1, kind: 'canonical-claim',
                label: `revendication canonique « ${claim} » hors baseline canonique`, text: line.trim().slice(0, 120) })
            }
          }
        }
      }

      // (3) Compte de tests COURANT != baseline (docs actifs non-journal).
      // Detection PRECISE d'un compte GLOBAL : un nombre >= 1000 DIRECTEMENT
      // adjacent a un mot-cle de comptage (` 1 351 tests `, ` tests ... 1323
      // verts/passes/passed `). Evite dates, dimensions, montants, ports,
      // suffixes cryptographiques et petits comptes par-suite (< 1000).
      if (!isCanonical && !isJournal && !lineHistorical && allowedCounts.size) {
        const nums = []
        const NUM = '(\\d[\\d\\s\\u202f]{3,}\\d|\\d{4,})'
        const before = new RegExp(NUM + '\\s*(tests?|suites?)\\b', 'gi')
        const after = new RegExp('\\btests?\\b[^.\\n]{0,24}?' + NUM + '\\s*(verts?|passe|passes|passees|reussis|passing|passent|green|ok)\\b', 'gi')
        let m
        while ((m = before.exec(line))) nums.push(m[1])
        while ((m = after.exec(line))) nums.push(m[1])
        for (const raw2 of nums) {
          const val = Number(String(raw2).replace(/[\s\u202f]/g, ''))
          if (val >= 1000 && !allowedCounts.has(val)) {
            violations.push({ file: rel, line: i + 1, kind: 'test-count',
              label: 'compte de tests courant ' + val + ' != baseline (' + [...allowedCounts].join('/') + ')', text: line.trim().slice(0, 120) })
          }
        }
      }

      // (4) Affirmations de statut trop favorables.
      if (!isCanonical && !isNeutralizedLine(n, line)) {
        for (const f of FORBIDDEN_STATUS) {
          if (f.re.test(n)) violations.push({ file: rel, line: i + 1, kind: 'status', label: f.label, text: line.trim().slice(0, 120) })
        }
      }
    })
  }

  // (1) Exactement une source canonique.
  if (canonicalMarkerCount === 0) {
    violations.push({ file: '(global)', line: 0, kind: 'canonical-count', label: `aucune source canonique (marqueur « ${CANONICAL_MARKER} » absent)`, text: '' })
  } else if (canonicalMarkerCount > 1) {
    violations.push({ file: '(global)', line: 0, kind: 'canonical-count', label: `${canonicalMarkerCount} sources canoniques déclarées (attendu : 1) : ${canonicalHolders.join(', ')}`, text: '' })
  }

  return { ok: violations.length === 0, violations, scanned: files.length }
}

export const CANONICAL_PATH = CANONICAL
export { existsSync }
