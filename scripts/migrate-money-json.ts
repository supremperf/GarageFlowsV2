/**
 * migrate-money-json.ts — Migration JSON monétaire v1 → v2 (PostgreSQL SERVEUR).
 *
 * Équivalent EXACT, côté base serveur, de la migration SQLite `179_money_json_v2`
 * du runner desktop (src/app/api/internal/migrate/route.ts) : mêmes schémas Zod,
 * même conversion, même tolérance — le module src/lib/money-json.ts est PARTAGÉ,
 * aucune logique dupliquée.
 *
 * Ce qui est migré :
 *   - WorkOrder.worksJson / WorkOrder.partsJson des ordres NON SIGNÉS
 *     (signedAt IS NULL AND signatureData IS NULL) — le JSON des documents
 *     signés est canonicalisé VERBATIM dans la signature (lib/signature) :
 *     il est GELÉ à vie et n'est JAMAIS réécrit ;
 *   - PurchaseOrder.linesJson (jamais signés) — tous.
 *
 * SÛRETÉ (fail-closed) :
 *   - lecture + vérification + écriture dans UNE transaction : le moindre échec
 *     (JSON invalide, divergence de total au-delà de la tolérance) annule TOUT ;
 *   - tolérance identique au runner SQLite : |total recalculé − totalHtCents
 *     stocké| ≤ max(1, nombre de lignes) centimes ; le total STOCKÉ reste la
 *     référence — au-delà, ARRÊT (aucune écriture) ;
 *   - le v2 produit est RE-PARSÉ avant écriture (jamais de blob non relisible) ;
 *   - idempotent : un document déjà en v2 est ignoré (ré-exécution sans effet) ;
 *   - les erreurs ne contiennent que des identifiants techniques (id, comptes),
 *     jamais de données client.
 *
 * Usage :
 *   DATABASE_URL=postgresql://… npm run db:server:migrate-json            # exécution
 *   DATABASE_URL=postgresql://… npm run db:server:migrate-json -- --dry-run  # simulation
 *
 * Prérequis : `prisma migrate deploy --schema prisma/server/schema.prisma`
 * appliqué (colonnes cents présentes) + SAUVEGARDE pg_dump (docs/MIGRATION-MONEY.md).
 */

import { PrismaClient } from '../src/generated/server-client'
import {
  parseWorksJson,
  parsePartsJson,
  parsePoLinesJson,
  serializeWorksJsonV2,
  serializePartsJsonV2,
  serializePoLinesJsonV2,
  workOrderTotalHtCents,
  poTotalHtCents,
} from '../src/lib/money-json'

const DRY_RUN = process.argv.includes('--dry-run')

interface Summary {
  workOrdersMigrated: number
  workOrdersAlreadyV2: number
  workOrdersSignedFrozen: number
  purchaseOrdersMigrated: number
  purchaseOrdersAlreadyV2: number
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL || ''
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    console.error('❌ DATABASE_URL doit être une URL postgresql:// (ce script cible la base SERVEUR).')
    process.exit(1)
  }

  const db = new PrismaClient()
  try {
    const summary = await db.$transaction(
      async (tx): Promise<Summary> => {
        const s: Summary = {
          workOrdersMigrated: 0,
          workOrdersAlreadyV2: 0,
          workOrdersSignedFrozen: 0,
          purchaseOrdersMigrated: 0,
          purchaseOrdersAlreadyV2: 0,
        }

        s.workOrdersSignedFrozen = await tx.workOrder.count({
          where: { NOT: { signedAt: null, signatureData: null } },
        })

        // ── Ordres de réparation NON signés ──────────────────────────────────
        const wos = await tx.workOrder.findMany({
          where: { signedAt: null, signatureData: null },
          select: { id: true, worksJson: true, partsJson: true, totalHtCents: true },
        })
        for (const wo of wos) {
          // parse* lève MoneyJsonError sur JSON invalide → transaction annulée.
          const works = parseWorksJson(wo.worksJson)
          const parts = parsePartsJson(wo.partsJson)
          if (works.version === 2 && parts.version === 2) {
            s.workOrdersAlreadyV2 += 1
            continue
          }
          const recalced = workOrderTotalHtCents(works.lines, parts.lines)
          const lineCount = works.lines.length + parts.lines.length
          const tol = Math.max(1, lineCount)
          if (Math.abs(recalced - wo.totalHtCents) > tol) {
            throw new Error(
              `JSON_TOTAL_MISMATCH WorkOrder ${wo.id}: total recalculé ${recalced}c ≠ stocké ${wo.totalHtCents}c (tolérance ${tol}c) — migration ANNULÉE, aucune écriture`,
            )
          }
          const worksJson = serializeWorksJsonV2(works.lines)
          const partsJson = serializePartsJsonV2(parts.lines)
          // Relecture de contrôle AVANT écriture (le v2 produit doit être re-parsable).
          parseWorksJson(worksJson)
          parsePartsJson(partsJson)
          if (!DRY_RUN) {
            await tx.workOrder.update({ where: { id: wo.id }, data: { worksJson, partsJson } })
          }
          s.workOrdersMigrated += 1
        }

        // ── Bons de commande (jamais signés) — tous ──────────────────────────
        const pos = await tx.purchaseOrder.findMany({
          select: { id: true, linesJson: true, totalHtCents: true },
        })
        for (const po of pos) {
          const parsed = parsePoLinesJson(po.linesJson)
          if (parsed.version === 2) {
            s.purchaseOrdersAlreadyV2 += 1
            continue
          }
          const recalced = poTotalHtCents(parsed.lines)
          const tol = Math.max(1, parsed.lines.length)
          if (Math.abs(recalced - po.totalHtCents) > tol) {
            throw new Error(
              `JSON_TOTAL_MISMATCH PurchaseOrder ${po.id}: total recalculé ${recalced}c ≠ stocké ${po.totalHtCents}c (tolérance ${tol}c) — migration ANNULÉE, aucune écriture`,
            )
          }
          const linesJson = serializePoLinesJsonV2(parsed.lines)
          parsePoLinesJson(linesJson)
          if (!DRY_RUN) {
            await tx.purchaseOrder.update({ where: { id: po.id }, data: { linesJson } })
          }
          s.purchaseOrdersMigrated += 1
        }

        return s
      },
      // Migration ponctuelle de déploiement : délai large, mais borné.
      { maxWait: 30_000, timeout: 600_000 },
    )

    const mode = DRY_RUN ? ' (SIMULATION --dry-run : aucune écriture)' : ''
    console.log(`✅ Migration JSON v2 PostgreSQL terminée${mode} :`)
    console.log(`   • WorkOrder migrés          : ${summary.workOrdersMigrated}`)
    console.log(`   • WorkOrder déjà en v2      : ${summary.workOrdersAlreadyV2}`)
    console.log(`   • WorkOrder signés (gelés)  : ${summary.workOrdersSignedFrozen} — JSON verbatim conservé (exception légale documentée)`)
    console.log(`   • PurchaseOrder migrés      : ${summary.purchaseOrdersMigrated}`)
    console.log(`   • PurchaseOrder déjà en v2  : ${summary.purchaseOrdersAlreadyV2}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`❌ Migration JSON v2 PostgreSQL ÉCHOUÉE — transaction annulée, base inchangée.`)
    console.error(`   ${msg}`)
    process.exit(1)
  } finally {
    await db.$disconnect().catch(() => undefined)
  }
}

void main()
