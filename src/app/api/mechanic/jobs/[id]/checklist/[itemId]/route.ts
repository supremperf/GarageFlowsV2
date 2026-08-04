export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireMechanic, withMechanic, findAssignedJob, logMechanicAction } from '@/lib/mechanic-api'

const ALLOWED_STATUS = new Set(['ok', 'warning', 'critical', 'na'])

// PATCH /api/mechanic/jobs/[id]/checklist/[itemId]  { status, notes? }
// Le mécanicien complète la checklist de SON intervention. L'item doit
// appartenir à une inspection liée à cette intervention (double vérification).
export const PATCH = withMechanic(async (req, { params }: { params: { id: string; itemId: string } }) => {
  const ctx = await requireMechanic()

  const job = await findAssignedJob(ctx, params.id)
  if (!job) return NextResponse.json({ error: 'Intervention non accessible.' }, { status: 404 })

  let payload: { status?: unknown; notes?: unknown }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })
  }

  const status = typeof payload.status === 'string' && ALLOWED_STATUS.has(payload.status) ? payload.status : null
  if (!status) return NextResponse.json({ error: 'Statut de checklist invalide.' }, { status: 400 })
  const notes = typeof payload.notes === 'string' ? payload.notes.slice(0, 2000) : undefined

  // L'item DOIT appartenir à une inspection de CE garage ET de CETTE
  // intervention : on relie item → inspection → job attribué.
  const item = await prisma.inspectionItem.findFirst({
    where: {
      id: params.itemId,
      inspection: { jobId: job.id, garageId: ctx.garageId },
    },
    select: { id: true },
  })
  if (!item) return NextResponse.json({ error: 'Élément de checklist non accessible.' }, { status: 404 })

  const updated = await prisma.inspectionItem.update({
    where: { id: item.id },
    data: { status, ...(notes !== undefined ? { notes } : {}) },
    select: { id: true, category: true, label: true, status: true, notes: true, sortOrder: true },
  })

  await logMechanicAction({ ctx, action: 'checklist_updated', jobId: job.id, targetType: 'InspectionItem', targetId: item.id, metadata: { status } })

  return NextResponse.json(updated)
})
