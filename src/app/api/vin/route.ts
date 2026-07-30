export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { vinEngine, VinValidationError } from '@/lib/vin'

const QuerySchema = z.object({ vin: z.string().trim().min(1).max(64) })

/**
 * GET /api/vin?vin=XXXX  → decode a VIN (offline-first engine) + record history.
 * GET /api/vin           → recent decode history for the garage (last 25).
 */
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const rawVin = searchParams.get('vin')

  // No vin → return recent history for this garage.
  if (!rawVin) {
    const history = await prisma.vinSearch.findMany({
      where: { garageId: session.user.garageId },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: { id: true, vin: true, source: true, createdAt: true },
    })
    return NextResponse.json({ history })
  }

  const parsed = QuerySchema.safeParse({ vin: rawVin })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Paramètre vin invalide' }, { status: 400 })
  }

  // Per-garage rate limit (the engine may call external providers in web builds).
  const rl = await enforceRateLimit('api', `vin:${session.user.garageId}`, { max: 30, windowSec: 60 })
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Trop de requêtes. Réessayez dans ${rl.retryAfterSec}s.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    )
  }

  let result
  try {
    result = await vinEngine.decode(parsed.data.vin)
  } catch (e) {
    if (e instanceof VinValidationError) {
      return NextResponse.json(
        { error: 'VIN invalide', details: e.validation.errors, validation: e.validation },
        { status: 400 },
      )
    }
    throw e
  }

  // Best-effort history record (never fail the decode on a write error).
  try {
    await prisma.vinSearch.create({
      data: {
        garageId: session.user.garageId,
        vin: result.vin,
        resultJson: JSON.stringify(result),
        source: result.source,
      },
    })
  } catch (e) {
    console.error('[vin] history write failed', e)
  }

  return NextResponse.json(result)
})
