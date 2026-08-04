export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireMechanic, withMechanic, findAssignedJob, logMechanicAction } from '@/lib/mechanic-api'

// POST /api/mechanic/jobs/[id]/timer  { action: 'start' | 'stop' }
// Reflète la fonction chrono existante, limitée à l'intervention attribuée.
// Le mécanicien ne modifie AUCUN autre champ de l'intervention.
export const POST = withMechanic(async (req, { params }: { params: { id: string } }) => {
  const ctx = await requireMechanic()

  const job = await findAssignedJob(ctx, params.id)
  if (!job) return NextResponse.json({ error: 'Intervention non accessible.' }, { status: 404 })

  let action: unknown
  try {
    ({ action } = await req.json())
  } catch {
    return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })
  }

  if (action === 'start') {
    // where inclut mechanicId : impossible d'agir sur l'intervention d'autrui.
    const updated = await prisma.job.update({
      where: { id: job.id },
      data: { timerStartedAt: new Date(), status: 'in_progress' },
      select: { id: true, status: true, timerStartedAt: true, actualDuration: true },
    })
    await logMechanicAction({ ctx, action: 'timer_started', jobId: job.id, targetType: 'Job', targetId: job.id })
    return NextResponse.json(updated)
  }

  if (action === 'stop') {
    if (!job.timerStartedAt) return NextResponse.json({ error: 'Timer non démarré.' }, { status: 400 })
    const elapsed = Math.round((Date.now() - new Date(job.timerStartedAt).getTime()) / 60000)
    const existing = job.actualDuration ?? 0
    const updated = await prisma.job.update({
      where: { id: job.id },
      data: { timerStartedAt: null, actualDuration: existing + elapsed, status: 'completed' },
      select: { id: true, status: true, timerStartedAt: true, actualDuration: true },
    })
    await logMechanicAction({ ctx, action: 'timer_stopped', jobId: job.id, targetType: 'Job', targetId: job.id })
    return NextResponse.json(updated)
  }

  return NextResponse.json({ error: 'Action invalide.' }, { status: 400 })
})
