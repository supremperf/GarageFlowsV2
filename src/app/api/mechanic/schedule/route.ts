export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireMechanic, withMechanic } from '@/lib/mechanic-api'
import { syncWindow } from '@/lib/sync/job-fields'

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

  // ── La PWA ne montre que ce que le miroir tient à jour (GF-038) ────────────
  // Le poste ne remonte que la fenêtre [J−7, J+30] (`syncWindow`), et le cloud
  // ne purge que dans cette même fenêtre. En dehors, le miroir n'est plus
  // rafraîchi : une intervention datée d'il y a plus de sept jours, puis
  // réaffectée ou modifiée sur le poste, gardait éternellement son état figé —
  // et la PWA laissait pourtant y naviguer, flèche par flèche, sans rien
  // signaler. Le mécanicien lisait alors une affectation qui n'existe plus.
  //
  // On borne donc la lecture à la fenêtre effectivement synchronisée : ce qui
  // s'affiche est ce qui est tenu à jour, et rien d'autre.
  const fenetre = syncWindow(new Date())
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    if (date < fenetre.from || date > fenetre.to) {
      return NextResponse.json({ data: [], outOfWindow: true, window: fenetre })
    }
    where.date = date
  } else {
    where.date = { gte: fenetre.from, lte: fenetre.to }
  }

  const jobs = await prisma.job.findMany({
    where,
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    select: JOB_SELECT,
    take: 200,
  })

  return NextResponse.json({ data: jobs, window: fenetre })
})
