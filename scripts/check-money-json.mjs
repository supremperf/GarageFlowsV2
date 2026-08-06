#!/usr/bin/env node
/**
 * check-money-json.mjs — garde-fou CI : AUCUN flottant monétaire dans les JSON
 * PERSISTÉS (WorkOrder.worksJson / WorkOrder.partsJson / PurchaseOrder.linesJson).
 *
 * Règles :
 *   1. Toute ÉCRITURE de `worksJson` / `partsJson` / `linesJson` (clé d'objet ou
 *      affectation membre) doit provenir des sérialiseurs v2
 *      (serializeWorksJsonV2 / serializePartsJsonV2 / serializePoLinesJsonV2)
 *      ou d'un passage VERBATIM contrôlé (documents signés, valeur déjà lue) ;
 *   2. Aucun `JSON.stringify` construisant des propriétés monétaires flottantes
 *      (unitPrice/unitCost/qty/quantity/amount/total) — l'ancien format v1
 *      n'est autorisé qu'en LECTURE (src/lib/money-json.ts) et dans les
 *      fixtures de test qui prouvent justement cette lecture ;
 *   3. Chaque exception est déclarée ci-dessous avec sa justification et DOIT
 *      correspondre à une occurrence réelle (exception morte = échec).
 *
 * Échec = exit 1 avec la liste précise des violations.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

// ── Exceptions PRÉCISES (fichier + fragment de ligne + justification) ─────────
const ALLOWED = [
  {
    file: 'src/components/WorkOrderModal.tsx',
    needle: 'worksJson: JSON.stringify(works), partsJson: JSON.stringify(parts)',
    reason:
      "TRANSPORT client → API (pas une persistance) : l'API re-valide strictement (parse v1/v2) et re-sérialise en v2 via normalizeWorkOrderJson avant toute écriture en base.",
  },
  {
    file: 'src/lib/signature/document.ts',
    needle: "worksJson: entity.worksJson ?? '[]'",
    reason:
      'Canonicalisation VERBATIM du document signé (valeur DÉJÀ persistée, relue telle quelle) — le JSON signé est gelé à vie, aucune ré-écriture.',
  },
  {
    file: 'src/lib/signature/document.ts',
    needle: "partsJson: entity.partsJson ?? '[]'",
    reason: 'Idem : passage verbatim du JSON signé, jamais reconstruit.',
  },
]

// Fixtures v1 de test : prouvent la LECTURE du format historique (chemin de
// migration/réception) — fichiers entiers autorisés pour la règle n°2.
const V1_FIXTURE_FILES = new Set([
  'src/integration/suppliers.test.ts',
  'src/lib/__tests__/money-json.test.ts',
  'src/lib/__tests__/money-schema-migration.test.ts',
])

const EXTS = new Set(['.ts', '.tsx', '.js', '.mjs'])
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'server-client', 'generated', '__pycache__'])

function* walk(dir) {
  for (const item of readdirSync(dir)) {
    const p = path.join(dir, item)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(item)) yield* walk(p)
    } else if (EXTS.has(path.extname(item))) {
      yield p
    }
  }
}

const SCAN_ROOTS = ['src', 'electron', 'prisma', 'scripts'].map((d) => path.join(ROOT, d))

// RHS autorisées pour une écriture de *Json (v2 uniquement, ou relais contrôlé).
const SAFE_RHS = [
  /^serialize(Works|Parts|PoLines)JsonV2\(/, // sérialiseur v2 (seul producteur)
  /^normalized\.(works|parts)Json\b/, //       résultat de normalizeWorkOrderJson (v2)
  /^(works|parts|lines)Json\b/, //             variable locale du même nom (produite par serialize*V2 au-dessus)
  /^string\b/, //                              annotation de type
  /^true\b/, //                                `select: { worksJson: true }`
  /^'\[\]'/, //                                vide canonique
]

const errors = []
const usedAllowed = new Set()

for (const rootDir of SCAN_ROOTS) {
  for (const file of walk(rootDir)) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/')
    if (rel === 'scripts/check-money-json.mjs') continue
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')

    lines.forEach((line, i) => {
      const loc = `${rel}:${i + 1}`
      const allowedHere = ALLOWED.find((a) => a.file === rel && line.includes(a.needle))
      if (allowedHere) {
        usedAllowed.add(allowedHere)
        return
      }

      // Règle 1 : écritures de worksJson/partsJson/linesJson. Les fichiers de
      // fixtures v1 (V1_FIXTURE_FILES) en sont exemptés : ils PERSISTENT
      // volontairement l'ancien format pour prouver que sa lecture fonctionne.
      const writeRe = /(?:^|[^.\w])((?:works|parts|lines)Json)\s*([:=])\s*([^,\n]*)/g
      for (const m of V1_FIXTURE_FILES.has(rel) ? [] : line.matchAll(writeRe)) {
        if (m[2] === '=' && /^=/.test(m[3])) continue // comparaison ==/===
        // Ternaire de LECTURE `cond ? body.worksJson : existing.worksJson` :
        // la clé d'objet n'est jamais précédée d'un point — déjà exclu par la
        // classe [^.\w] ; ici on exclut les fins de ternaire (RHS commence par
        // un accès membre vers la même propriété).
        const rhs = m[3].trim()
        if (/^(body|existing|entity|wo|order|row|o)\.(works|parts|lines)Json\b/.test(rhs)) continue
        if (rhs === '' || SAFE_RHS.some((re) => re.test(rhs))) continue
        errors.push(`${loc} : écriture de ${m[1]} hors sérialiseur v2 → « ${rhs.slice(0, 80)} »`)
      }

      // Règle 2 : JSON.stringify avec propriétés monétaires flottantes.
      if (
        /JSON\.stringify/.test(line) &&
        /\b(unitPrice|unitCost|qty|quantity|amount|total)\s*:/.test(line) &&
        !V1_FIXTURE_FILES.has(rel)
      ) {
        errors.push(`${loc} : JSON.stringify d'un objet à propriété monétaire flottante (format v1 interdit en écriture)`)
      }
    })
  }
}

for (const a of ALLOWED) {
  if (!usedAllowed.has(a)) {
    errors.push(`exception MORTE : ${a.file} — « ${a.needle} » introuvable (retirer ou corriger la liste ALLOWED)`)
  }
}

if (errors.length) {
  console.error(`\n❌ JSON monétaires : ${errors.length} violation(s) :`)
  for (const e of errors) console.error(`   • ${e}`)
  process.exit(1)
}
console.log(
  `✅ JSON monétaires : toutes les écritures de worksJson/partsJson/linesJson passent par les sérialiseurs v2 (${ALLOWED.length} exceptions justifiées, ${V1_FIXTURE_FILES.size} fichiers de fixtures v1 en lecture).`,
)
