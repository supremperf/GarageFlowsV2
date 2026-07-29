export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { diagnose, type DiagnosticInput } from '@/lib/diagnostic'

const BodySchema = z.object({
  symptoms: z.array(z.string()).optional(),
  obdCodes: z.array(z.string()).optional(),
  mileage: z.number().nonnegative().optional(),
  history: z.array(z.string()).optional(),
  vehicleId: z.string().optional(),
})

// POST /api/diagnostic — probable causes from symptoms and/or OBD codes.
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const garageId = session.user.garageId
  const rl = rateLimit(`diag:${garageId}`, 60, 60)
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Trop de requêtes. Réessayez dans ${rl.retryAfter}s.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  const parsed = BodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }
  const body = parsed.data

  const input: DiagnosticInput = {
    symptoms: body.symptoms,
    obdCodes: body.obdCodes,
    mileage: body.mileage,
    history: [...(body.history ?? [])],
  }

  // Enrich from the vehicle: mileage + past repair types (by plate).
  if (body.vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: body.vehicleId, garageId },
      select: { mileage: true, licensePlate: true },
    })
    if (vehicle) {
      if (input.mileage == null && vehicle.mileage != null) input.mileage = vehicle.mileage
      try {
        const jobs = await prisma.job.findMany({
          where: { garageId, licensePlate: vehicle.licensePlate },
          select: { repairType: true },
          orderBy: { date: 'desc' },
          take: 20,
        })
        for (const j of jobs) if (j.repairType) input.history!.push(j.repairType)
      } catch {
        /* history is optional */
      }
    }
  }

  return NextResponse.json(diagnose(input))
})
