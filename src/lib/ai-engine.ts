import {
  Job,
  Mechanic,
  Part,
  Suggestion,
  SuggestionType,
  REPAIR_TYPES,
  repairConfig,
  WORKSHOP_START_HOUR,
  WORKSHOP_END_HOUR,
} from './types'
import {
  detectEmptySlots,
  findAvailableSlots,
  timeToMinutes,
  minutesToTime,
  jobsOverlap,
  generateId,
  getTodayString,
  formatDurationLong,
} from './utils'

interface AIEngineContext {
  jobs: Job[]
  mechanics: Mechanic[]
  date: string
  lowStockParts?: Part[]
  workshopStartHour?: number
  workshopEndHour?: number
}

export function runAIEngine(ctx: AIEngineContext): Suggestion[] {
  const suggestions: Suggestion[] = []
  const now = new Date()
  const currentTimeMinutes = now.getHours() * 60 + now.getMinutes()

  // 1. Detect scheduling conflicts (overlapping jobs)
  detectConflicts(ctx, suggestions)

  // 2. Detect delays in progress
  detectDelays(ctx, currentTimeMinutes, suggestions)

  // 3. Detect empty slots and suggest fills
  detectAndSuggestSlotFills(ctx, suggestions)

  // 4. Detect overload on mechanics
  detectOverload(ctx, suggestions)

  // 5. Detect absent mechanic impact
  detectAbsenceImpact(ctx, suggestions)

  // 6. Suggest optimizations
  suggestOptimizations(ctx, suggestions)

  // 7. Stock alerts
  detectStockAlerts(ctx, suggestions)

  return suggestions.sort((a, b) => {
    const prio = { high: 0, medium: 1, low: 2 }
    return prio[a.priority] - prio[b.priority]
  })
}

function detectDelays(
  ctx: AIEngineContext,
  currentTimeMinutes: number,
  suggestions: Suggestion[]
) {
  const { jobs } = ctx
  const today = getTodayString()

  jobs
    .filter(j => j.date === today && j.status === 'in_progress')
    .forEach(job => {
      const startMinutes = timeToMinutes(job.startTime)
      const elapsedMinutes = currentTimeMinutes - startMinutes
      const expectedProgress = elapsedMinutes / job.estimatedDuration

      // If 80% of time has passed but job is not near completion, flag it
      if (expectedProgress > 0.8 && elapsedMinutes < job.estimatedDuration) {
        return // Still on track
      }

      // If over estimated time
      if (elapsedMinutes > job.estimatedDuration) {
        const overBy = elapsedMinutes - job.estimatedDuration
        const estimatedExtra = Math.max(30, Math.round(overBy * 1.3))

        suggestions.push({
          id: generateId(),
          type: 'delay_warning',
          priority: overBy > 60 ? 'high' : 'medium',
          title: `Retard détecté — ${job.customerName}`,
          description: `La ${repairConfig(job.repairType).label} (${job.vehicleModel}) dépasse le temps prévu de ${formatDurationLong(overBy)}. Retard estimé : ~${formatDurationLong(estimatedExtra)}.`,
          affectedJobIds: [job.id],
          action: {
            label: 'Signaler le retard',
            jobId: job.id,
          },
          dismissed: false,
          createdAt: new Date().toISOString(),
        })
      }
    })
}

function detectAndSuggestSlotFills(ctx: AIEngineContext, suggestions: Suggestion[]) {
  const { jobs, mechanics, date, workshopStartHour, workshopEndHour } = ctx
  const emptySlots = detectEmptySlots(jobs, mechanics, date, workshopStartHour, workshopEndHour)

  const quickRepairTypes = Object.entries(REPAIR_TYPES)
    .filter(([, config]) => config.isQuick)
    .map(([type]) => type as keyof typeof REPAIR_TYPES)

  emptySlots.forEach(slot => {
    const mechanic = mechanics.find(m => m.id === slot.mechanicId)
    if (!mechanic) return

    const fittingRepairs = quickRepairTypes.filter(
      type => REPAIR_TYPES[type].defaultDuration <= slot.duration
    )

    if (fittingRepairs.length > 0 && slot.duration >= 15) {
      const examples = fittingRepairs
        .slice(0, 3)
        .map(t => REPAIR_TYPES[t].label)
        .join(', ')

      suggestions.push({
        id: generateId(),
        type: 'fill_slot',
        priority: slot.duration >= 45 ? 'medium' : 'low',
        title: `Créneau libre — ${mechanic.name} à ${slot.startTime}`,
        description: `${formatDurationLong(slot.duration)} disponibles à partir de ${slot.startTime}. Interventions possibles : ${examples}.`,
        affectedJobIds: [],
        action: {
          label: 'Ajouter une intervention rapide',
          targetMechanicId: slot.mechanicId,
          targetTime: slot.startTime,
        },
        dismissed: false,
        createdAt: new Date().toISOString(),
      })
    }
  })
}

function detectOverload(ctx: AIEngineContext, suggestions: Suggestion[]) {
  const { jobs, mechanics, date, workshopStartHour, workshopEndHour } = ctx
  const startH = workshopStartHour ?? WORKSHOP_START_HOUR
  const endH   = workshopEndHour   ?? WORKSHOP_END_HOUR

  mechanics.filter(m => !m.isAbsent).forEach(mechanic => {
    const mechanicJobs = jobs.filter(
      j => j.mechanicId === mechanic.id && j.date === date && j.status !== 'cancelled'
    )

    const totalMinutes = mechanicJobs.reduce((sum, j) => sum + j.estimatedDuration, 0)
    const workshopMinutes = (endH - startH) * 60

    if (totalMinutes > workshopMinutes * 0.95) {
      suggestions.push({
        id: generateId(),
        type: 'overload_warning',
        priority: 'high',
        title: `Surcharge — ${mechanic.name}`,
        description: `${mechanic.name} a ${Math.round(totalMinutes / 60 * 10) / 10}h de travail planifié pour aujourd'hui. Risque de débordement.`,
        affectedJobIds: mechanicJobs.map(j => j.id),
        action: {
          label: 'Redistribuer des interventions',
          targetMechanicId: mechanic.id,
        },
        dismissed: false,
        createdAt: new Date().toISOString(),
      })
    }
  })
}

function detectAbsenceImpact(ctx: AIEngineContext, suggestions: Suggestion[]) {
  const { jobs, mechanics, date } = ctx
  const absentMechanics = mechanics.filter(m => m.isAbsent)

  absentMechanics.forEach(mechanic => {
    const orphanJobs = jobs.filter(
      j => j.mechanicId === mechanic.id && j.date === date && j.status === 'scheduled'
    )

    if (orphanJobs.length > 0) {
      // Find available mechanics to redistribute
      const available = mechanics.filter(m => !m.isAbsent)

      suggestions.push({
        id: generateId(),
        type: 'absence_impact',
        priority: 'high',
        title: `Absence — ${mechanic.name} (${orphanJobs.length} intervention${orphanJobs.length > 1 ? 's' : ''})`,
        description: `${mechanic.name} est absent. ${orphanJobs.length} intervention${orphanJobs.length > 1 ? 's' : ''} ${orphanJobs.length > 1 ? 'sont' : 'est'} non assignée${orphanJobs.length > 1 ? 's' : ''}. ${available.length} mécanicien${available.length > 1 ? 's' : ''} disponible${available.length > 1 ? 's' : ''} pour redistribution.`,
        affectedJobIds: orphanJobs.map(j => j.id),
        action: {
          label: 'Redistribuer automatiquement',
          targetMechanicId: mechanic.id,
        },
        dismissed: false,
        createdAt: new Date().toISOString(),
      })
    }
  })
}

function suggestOptimizations(ctx: AIEngineContext, suggestions: Suggestion[]) {
  const { jobs, mechanics, date, workshopStartHour, workshopEndHour } = ctx

  // Check for mechanics with no jobs while others are overloaded
  const loads = mechanics
    .filter(m => !m.isAbsent)
    .map(m => ({
      mechanic: m,
      totalMinutes: jobs
        .filter(j => j.mechanicId === m.id && j.date === date && j.status !== 'cancelled')
        .reduce((sum, j) => sum + j.estimatedDuration, 0),
    }))
    .sort((a, b) => b.totalMinutes - a.totalMinutes)

  if (loads.length >= 2) {
    const busiest = loads[0]
    const lightest = loads[loads.length - 1]
    const diff = busiest.totalMinutes - lightest.totalMinutes

    if (diff > 120) {
      // More than 2h difference
      const movableJobs = jobs
        .filter(
          j =>
            j.mechanicId === busiest.mechanic.id &&
            j.date === date &&
            j.status === 'scheduled' &&
            j.estimatedDuration <= 90
        )
        .slice(0, 2)

      if (movableJobs.length > 0) {
        const canFit = movableJobs.some(job => {
          const slots = findAvailableSlots(
            lightest.mechanic.id,
            jobs,
            date,
            job.estimatedDuration,
            workshopStartHour,
            workshopEndHour,
          )
          return slots.length > 0
        })

        if (canFit) {
          suggestions.push({
            id: generateId(),
            type: 'redistribute',
            priority: 'medium',
            title: 'Rééquilibrage de charge possible',
            description: `${busiest.mechanic.name} a ${Math.round(busiest.totalMinutes / 60 * 10) / 10}h de travail, ${lightest.mechanic.name} seulement ${Math.round(lightest.totalMinutes / 60 * 10) / 10}h. Déplacer des interventions permettrait d'équilibrer la journée.`,
            affectedJobIds: movableJobs.map(j => j.id),
            action: {
              label: 'Équilibrer la charge',
              targetMechanicId: lightest.mechanic.id,
            },
            dismissed: false,
            createdAt: new Date().toISOString(),
          })
        }
      }
    }
  }
}

// ── New detectors ─────────────────────────────────────────────────────────────

function detectConflicts(ctx: AIEngineContext, suggestions: Suggestion[]) {
  const { jobs, date } = ctx
  const dayJobs = jobs.filter(j => j.date === date && j.status !== 'cancelled')

  for (let i = 0; i < dayJobs.length; i++) {
    for (let j = i + 1; j < dayJobs.length; j++) {
      if (jobsOverlap(dayJobs[i], dayJobs[j])) {
        const a = dayJobs[i]
        const b = dayJobs[j]
        suggestions.push({
          id: generateId(),
          type: 'conflict',
          priority: 'high',
          title: `Conflit de planning détecté`,
          description: `${a.customerName} (${a.startTime}) et ${b.customerName} (${b.startTime}) sont assignés au même mécanicien en même temps. Déplacez l'une des deux interventions.`,
          affectedJobIds: [a.id, b.id],
          action: {
            label: 'Résoudre le conflit',
            jobId: b.id,
          },
          dismissed: false,
          createdAt: new Date().toISOString(),
        })
      }
    }
  }
}

function detectStockAlerts(ctx: AIEngineContext, suggestions: Suggestion[]) {
  const { lowStockParts = [] } = ctx
  if (lowStockParts.length === 0) return

  lowStockParts.slice(0, 5).forEach(part => {
    suggestions.push({
      id: generateId(),
      type: 'stock_alert',
      priority: part.quantity === 0 ? 'high' : 'medium',
      title: part.quantity === 0
        ? `Rupture de stock — ${part.name}`
        : `Stock bas — ${part.name}`,
      description: part.quantity === 0
        ? `Aucune unité disponible. Pensez à réapprovisionner avant la prochaine intervention.`
        : `Il reste ${part.quantity} unité${part.quantity > 1 ? 's' : ''} (seuil min: ${part.minQuantity}).`,
      affectedJobIds: [],
      action: {
        label: 'Voir le stock',
      },
      dismissed: false,
      createdAt: new Date().toISOString(),
    })
  })

  if (lowStockParts.length > 5) {
    suggestions.push({
      id: generateId(),
      type: 'stock_alert',
      priority: 'medium',
      title: `${lowStockParts.length - 5} autres pièces sous seuil`,
      description: `Vérifiez votre catalogue de pièces et réapprovisionnez les références manquantes.`,
      affectedJobIds: [],
      action: { label: 'Voir le stock' },
      dismissed: false,
      createdAt: new Date().toISOString(),
    })
  }
}

export function redistributeAfterAbsence(
  absentMechanicId: string,
  jobs: Job[],
  mechanics: Mechanic[],
  date: string,
  workshopStartHour = WORKSHOP_START_HOUR,
  workshopEndHour   = WORKSHOP_END_HOUR,
): Job[] {
  const orphanJobs = jobs
    .filter(
      j => j.mechanicId === absentMechanicId && j.date === date && j.status === 'scheduled'
    )
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))

  const availableMechanics = mechanics.filter(m => !m.isAbsent && m.id !== absentMechanicId)
  const updatedJobs = [...jobs]

  orphanJobs.forEach(job => {
    // Find best mechanic with available slot
    let bestSlot: { mechanicId: string; startTime: string } | null = null
    let earliestStart = Infinity

    for (const mechanic of availableMechanics) {
      const slots = findAvailableSlots(
        mechanic.id,
        updatedJobs.filter(j => j.status !== 'cancelled'),
        date,
        job.estimatedDuration,
        workshopStartHour,
        workshopEndHour,
      )
      if (slots.length > 0) {
        const startMinutes = timeToMinutes(slots[0])
        if (startMinutes < earliestStart) {
          earliestStart = startMinutes
          bestSlot = { mechanicId: mechanic.id, startTime: slots[0] }
        }
      }
    }

    if (bestSlot) {
      const idx = updatedJobs.findIndex(j => j.id === job.id)
      if (idx !== -1) {
        updatedJobs[idx] = {
          ...updatedJobs[idx],
          mechanicId: bestSlot.mechanicId,
          startTime: bestSlot.startTime,
        }
      }
    }
  })

  return updatedJobs
}
