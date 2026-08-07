/**
 * baseline-doc.mjs — rendu & lecture du BLOC AUTO-GÉNÉRÉ de la baseline humaine.
 *
 * Source UNIQUE de la représentation lisible des faits machine (toolchain résolue
 * + comptes de tests). Le générateur ÉCRIT ce bloc dans
 * `docs/audit/FINAL_VERIFICATION_BASELINE.md` à partir de
 * `artifacts/verification/baseline.json` ; le garde-fou `check-docs-consistency`
 * RELIT ce même bloc et le compare à la baseline machine. Générateur et garde
 * partagent donc EXACTEMENT le même format (aucune divergence de parsing possible).
 */

export const AUTO_BEGIN = '<!-- BEGIN AUTO-GENERATED BASELINE (source: artifacts/verification/baseline.json — `npm run baseline:generate`) -->'
export const AUTO_END = '<!-- END AUTO-GENERATED BASELINE -->'

/** Composants affichés : libellé humain ↔ clé de dépendance dans baseline.toolchain.dependencies. */
export const COMPONENTS = [
  { label: 'Next.js', dep: 'next' },
  { label: 'React', dep: 'react' },
  { label: 'React DOM', dep: 'react-dom' },
  { label: 'TypeScript', dep: 'typescript' },
  { label: 'Prisma (CLI)', dep: 'prisma' },
  { label: '@prisma/client', dep: '@prisma/client' },
  { label: 'Electron', dep: 'electron' },
  { label: 'Vitest', dep: 'vitest' },
]

function resolvedOf(baseline, dep) {
  const d = baseline?.toolchain?.dependencies?.[dep]
  if (!d) return 'n/a'
  return d.resolved ?? d.status ?? 'n/a'
}
function declaredOf(baseline, dep) {
  const d = baseline?.toolchain?.dependencies?.[dep]
  return (d && d.declared) ? d.declared : '—'
}

/** Rend le bloc markdown AUTO à partir d'une baseline machine (objet parsé). */
export function renderAutoBlock(baseline) {
  const t = baseline?.tests ?? {}
  const tc = baseline?.toolchain ?? {}
  const discovered = t.discovered ?? t.total ?? 'n/a'
  const compRows = COMPONENTS.map((c) => `| ${c.label} | ${resolvedOf(baseline, c.dep)} | ${declaredOf(baseline, c.dep)} |`)
  return [
    AUTO_BEGIN,
    '',
    '### Toolchain (versions RÉSOLUES / verrouillées)',
    '',
    '> `Version résolue` = version réellement installée / verrouillée (package-lock).',
    '> `Plage déclarée` = contrainte semver du package.json (jamais présentée comme la version installée).',
    '',
    '| Composant | Version résolue | Plage déclarée |',
    '|---|---|---|',
    `| Node | ${tc.node ?? 'n/a'} | — |`,
    `| npm | ${tc.npm ?? 'n/a'} | — |`,
    ...compRows,
    `| OS | ${tc.os ?? 'n/a'} | — |`,
    '',
    '### Tests (suite standard `npm test`, reproductible sans service externe)',
    '',
    '| Champ | Valeur |',
    '|---|---|',
    `| Test files | ${t.files ?? 'n/a'} |`,
    `| Tests discovered | ${discovered} |`,
    `| Tests passed | ${t.passed ?? 'n/a'} |`,
    `| Tests failed | ${t.failed ?? 'n/a'} |`,
    `| Tests skipped | ${t.skipped ?? 'n/a'} |`,
    '',
    `Commit : \`${baseline?.commitShort ?? 'n/a'}\` · Branche : \`${baseline?.branch ?? 'n/a'}\` · Généré (UTC) : \`${baseline?.generatedAtUtc ?? 'n/a'}\``,
    '',
    AUTO_END,
  ].join('\n')
}

/** Extrait la sous-chaîne du bloc AUTO d'un document, ou null si absent. */
export function extractAutoBlock(docText) {
  const i = docText.indexOf(AUTO_BEGIN)
  if (i === -1) return null
  const j = docText.indexOf(AUTO_END, i)
  if (j === -1) return null
  return docText.slice(i, j + AUTO_END.length)
}

/**
 * Remplace le bloc AUTO d'un document par `block`. Si les marqueurs sont absents,
 * renvoie null (l'appelant décide : insérer, ou signaler l'absence).
 */
export function replaceAutoBlock(docText, block) {
  const existing = extractAutoBlock(docText)
  if (existing == null) return null
  return docText.replace(existing, block)
}

/**
 * Lit les champs machine-vérifiables du bloc AUTO d'un document (ou null si absent).
 * @param {string} docText
 * @returns {({ tests: { files: (number|null), discovered: (number|null), passed: (number|null), failed: (number|null), skipped: (number|null) }, versions: Record<string, string> })|null}
 */
export function parseAutoBlock(docText) {
  const block = extractAutoBlock(docText)
  if (!block) return null
  const num = (label) => {
    const m = block.match(new RegExp(`\\|\\s*${label}\\s*\\|\\s*(\\d+)\\s*\\|`))
    return m ? Number(m[1]) : null
  }
  /** @type {Record<string, string>} */
  const versions = {}
  for (const c of COMPONENTS) {
    const esc = c.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // 1re colonne après le libellé = version résolue.
    const m = block.match(new RegExp(`\\|\\s*${esc}\\s*\\|\\s*([^|]+?)\\s*\\|`))
    if (m) versions[c.dep] = m[1].trim()
  }
  return {
    tests: {
      files: num('Test files'),
      discovered: num('Tests discovered'),
      passed: num('Tests passed'),
      failed: num('Tests failed'),
      skipped: num('Tests skipped'),
    },
    versions,
  }
}
