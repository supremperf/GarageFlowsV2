export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireMechanic, withMechanic, findAssignedJob, logMechanicAction } from '@/lib/mechanic-api'

// POST /api/mechanic/jobs/[id]/timer  { action: 'start' | 'stop' }
// Reflète la fonction chrono existante, limitée à l'intervention attribuée.
// Le mécanicien ne modifie AUCUN autre champ de l'intervention.
//
// §7 — ATOMICITÉ : l'écriture re-vérifie AU MOMENT DE L'UPDATE la propriété
// (garageId + mechanicId, issus du contexte de confiance) via updateMany + une
// garde optimiste sur timerStartedAt. Si l'intervention a été réattribuée entre
// le contrôle et l'écriture (ou en cas de double-stop concurrent), l'update
// n'affecte AUCUNE ligne (count 0) → 409, jamais d'écriture sur une intervention
// qu'on ne possède plus, jamais de double comptage du temps.
//
// §8 — l'arrêt NE clôture PAS automatiquement l'intervention : elle passe au
// statut intermédiaire 'awaiting_validation' (mécanicien terminé, en attente du
// responsable qui clôture → 'completed'). L'auto-clôture reste possible mais est
// OPT-IN et explicite (GF_MECHANIC_TIMER_AUTOCOMPLETE=1), et couverte par un test.
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
    // updateMany re-scopé au contexte de confiance : impossible d'agir sur
    // l'intervention d'autrui (réattribution concurrente ⇒ count 0 ⇒ 409). On
    // n'autorise pas le démarrage sur une intervention clôturée/annulée.
    const res = await prisma.job.updateMany({
      where: {
        id: job.id,
        garageId: ctx.garageId,
        mechanicId: ctx.mechanicId,
        status: { in: ['scheduled', 'in_progress', 'delayed', 'awaiting_validation'] },
      },
      data: { timerStartedAt: new Date(), status: 'in_progress' },
    })
    if (res.count !== 1) return NextResponse.json({ error: 'Intervention non accessible.' }, { status: 409 })
    const updated = await prisma.job.findFirst({
      where: { id: job.id, garageId: ctx.garageId, mechanicId: ctx.mechanicId },
      select: { id: true, status: true, timerStartedAt: true, actualDuration: true },
    })
    await logMechanicAction({ ctx, action: 'timer_started', jobId: job.id, targetType: 'Job', targetId: job.id })
    return NextResponse.json(updated)
  }

  if (action === 'stop') {
    if (!job.timerStartedAt) return NextResponse.json({ error: 'Timer non démarré.' }, { status: 400 })
    const elapsed = Math.round((Date.now() - new Date(job.timerStartedAt).getTime()) / 60000)
    const existing = job.actualDuration ?? 0
    // §8 — pas d'auto-clôture par défaut ; opt-in explicite et testé.
    const stopStatus = process.env.GF_MECHANIC_TIMER_AUTOCOMPLETE === '1' ? 'completed' : 'awaiting_validation'
    // Garde optimiste : la ligne ne doit avoir bougé ni de propriétaire ni de
    // timerStartedAt depuis la lecture (anti-réattribution, anti double-stop).
    const res = await prisma.job.updateMany({
      where: {
        id: job.id,
        garageId: ctx.garageId,
        mechanicId: ctx.mechanicId,
        timerStartedAt: job.timerStartedAt,
      },
      data: { timerStartedAt: null, actualDuration: existing + elapsed, status: stopStatus },
    })
    if (res.count !== 1) return NextResponse.json({ error: 'Intervention non accessible.' }, { status: 409 })
    const updated = await prisma.job.findFirst({
      where: { id: job.id, garageId: ctx.garageId },
      select: { id: true, status: true, timerStartedAt: true, actualDuration: true },
    })
    await logMechanicAction({ ctx, action: 'timer_stopped', jobId: job.id, targetType: 'Job', targetId: job.id })
    return NextResponse.json(updated)
  }

  return NextResponse.json({ error: 'Action invalide.' }, { status: 400 })
})
