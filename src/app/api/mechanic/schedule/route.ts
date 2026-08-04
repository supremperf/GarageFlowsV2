export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireMechanic, withMechanic } from '@/lib/mechanic-api'

// Champs STRICTEMENT nécessaires au mécanicien. JAMAIS de prix, coût, marge,
// facture, devis, ni de données d'un autre mécanicien.
const JOB_SELECT = {
  id: true,
  date: true,
  startTime: true,
  estimatedDuration: true,
  actualDuration: true,
  status: true,
  repairType: true,
  isUrgent: true,
  vehicleModel: true,
  licensePlate: true,
  customerName: true,
  notes: true,
  timerStartedAt: true,
  delayMinutes: true,
} as const

// GET /api/mechanic/schedule?date=YYYY-MM-DD
// Renvoie UNIQUEMENT les interventions attribuées au mécanicien connecté.
export const GET = withMechanic(async (req) => {
  const ctx = await requireMechanic()
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')

  // Le scoping garageId+mechanicId vient de la session : impossible d'élargir
  // le périmètre via un paramètre client.
  const where: Record<string, unknown> = { garageId: ctx.garageId, mechanicId: ctx.mechanicId }
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) where.date = date

  const jobs = await prisma.job.findMany({
    where,
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    select: JOB_SELECT,
    take: 200,
  })

  return NextResponse.json({ data: jobs })
})
