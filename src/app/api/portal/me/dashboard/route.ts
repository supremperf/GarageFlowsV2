export const dynamic = 'force-dynamic'

/**
 * GET /api/portal/me/dashboard — the authenticated client's portal dashboard
 * (Phase 2 — « Tableau de bord client » + « Suivi des réparations »).
 *
 * Returns, scoped to the portal account's linked Client: vehicles, active repairs
 * with a live progress timeline, quotes, invoices (with totals) and warranties.
 * All data is real and read-only; nothing is fabricated.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withPortalAuth } from '@/lib/portal/auth-helpers'
import { withTotals } from '@/lib/billing'
import { repairTimeline } from '@/lib/portal/repair-timeline'
import { TERMINAL_JOB_STATUSES } from '@/lib/analytics/types'

export const GET = withPortalAuth(async (_req, { user }) => {
  // An account with no linked client has an empty (but valid) dashboard.
  if (!user.clientId) {
    return NextResponse.json({ linkedClient: false, vehicles: [], activeRepairs: [], quotes: [], invoices: [], warranties: [] })
  }
  const clientId = user.clientId

  const [vehicles, jobs, quotes, invoices, warranties] = await Promise.all([
    prisma.vehicle.findMany({
      where: { clientId, garageId: user.garageId },
      select: { id: true, licensePlate: true, make: true, model: true, year: true, mileage: true, ctDate: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.job.findMany({
      where: { garageId: user.garageId, vehicle: { clientId } },
      select: {
        id: true, status: true, repairType: true, date: true, startTime: true,
        vehicleModel: true, licensePlate: true, estimatedDuration: true, actualDuration: true, updatedAt: true,
        mechanic: { select: { name: true } },
      },
      orderBy: { date: 'desc' },
      take: 50,
    }),
    prisma.quote.findMany({
      where: { clientId, garageId: user.garageId },
      select: { id: true, number: true, status: true, issueDate: true, validUntil: true, taxRate: true, lines: { select: { quantity: true, unitPrice: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.invoice.findMany({
      where: { clientId, garageId: user.garageId },
      select: { id: true, number: true, status: true, issueDate: true, dueDate: true, taxRate: true, lines: { select: { quantity: true, unitPrice: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.warranty.findMany({
      where: { garageId: user.garageId, vehicle: { clientId } },
      select: { id: true, partName: true, status: true, installedAt: true, expiresAt: true, licensePlate: true, vehicleModel: true },
      orderBy: { expiresAt: 'asc' },
      take: 50,
    }),
  ])

  const activeRepairs = jobs
    .filter(j => !TERMINAL_JOB_STATUSES.has(j.status) || j.status === 'delivered')
    .map(j => ({
      id: j.id,
      repairType: j.repairType,
      status: j.status,
      date: j.date,
      startTime: j.startTime,
      vehicle: { model: j.vehicleModel, licensePlate: j.licensePlate },
      mechanic: j.mechanic?.name ?? null,
      updatedAt: j.updatedAt,
      timeline: repairTimeline(j.status),
    }))

  return NextResponse.json({
    linkedClient: true,
    vehicles,
    activeRepairs,
    quotes: quotes.map(q => withTotals(q)),
    invoices: invoices.map(i => withTotals(i)),
    warranties,
  })
})
