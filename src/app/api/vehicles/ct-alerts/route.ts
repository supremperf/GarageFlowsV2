export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { addDays, parseISO, differenceInDays, isValid } from 'date-fns'

// GET /api/vehicles/ct-alerts?days=60
// Returns vehicles whose CT expires within the next N days (default 60) or is already expired.
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const daysAhead = Math.min(365, Math.max(1, Number(searchParams.get('days') ?? '60')))

  const today   = new Date()
  const horizon = addDays(today, daysAhead)

  const vehicles = await prisma.vehicle.findMany({
    where: {
      garageId: session.user.garageId,
      ctDate: { not: null },
    },
    include: {
      client: { select: { id: true, name: true, phone: true } },
    },
    orderBy: { ctDate: 'asc' },
  })

  const alerts = vehicles
    .filter(v => v.ctDate !== null)
    .flatMap(v => {
      try {
        const date = parseISO(v.ctDate!)
        if (!isValid(date)) return []
        const daysLeft = differenceInDays(date, today)
        return [{
          vehicleId:  v.id,
          plate:      v.licensePlate,
          make:       v.make,
          model:      v.model,
          ctDate:     v.ctDate,
          daysLeft,
          expired:    daysLeft < 0,
          urgent:     daysLeft >= 0 && daysLeft <= 30,
          warning:    daysLeft > 30 && daysLeft <= daysAhead,
          client:     v.client,
        }]
      } catch {
        return []
      }
    })
    .filter(a => a.daysLeft <= daysAhead)

  return NextResponse.json({
    alerts,
    expired: alerts.filter(a => a.expired).length,
    urgent:  alerts.filter(a => a.urgent).length,
    total:   alerts.length,
  })
})
