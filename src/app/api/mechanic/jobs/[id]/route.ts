export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireMechanic, withMechanic, findAssignedJob } from '@/lib/mechanic-api'

// GET /api/mechanic/jobs/[id]
// Détail d'UNE intervention attribuée : champs techniques, photos, notes
// mécanicien et items de checklist. 404 générique si l'intervention n'est pas
// attribuée au mécanicien (aucune fuite sur l'existence de la ressource).
export const GET = withMechanic(async (_req, { params }: { params: { id: string } }) => {
  const ctx = await requireMechanic()

  const job = await findAssignedJob(ctx, params.id)
  if (!job) {
    return NextResponse.json({ error: 'Intervention non accessible.' }, { status: 404 })
  }

  const [photos, notes, inspections] = await Promise.all([
    prisma.jobPhoto.findMany({
      where: { jobId: job.id, garageId: ctx.garageId },
      select: { id: true, phase: true, caption: true, photoPath: true, base64: true, mechanicId: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }],
    }),
    prisma.jobMechanicNote.findMany({
      where: { jobId: job.id, garageId: ctx.garageId },
      select: { id: true, type: true, body: true, mechanicId: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }],
    }),
    prisma.inspection.findMany({
      where: { jobId: job.id, garageId: ctx.garageId },
      select: {
        id: true,
        status: true,
        items: {
          select: { id: true, category: true, label: true, status: true, notes: true, sortOrder: true },
          orderBy: [{ sortOrder: 'asc' }],
        },
      },
    }),
  ])

  // Vue STRICTE de l'intervention — jamais de prix/coût/marge.
  const view = {
    id: job.id,
    date: job.date,
    startTime: job.startTime,
    estimatedDuration: job.estimatedDuration,
    actualDuration: job.actualDuration,
    status: job.status,
    repairType: job.repairType,
    isUrgent: job.isUrgent,
    vehicleModel: job.vehicleModel,
    licensePlate: job.licensePlate,
    customerName: job.customerName,
    notes: job.notes,
    timerStartedAt: job.timerStartedAt,
    delayMinutes: job.delayMinutes,
  }

  return NextResponse.json({ job: view, photos, notes, inspections })
})
