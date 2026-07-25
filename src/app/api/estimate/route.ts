export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { REPAIR_TYPES } from '@/lib/types'

// POST /api/estimate
// Body: { repairType, vehicleModel?, mechanicId? }
// Returns recommended duration with explanation
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const body = await req.json()
  const { repairType, vehicleModel = '', mechanicId } = body

  if (!repairType || !REPAIR_TYPES[repairType as keyof typeof REPAIR_TYPES]) {
    return NextResponse.json({ error: 'Invalid repairType' }, { status: 400 })
  }

  const defaultDuration = REPAIR_TYPES[repairType as keyof typeof REPAIR_TYPES].defaultDuration

  // Fetch all completed jobs of this type in the garage with actual durations
  type HistoricalJob = {
    actualDuration: number | null
    estimatedDuration: number
    vehicleModel: string
    mechanicId: string
  }
  const historical = (await prisma.job.findMany({
    where: {
      garageId: session.user.garageId,
      repairType,
      status: 'completed',
      actualDuration: { not: null },
    },
    select: {
      actualDuration: true,
      estimatedDuration: true,
      vehicleModel: true,
      mechanicId: true,
    },
  })) as unknown as HistoricalJob[]

  if (historical.length === 0) {
    return NextResponse.json({
      recommended: defaultDuration,
      confidence: 'low',
      sampleSize: 0,
      source: 'default',
      breakdown: null,
    })
  }

  const vehicleBrand = vehicleModel.trim().toLowerCase().split(' ')[0]

  // Segment 1: Same mechanic + same brand
  const seg1 = historical.filter(
    (j: HistoricalJob) => j.mechanicId === mechanicId && vehicleBrand && j.vehicleModel.toLowerCase().startsWith(vehicleBrand)
  )
  // Segment 2: Same mechanic only
  const seg2 = historical.filter((j: HistoricalJob) => j.mechanicId === mechanicId)
  // Segment 3: Same brand only
  const seg3 = historical.filter((j: HistoricalJob) => vehicleBrand && j.vehicleModel.toLowerCase().startsWith(vehicleBrand))
  // Segment 4: All (same type)
  const seg4 = historical

  function avg(items: typeof historical) {
    if (items.length === 0) return null
    return Math.round(items.reduce((s, j) => s + (j.actualDuration ?? 0), 0) / items.length)
  }

  const mechBrandAvg = avg(seg1)
  const mechAvg = avg(seg2)
  const brandAvg = avg(seg3)
  const globalAvg = avg(seg4)!

  // Priority: mechanic+brand → mechanic → brand → global
  // Blend with default (30%) for stability
  let recommended: number
  let confidence: 'high' | 'medium' | 'low'
  let source: string
  let sampleSize: number

  if (seg1.length >= 3 && mechBrandAvg) {
    recommended = Math.round(mechBrandAvg * 0.85 + defaultDuration * 0.15)
    confidence = 'high'
    source = 'mechanic+brand'
    sampleSize = seg1.length
  } else if (seg2.length >= 3 && mechAvg) {
    recommended = Math.round(mechAvg * 0.80 + defaultDuration * 0.20)
    confidence = 'medium'
    source = 'mechanic'
    sampleSize = seg2.length
  } else if (seg3.length >= 3 && brandAvg) {
    recommended = Math.round(brandAvg * 0.75 + defaultDuration * 0.25)
    confidence = 'medium'
    source = 'brand'
    sampleSize = seg3.length
  } else if (seg4.length >= 2) {
    recommended = Math.round(globalAvg * 0.70 + defaultDuration * 0.30)
    confidence = 'low'
    source = 'global'
    sampleSize = seg4.length
  } else {
    recommended = defaultDuration
    confidence = 'low'
    source = 'default'
    sampleSize = seg4.length
  }

  // Per-mechanic breakdown (if multiple mechanics have data)
  type MechanicBreakdown = {
    mechanicId: string
    _avg: { actualDuration: number | null }
    _count: { id: number }
  }
  const mechanicBreakdown = (await prisma.job.groupBy({
    by: ['mechanicId'],
    where: {
      garageId: session.user.garageId,
      repairType,
      status: 'completed',
      actualDuration: { not: null },
    },
    _avg: { actualDuration: true },
    _count: { id: true },
  })) as unknown as MechanicBreakdown[]

  // Enrich with mechanic names
  const mechanicIds = mechanicBreakdown.map((b: MechanicBreakdown) => b.mechanicId)
  const mechanics = await prisma.mechanic.findMany({
    where: { id: { in: mechanicIds } },
    select: { id: true, name: true, color: true },
  })

  const mechanicComparison = mechanicBreakdown
    .filter((b: MechanicBreakdown) => b._avg.actualDuration && b._count.id >= 2)
    .map((b: MechanicBreakdown) => {
      const mech = mechanics.find(m => m.id === b.mechanicId)
      return {
        mechanicId: b.mechanicId,
        mechanicName: mech?.name ?? 'Inconnu',
        mechanicColor: mech?.color ?? '#6b7280',
        avgActualMinutes: Math.round(b._avg.actualDuration!),
        sampleSize: b._count.id,
      }
    })
    .sort((a, b) => a.avgActualMinutes - b.avgActualMinutes)

  return NextResponse.json({
    recommended,
    confidence,
    sampleSize,
    source,
    defaultDuration,
    breakdown: {
      globalAvg,
      mechBrandAvg,
      mechAvg,
      brandAvg,
      mechanicComparison,
    },
  })
})
