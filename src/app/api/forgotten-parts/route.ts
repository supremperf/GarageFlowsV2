export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { forgottenPartsEngine } from '@/lib/forgotten-parts'

const BodySchema = z.object({
  operations: z.array(z.string()).optional(),
  partsOnJob: z.array(z.object({ name: z.string().nullable().optional(), reference: z.string().nullable().optional() })).optional(),
  jobId: z.string().optional(),
})

// POST /api/forgotten-parts — suggest complementary parts for a job's operations.
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const garageId = session.user.garageId
  const rl = await enforceRateLimit('api', `forgotten:${garageId}`, { max: 60, windowSec: 60 })
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Trop de requêtes. Réessayez dans ${rl.retryAfterSec}s.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    )
  }

  const parsed = BodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }

  const operations = [...(parsed.data.operations ?? [])]
  const partsOnJob = [...(parsed.data.partsOnJob ?? [])]

  // Enrich from the job when a jobId is given.
  if (parsed.data.jobId) {
    const job = await prisma.job.findFirst({
      where: { id: parsed.data.jobId, garageId },
      include: { jobParts: { include: { part: { select: { name: true, reference: true } } } } },
    })
    if (!job) return NextResponse.json({ error: 'Intervention introuvable' }, { status: 404 })
    if (job.repairType) operations.push(job.repairType)
    for (const jp of job.jobParts) {
      partsOnJob.push({ name: jp.part?.name ?? null, reference: jp.part?.reference ?? null })
    }
  }

  if (operations.length === 0) {
    return NextResponse.json({ error: 'operations ou jobId requis' }, { status: 400 })
  }

  // Catalog (name/reference → unit price) + garage habits (parts added often).
  const parts = await prisma.part.findMany({
    where: { garageId },
    select: { id: true, name: true, reference: true, unitPrice: true },
  })
  const catalog = new Map<string, number>()
  const idToName = new Map<string, string>()
  for (const p of parts) {
    if (p.name) catalog.set(p.name, p.unitPrice)
    if (p.reference) catalog.set(p.reference, p.unitPrice)
    idToName.set(p.id, p.name)
  }

  let garageHabits: string[] = []
  try {
    const grouped = await prisma.jobPart.groupBy({
      by: ['partId'],
      where: { job: { garageId } },
      _count: { partId: true },
    })
    garageHabits = grouped
      .filter((g) => (g._count.partId ?? 0) >= 3)
      .map((g) => idToName.get(g.partId))
      .filter((n): n is string => !!n)
  } catch {
    /* habits are optional */
  }

  const recommendations = forgottenPartsEngine.analyze({
    operations,
    partsOnJob,
    catalog,
    garageHabits,
  })

  const potentialImpact = recommendations.reduce((s, r) => s + (r.estimatedImpact.total ?? 0), 0)

  return NextResponse.json({
    recommendations,
    summary: {
      count: recommendations.length,
      potentialImpact: Math.round(potentialImpact * 100) / 100,
      currency: 'EUR',
    },
  })
})
