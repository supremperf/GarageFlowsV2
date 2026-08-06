export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { fromScaled } from '@/lib/money'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { subMonths, format } from 'date-fns'
import { recommendPrice, type PricingInput } from '@/lib/pricing'

const BodySchema = z.object({
  partId: z.string().optional(),
  unitCost: z.number().nonnegative().optional(),
  currentPrice: z.number().nonnegative().optional(),
  targetMarginPct: z.number().min(0).max(95).optional(),
  minMarginPct: z.number().min(0).max(95).optional(),
  competitorPrice: z.number().nonnegative().optional(),
  elasticity: z.number().optional(),
  baselineVolume: z.number().nonnegative().optional(),
  seasonFactor: z.number().min(0.1).max(3).optional(),
  loyaltyDiscountPct: z.number().min(0).max(90).optional(),
})

// POST /api/pricing — recommend a price for a part (or an ad-hoc cost).
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const garageId = session.user.garageId
  const rl = await enforceRateLimit('api', `pricing:${garageId}`, { max: 60, windowSec: 60 })
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
  const body = parsed.data

  const input: PricingInput = {
    unitCost: body.unitCost ?? 0,
    currentPrice: body.currentPrice,
    targetMarginPct: body.targetMarginPct,
    minMarginPct: body.minMarginPct,
    competitorPrice: body.competitorPrice,
    elasticity: body.elasticity,
    baselineVolume: body.baselineVolume,
    seasonFactor: body.seasonFactor,
    loyaltyDiscountPct: body.loyaltyDiscountPct,
    currency: 'EUR',
  }

  // Enrich from the part when a partId is given.
  if (body.partId) {
    const part = await prisma.part.findFirst({
      where: { id: body.partId, garageId },
      select: { unitCostTenThousandths: true, unitPriceTenThousandths: true },
    })
    if (!part) return NextResponse.json({ error: 'Pièce introuvable' }, { status: 404 })
    input.unitCost = body.unitCost ?? fromScaled(part.unitCostTenThousandths)
    input.currentPrice = body.currentPrice ?? fromScaled(part.unitPriceTenThousandths)

    // Baseline monthly volume from the last 3 months of sales, if not supplied.
    if (input.baselineVolume == null) {
      const since = format(subMonths(new Date(), 3), 'yyyy-MM-dd')
      const agg = await prisma.jobPart.aggregate({
        where: { partId: body.partId, job: { garageId, date: { gte: since } } },
        _sum: { quantity: true },
      })
      const total = agg._sum.quantity ?? 0
      if (total > 0) input.baselineVolume = Math.round((total / 3) * 100) / 100
    }
    const garage = await prisma.garage.findUnique({ where: { id: garageId }, select: { currency: true } })
    input.currency = garage?.currency ?? 'EUR'
  }

  if (input.unitCost <= 0) {
    return NextResponse.json({ error: 'unitCost (ou partId avec coût) requis et > 0' }, { status: 400 })
  }

  return NextResponse.json(recommendPrice(input))
})
