export const dynamic = 'force-dynamic'

/**
 * POST /api/import  (propriétaire)
 * Import CSV d'entités garage (clients, pièces). Deux modes :
 *   - dryRun: true  → renvoie un PLAN (à créer, doublons, erreurs) sans écrire ;
 *   - dryRun: false → exécute l'import (transactionnel, scopé garageId).
 * Body: { entity, csv, mapping?, dryRun?, delimiter? }
 * Le mapping est auto-déduit des en-têtes s'il n'est pas fourni.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { logAudit } from '@/lib/audit'
import { parseCsv, splitHeader } from '@/lib/import/csv'
import {
  autoMap, planImport, loadExistingKeys, executeImport, entityFields, type ImportEntity, type ColumnMapping,
} from '@/lib/import/wizard'

const MAX_ROWS = 5000
const MAX_CSV_BYTES = 5 * 1024 * 1024 // 5 Mo

const Body = z.object({
  entity: z.enum(['clients', 'parts']),
  csv: z.string().min(1).max(MAX_CSV_BYTES),
  mapping: z.record(z.string(), z.number().int().min(0)).optional(),
  dryRun: z.boolean().default(true),
  delimiter: z.string().length(1).optional(),
})

export const POST = withAuth(async (req) => {
  const session = await requireSession()
  if (session.user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Réservé au propriétaire' }, { status: 403 })
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }
  const { entity, csv, dryRun, delimiter } = parsed.data
  const garageId = session.user.garageId

  const { header, rows } = splitHeader(parseCsv(csv, delimiter))
  if (header.length === 0) return NextResponse.json({ error: 'CSV vide' }, { status: 400 })
  if (rows.length > MAX_ROWS) return NextResponse.json({ error: `Trop de lignes (max ${MAX_ROWS}).` }, { status: 413 })

  const mapping: ColumnMapping = parsed.data.mapping ?? autoMap(entity as ImportEntity, header)
  if (!('name' in mapping)) {
    return NextResponse.json(
      { error: `Colonne « nom » introuvable. Champs attendus : ${entityFields(entity as ImportEntity).join(', ')}.`, header },
      { status: 400 },
    )
  }

  if (dryRun) {
    const existingKeys = await loadExistingKeys(prisma, entity as ImportEntity, garageId)
    const plan = planImport({ entity: entity as ImportEntity, rows, mapping, existingKeys, maxRows: MAX_ROWS })
    return NextResponse.json({ dryRun: true, mapping, plan })
  }

  const { plan, created } = await executeImport(prisma, { entity: entity as ImportEntity, rows, mapping, garageId, maxRows: MAX_ROWS })
  await logAudit({ action: 'create', entityType: entity === 'clients' ? 'Client' : 'Part', session, req, details: { imported: created, entity } })
  return NextResponse.json({ dryRun: false, created, plan }, { status: 201 })
})
