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
import { spawnSync } from 'node:child_process'
import { join, relative } from 'node:path'
import { parseAutoBlock, COMPONENTS } from './baseline-doc.mjs'

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

/**
 * Répertoires jamais documentaires : dépendances, sorties de build, dossiers
 * d'outillage. Utilisé UNIQUEMENT par le repli hors dépôt.
 */
const NON_DOCUMENTAIRES = new Set([
  'node_modules', '.next', '.git', '.claude', '.turbo', '.vercel',
  'dist', 'out', 'build', 'coverage', 'release',
])

function collectMarkdown(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (NON_DOCUMENTAIRES.has(entry)) continue
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) collectMarkdown(p, out)
    else if (entry.toLowerCase().endsWith('.md')) out.push(p)
  }
}

/**
 * Inventaire des documents DU DÉPÔT — suivis, plus les nouveaux non encore
 * ajoutés, jamais les ignorés.
 *
 * GF31-AUD-066 — la marche sur disque voyait tout ce qui traînait. Un ancien
 * worktree oublié sous `.claude/` embarquait sa propre copie de la baseline
 * canonique, et la garde annonçait « 2 sources canoniques déclarées » sur un
 * dépôt qui n'en suit qu'une. La porte de release échouait donc sur un résidu
 * local, invisible pour quiconque relit le dépôt : verdict irreproductible,
 * et faux rouge — le symétrique exact du faux vert que ce fichier proscrit.
 *
 * `--others --exclude-standard` conserve la propriété qui compte : un second
 * document canonique tout juste écrit, pas encore `git add`, est TOUJOURS vu.
 * Seul l'ignoré disparaît.
 *
 * Hors dépôt (copie de travail détachée, tarball), on retombe sur la marche
 * disque : dégradé, jamais silencieux — même principe qu'en GF31-AUD-065.
 *
 * @returns {string[] | null} chemins absolus, ou null si git ne répond pas.
 */
function gitMarkdown(root) {
  let r
  try {
    r = spawnSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true,
    })
  } catch {
    return null
  }
  if (!r || r.error || r.status !== 0 || typeof r.stdout !== 'string') return null
  return r.stdout
    .split('\0')
    .filter((p) => p.toLowerCase().endsWith('.md'))
    .map((p) => join(root, p))
}

function listMarkdown(root) {
  const suivis = gitMarkdown(root)
  // Un inventaire git qui ne contient même pas la baseline canonique alors
  // qu'elle est sur disque n'est pas digne de confiance ici (checkout partiel,
  // fichier ignoré par erreur) : mieux vaut la marche disque qu'un vert obtenu
  // sur une liste vide. Le faux rouge se corrige ; le faux vert se découvre en
  // production.
  if (suivis?.some((p) => relative(root, p).split(/[\\/]/).join('/') === CANONICAL)) return suivis
  const out = []
  collectMarkdown(root, out)
  return out
}

/**
 * Vérifie que la baseline CANONIQUE humaine reflète EXACTEMENT la baseline
 * machine (bloc AUTO-GÉNÉRÉ) : comptes de tests ET versions de toolchain
 * RÉSOLUES. C'est ce contrôle qui ferme les deux régressions V15 :
 *   - le doc affichait 1360/1332 alors que la machine mesure 1396/1368 ;
 *   - le doc/le générateur affichait Prisma 5.16.1 (plage tronquée) au lieu de
 *     la version résolue 5.22.0.
 * Actif uniquement pour une baseline machine « v2 » (avec toolchain.dependencies).
 * @returns {Array<{file:string,line:number,kind:string,label:string,text:string}>}
 */
export function checkCanonicalBaseline(root, baseline) {
  const violations = []
  if (!baseline || !baseline.toolchain || !baseline.toolchain.dependencies) return violations
  const canonPath = join(root, CANONICAL)
  if (!existsSync(canonPath)) return violations // présence gérée par la règle (1)

  const raw = readFileSync(canonPath, 'utf8')
  const parsed = parseAutoBlock(raw)
  if (!parsed) {
    violations.push({ file: CANONICAL, line: 0, kind: 'baseline-auto-missing',
      label: 'bloc AUTO-GENERATED BASELINE absent de la baseline canonique — lancez `npm run baseline:generate`', text: '' })
    return violations
  }

  // (a) Comptes de tests : doc vs machine.
  const bt = baseline.tests ?? {}
  const machineDiscovered = bt.discovered ?? bt.total
  const countPairs = [
    ['discovered', parsed.tests.discovered, machineDiscovered],
    ['passed', parsed.tests.passed, bt.passed],
    ['failed', parsed.tests.failed, bt.failed],
    ['skipped', parsed.tests.skipped, bt.skipped],
    ['files', parsed.tests.files, bt.files],
  ]
  const countMismatch = countPairs.filter(([, doc, mac]) => mac != null && doc != null && Number(doc) !== Number(mac))
  if (countMismatch.length) {
    const detail = countMismatch.map(([k, doc, mac]) => `${k}: doc=${doc} machine=${mac}`).join(' ; ')
    violations.push({ file: CANONICAL, line: 0, kind: 'baseline-test-count',
      label: `Canonical baseline test count mismatch — ${detail}. Regenerate the canonical baseline (npm run baseline:generate).`, text: '' })
  }

  // (b) Versions de toolchain RÉSOLUES : doc vs machine.
  for (const c of COMPONENTS) {
    const machine = baseline.toolchain.dependencies[c.dep]?.resolved
    const doc = parsed.versions[c.dep]
    if (machine != null && doc != null && doc !== String(machine)) {
      violations.push({ file: CANONICAL, line: 0, kind: 'baseline-toolchain',
        label: `Canonical baseline toolchain mismatch — ${c.label}: doc=${doc} machine(resolved)=${machine}. Regenerate the canonical baseline.`, text: '' })
    }
  }

  return violations
}

/**
 * @param {string} root  dossier racine à scanner
 * @param {{baseline?: {tests?: {total?: number, passed?: number}}}} opts
 */
export function checkDocsConsistency(root, opts = {}) {
  const baseline = opts.baseline ?? null
  const files = listMarkdown(root)
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

  // (5) La baseline canonique humaine doit refléter la baseline machine (comptes
  //     de tests + versions résolues). C'est le contrôle qui EXAMINE le fichier
  //     canonique lui-même (les règles 2-4 l'exemptent volontairement).
  violations.push(...checkCanonicalBaseline(root, baseline))

  return { ok: violations.length === 0, violations, scanned: files.length }
}

export const CANONICAL_PATH = CANONICAL
export { existsSync }
