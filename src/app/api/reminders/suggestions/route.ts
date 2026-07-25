export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { subMonths, format } from 'date-fns'

export const GET = withAuth(async () => {
  const session = await requireSession()
  const garage = await prisma.garage.findUnique({
    where: { id: session.user.garageId },
    select: { smartReminderMonths: true },
  })
  const thresholdMonths = garage?.smartReminderMonths ?? 11
  const cutoffDate = format(subMonths(new Date(), thresholdMonths), 'yyyy-MM-dd')

  // Vehicles whose last completed job is older than the threshold AND no pending reminder exists
  const vehicles = await prisma.vehicle.findMany({
    where: {
      garageId: session.user.garageId,
      jobs: {
        some: { status: { in: ['completed', 'invoiced'] } },
      },
    },
    include: {
      client: { select: { id: true, name: true, phone: true, email: true } },
      jobs: {
        where: { status: { in: ['completed', 'invoiced'] } },
        orderBy: { date: 'desc' },
        take: 1,
        select: { id: true, date: true, repairType: true, mileageAtVisit: true },
      },
      reminders: {
        where: { status: 'pending' },
        take: 1,
        select: { id: true },
      },
    },
  })

  const suggestions = vehicles
    .filter(v => {
      const lastJob = v.jobs[0]
      if (!lastJob) return false
      if (v.reminders.length > 0) return false // already has a pending reminder
      return lastJob.date <= cutoffDate
    })
    .map(v => {
      const lastJob = v.jobs[0]!
      const monthsAgo = Math.floor(
        (Date.now() - new Date(lastJob.date).getTime()) / (1000 * 60 * 60 * 24 * 30)
      )
      return {
        vehicleId:    v.id,
        licensePlate: v.licensePlate,
        make:         v.make,
        model:        v.model,
        clientName:   v.client?.name ?? 'Client inconnu',
        clientPhone:  v.client?.phone ?? null,
        clientEmail:  v.client?.email ?? null,
        lastJobDate:  lastJob.date,
        lastJobType:  lastJob.repairType,
        monthsAgo,
        mileage:      lastJob.mileageAtVisit ?? v.mileage,
      }
    })
    .sort((a, b) => b.monthsAgo - a.monthsAgo)
    .slice(0, 20)

  return NextResponse.json({ suggestions, thresholdMonths })
})
