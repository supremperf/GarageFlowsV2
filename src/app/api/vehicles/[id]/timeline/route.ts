export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { jobPartToEuros } from '@/lib/money-db'

export const GET = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()

  const vehicle = await prisma.vehicle.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    include: {
      client: { select: { id: true, name: true, phone: true, email: true } },
      jobs: {
        include: {
          mechanic: { select: { id: true, name: true, color: true } },
          jobParts: { include: { part: { select: { id: true, name: true, reference: true } } } },
          photos:   { select: { id: true, phase: true, caption: true, createdAt: true } },
          quotes:   { select: { id: true, number: true, status: true, createdAt: true } },
          invoices: { select: { id: true, number: true, status: true, createdAt: true } },
        },
        orderBy: { date: 'desc' },
      },
      quotes: {
        select: { id: true, number: true, status: true, issueDate: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      },
      warranties: {
        orderBy: { installedAt: 'desc' },
      },
    },
  })

  if (!vehicle) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Build chronological timeline
  const events: Array<{
    date: string
    type: 'job' | 'quote' | 'warranty'
    id: string
    title: string
    subtitle?: string
    status?: string
    mileage?: number | null
    data: unknown
  }> = []

  for (const rawJob of vehicle.jobs) {
    // jobParts : vue euros dérivée des entiers exacts (UI timeline).
    const job = { ...rawJob, jobParts: rawJob.jobParts.map(jobPartToEuros) }
    events.push({
      date:     job.date,
      type:     'job',
      id:       job.id,
      title:    job.repairType,
      subtitle: job.mechanic?.name,
      status:   job.status,
      mileage:  job.mileageAtVisit,
      data:     job,
    })
  }

  for (const quote of vehicle.quotes) {
    if (quote.status === 'refused') {
      events.push({
        date:   quote.issueDate,
        type:   'quote',
        id:     quote.id,
        title:  `Devis ${quote.number} refusé`,
        status: quote.status,
        data:   quote,
      })
    }
  }

  for (const w of vehicle.warranties) {
    events.push({
      date:     w.installedAt.toISOString().slice(0, 10),
      type:     'warranty',
      id:       w.id,
      title:    `Garantie: ${w.partName}`,
      subtitle: `Expire le ${w.expiresAt.toISOString().slice(0, 10)}`,
      status:   w.status,
      data:     w,
    })
  }

  events.sort((a, b) => b.date.localeCompare(a.date))

  return NextResponse.json({ vehicle, events })
})
