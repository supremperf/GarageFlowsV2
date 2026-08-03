export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { UpdateJobSchema } from '@/lib/schemas'
import { logAudit } from '@/lib/audit'

// GET /api/jobs/:id
export const GET = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const job = await prisma.job.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
  })
  if (!job) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
  return NextResponse.json(job)
})

// PUT /api/jobs/:id  (full update)
export const PUT = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const body = await req.json()

  const parsed = UpdateJobSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }

  // If mechanicId changes, verify the new mechanic belongs to the garage
  if (parsed.data.mechanicId) {
    const mech = await prisma.mechanic.findFirst({
      where: { id: parsed.data.mechanicId, garageId: session.user.garageId },
    })
    if (!mech) return NextResponse.json({ error: 'Mécanicien introuvable' }, { status: 404 })
  }

  const allowedFields = [
    'customerName', 'vehicleModel', 'licensePlate', 'repairType',
    'estimatedDuration', 'actualDuration', 'startTime', 'date',
    'status', 'notes', 'isUrgent', 'delayMinutes', 'mechanicId',
  ]
  const data: Record<string, unknown> = {}
  for (const field of allowedFields) {
    if (field in parsed.data) data[field] = (parsed.data as Record<string, unknown>)[field]
  }

  // garageId in WHERE prevents cross-tenant writes
  const updated = await prisma.job.update({
    where: { id: params.id, garageId: session.user.garageId },
    data,
  })

  await logAudit({ action: 'update', entityType: 'Job', entityId: params.id, session, req })

  return NextResponse.json(updated)
})

// PATCH /api/jobs/:id  (partial update — e.g. drag-and-drop move)
export const PATCH = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const body = await req.json()

  const parsed = UpdateJobSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }

  // Isolation multi-tenant : si mechanicId change, vérifier son appartenance au
  // garage (le PUT le fait déjà ; le PATCH l'omettait → assignation cross-garage
  // + lecture du mécanicien étranger via les include).
  if (parsed.data.mechanicId) {
    const mech = await prisma.mechanic.findFirst({
      where: { id: parsed.data.mechanicId, garageId: session.user.garageId },
    })
    if (!mech) return NextResponse.json({ error: 'Mécanicien introuvable' }, { status: 404 })
  }

  const safeFields = ['mechanicId', 'startTime', 'date', 'status', 'delayMinutes', 'actualDuration']
  const data: Record<string, unknown> = {}
  for (const f of safeFields) {
    if (f in parsed.data) data[f] = (parsed.data as Record<string, unknown>)[f]
  }

  const updated = await prisma.job.update({
    where: { id: params.id, garageId: session.user.garageId },
    data,
  })

  await logAudit({ action: 'update', entityType: 'Job', entityId: params.id, session, req })

  return NextResponse.json(updated)
})

// DELETE /api/jobs/:id
export const DELETE = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  await prisma.job.delete({ where: { id: params.id, garageId: session.user.garageId } })

  await logAudit({ action: 'delete', entityType: 'Job', entityId: params.id, session, req })

  return NextResponse.json({ success: true })
})
