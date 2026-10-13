export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { scheduleJobSync } from '@/lib/sync/job-sync'

// POST /api/jobs/:id/timer  body: { action: 'start' | 'stop' }
export const POST = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const { action } = await req.json()

  const job = await prisma.job.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
  })
  if (!job) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  if (action === 'start') {
    const updated = await prisma.job.update({
      where: { id: params.id, garageId: session.user.garageId },
      data: {
        timerStartedAt: new Date(),
        status: 'in_progress',
      },
    })
    // Démarrer ou arrêter le chrono CHANGE le statut de l'intervention : sans
    // cette remontée, le mécanicien voyait « Prévu » alors que le comptoir avait
    // lancé le travail, jusqu'au prochain passage opportuniste. Toutes les
    // autres écritures d'intervention la déclenchent déjà ; celle-ci était la
    // seule oubliée.
    scheduleJobSync(session.user.garageId)
    return NextResponse.json(updated)
  }

  if (action === 'stop') {
    if (!job.timerStartedAt) {
      return NextResponse.json({ error: 'Timer non démarré' }, { status: 400 })
    }
    const elapsed = Math.round((Date.now() - new Date(job.timerStartedAt).getTime()) / 60000)
    const existing = job.actualDuration ?? 0
    const updated = await prisma.job.update({
      where: { id: params.id, garageId: session.user.garageId },
      data: {
        timerStartedAt: null,
        actualDuration: existing + elapsed,
        status: 'completed',
      },
    })
    // Démarrer ou arrêter le chrono CHANGE le statut de l'intervention : sans
    // cette remontée, le mécanicien voyait « Prévu » alors que le comptoir avait
    // lancé le travail, jusqu'au prochain passage opportuniste. Toutes les
    // autres écritures d'intervention la déclenchent déjà ; celle-ci était la
    // seule oubliée.
    scheduleJobSync(session.user.garageId)
    return NextResponse.json(updated)
  }

  return NextResponse.json({ error: 'action invalide' }, { status: 400 })
})
