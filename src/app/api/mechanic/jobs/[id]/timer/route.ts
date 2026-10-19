export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireMechanic, withMechanic, findAssignedJob, logMechanicAction } from '@/lib/mechanic-api'

// POST /api/mechanic/jobs/[id]/timer  { action: 'start' | 'pause' | 'resume' | 'stop' }
// Chrono de l'intervention attribuée. Le mécanicien ne modifie AUCUN autre champ.
//
// §6 — ROBUSTESSE :
//  - ATOMICITÉ : chaque écriture est un updateMany re-scopé au contexte de
//    confiance (garageId + mechanicId) + garde optimiste sur timerStartedAt /
//    timerAccumulatedSec. Réattribution ou double-clic concurrent ⇒ count 0 ⇒ 409,
//    jamais d'écriture fantôme ni de double comptage.
//  - DOUBLE-DÉMARRAGE : start/resume n'agissent QUE si aucun segment n'est en cours
//    (timerStartedAt null) ⇒ deux clics rapides ne réinitialisent jamais le chrono.
//  - DURÉE NÉGATIVE : la durée d'un segment est clampée à ≥ 0 (anti recul d'horloge).
//  - PAUSE/REPRISE sans perte : les secondes des segments terminés s'accumulent dans
//    timerAccumulatedSec ; actualDuration (minutes, compat historique) n'est incrémenté
//    qu'à l'ARRÊT, à partir du total de secondes ⇒ des pauses répétées n'accumulent
//    aucune erreur d'arrondi.
//
// §8 — l'arrêt NE clôture PAS automatiquement (statut 'awaiting_validation') ;
// 'completed' reste opt-in via GF_MECHANIC_TIMER_AUTOCOMPLETE=1.

// Secondes écoulées d'un segment, clampées à ≥ 0 (jamais de durée négative).
function segmentSeconds(startedAt: Date | string | null | undefined): number {
  if (!startedAt) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
}

const START_ALLOWED = ['scheduled', 'in_progress', 'delayed', 'awaiting_validation']

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

  const scope = { id: job.id, garageId: ctx.garageId, mechanicId: ctx.mechanicId }
  const accSec = job.timerAccumulatedSec ?? 0
  const conflict = () => NextResponse.json({ error: 'Intervention non accessible.' }, { status: 409 })
  const reload = () =>
    prisma.job.findFirst({
      where: scope,
      select: { id: true, status: true, timerStartedAt: true, actualDuration: true, timerAccumulatedSec: true },
    })

  // ── START / RESUME : ouvrir un segment (interdit si déjà en cours) ──────────
  if (action === 'start' || action === 'resume') {
    const res = await prisma.job.updateMany({
      where: { ...scope, timerStartedAt: null, status: { in: START_ALLOWED } },
      data: { timerStartedAt: new Date(), status: 'in_progress' },
    })
    if (res.count !== 1) return conflict() // déjà en cours (double-clic), réattribué, ou clôturé
    await logMechanicAction({ ctx, action: 'timer_started', jobId: job.id, targetType: 'Job', targetId: job.id })
    return NextResponse.json(await reload())
  }

  // ── PAUSE : figer le segment courant dans l'accumulateur (aucune seconde perdue) ──
  if (action === 'pause') {
    if (!job.timerStartedAt) return NextResponse.json({ error: 'Chrono non démarré.' }, { status: 400 })
    const res = await prisma.job.updateMany({
      where: { ...scope, timerStartedAt: job.timerStartedAt }, // garde optimiste (anti double-pause)
      data: { timerStartedAt: null, timerAccumulatedSec: accSec + segmentSeconds(job.timerStartedAt) },
    })
    if (res.count !== 1) return conflict()
    await logMechanicAction({ ctx, action: 'timer_paused', jobId: job.id, targetType: 'Job', targetId: job.id })
    return NextResponse.json(await reload())
  }

  // ── STOP : accumuler le segment courant, dériver les minutes, figer ─────────
  if (action === 'stop') {
    // Valide seulement si le chrono est EN COURS ou EN PAUSE (temps accumulé) ;
    // arrêter une intervention jamais démarrée n'a pas de sens.
    if (!job.timerStartedAt && accSec === 0) {
      return NextResponse.json({ error: 'Chrono non démarré.' }, { status: 400 })
    }
    const totalSec = accSec + segmentSeconds(job.timerStartedAt)
    const stopStatus = process.env.GF_MECHANIC_TIMER_AUTOCOMPLETE === '1' ? 'completed' : 'awaiting_validation'
    const res = await prisma.job.updateMany({
      // Garde optimiste combinée : timerStartedAt (anti double-stop en cours) ET
      // timerAccumulatedSec (anti double-stop depuis la pause) ⇒ jamais de double comptage.
      where: { ...scope, timerStartedAt: job.timerStartedAt, timerAccumulatedSec: accSec },
      data: {
        timerStartedAt: null,
        timerAccumulatedSec: 0, // remis à zéro : le temps est transféré dans actualDuration
        actualDuration: (job.actualDuration ?? 0) + Math.round(totalSec / 60),
        status: stopStatus,
      },
    })
    if (res.count !== 1) return conflict()
    await logMechanicAction({ ctx, action: 'timer_stopped', jobId: job.id, targetType: 'Job', targetId: job.id })
    return NextResponse.json(await reload())
  }

  return NextResponse.json({ error: 'Action invalide.' }, { status: 400 })
})
