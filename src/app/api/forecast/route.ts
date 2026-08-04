export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { subMonths, format } from 'date-fns'
import { calcTotalHT } from '@/lib/billing'
import { forecast, type ForecastMethod } from '@/lib/forecast'

const METRICS = ['revenue', 'appointments', 'workshop_load'] as const
type Metric = (typeof METRICS)[number]

/** Build the ordered list of month keys (yyyy-MM) for the last `months`. */
function monthKeys(months: number): string[] {
  const now = new Date()
  return Array.from({ length: months }, (_, i) => format(subMonths(now, months - 1 - i), 'yyyy-MM'))
}

async function buildSeries(metric: Metric, garageId: string, months: number): Promise<{ labels: string[]; values: number[] }> {
  const keys = monthKeys(months)
  const index = new Map(keys.map((k, i) => [k, i]))
  const values = new Array(keys.length).fill(0)
  const startKey = keys[0]
  const startDate = `${startKey}-01`

  if (metric === 'revenue') {
    const invoices = await prisma.invoice.findMany({
      where: { garageId, status: 'paid', issueDate: { gte: startDate } },
      select: { issueDate: true, lines: { select: { quantity: true, unitPrice: true } } },
    })
    for (const inv of invoices) {
      const k = inv.issueDate.slice(0, 7)
      const i = index.get(k)
      if (i !== undefined) values[i] += calcTotalHT(inv.lines)
    }
  } else {
    // appointments (count) and workshop_load (sum of estimated minutes → hours)
    const jobs = await prisma.job.findMany({
      where: { garageId, date: { gte: startDate } },
      select: { date: true, estimatedDuration: true },
    })
    for (const j of jobs) {
      const k = j.date.slice(0, 7)
      const i = index.get(k)
      if (i === undefined) continue
      values[i] += metric === 'appointments' ? 1 : (j.estimatedDuration ?? 0) / 60
    }
  }

  return { labels: keys, values: values.map((v) => Math.round(v * 100) / 100) }
}

// GET /api/forecast?metric=revenue&months=12&horizon=3
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  if (!can(session.user.role, 'financial:read')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
  const { searchParams } = new URL(req.url)
  const metricParam = (searchParams.get('metric') ?? 'revenue') as Metric
  const metric: Metric = METRICS.includes(metricParam) ? metricParam : 'revenue'
  const months = Math.min(36, Math.max(3, Number(searchParams.get('months') ?? '12')))
  const horizon = Math.min(12, Math.max(1, Number(searchParams.get('horizon') ?? '3')))
  const methodParam = searchParams.get('method') as ForecastMethod | 'auto' | null

  const series = await buildSeries(metric, session.user.garageId, months)
  const result = forecast(series.values, {
    horizon,
    method: methodParam ?? 'auto',
    seasonPeriod: months >= 24 ? 12 : undefined,
  })

  return NextResponse.json({ metric, history: series, forecast: result })
})

const PostSchema = z.object({
  series: z.array(z.number()).min(1),
  horizon: z.number().int().min(1).max(24).optional(),
  method: z.enum(['auto', 'linear', 'moving_average', 'seasonal_naive', 'naive']).optional(),
  seasonPeriod: z.number().int().min(2).max(52).optional(),
})

// POST /api/forecast — forecast an arbitrary numeric series (no DB).
export const POST = withAuth(async (req) => {
  await requireSession()
  const parsed = PostSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }
  const { series, horizon, method, seasonPeriod } = parsed.data
  return NextResponse.json({ forecast: forecast(series, { horizon, method, seasonPeriod }) })
})
