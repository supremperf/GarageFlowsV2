export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { jwtVerify } from 'jose'
import { portalSecret } from '@/lib/portal-secret'
import { calcTotalHT, calcTotalTTC, roundCents } from '@/lib/billing'
import { billingLines } from '@/lib/money-db'

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  try {
    const { payload } = await jwtVerify(params.token, portalSecret())
    if (payload.typ !== 'portal' || typeof payload.jobId !== 'string') {
      return NextResponse.json({ error: 'Token invalide' }, { status: 403 })
    }

    // Scope the lookup by the token's garageId when present (tokens issued after
    // this change carry it); legacy tokens without it still resolve by id.
    const jobWhere = typeof payload.garageId === 'string'
      ? { id: payload.jobId, garageId: payload.garageId }
      : { id: payload.jobId }

    const job = await prisma.job.findFirst({
      where: jobWhere,
      include: {
        mechanic: { select: { name: true, avatar: true, color: true } },
        photos: { select: { id: true, phase: true, caption: true, base64: true, photoPath: true, createdAt: true } },
        quotes: {
          where: { status: { not: 'draft' } },
          // SÉCURITÉ : select explicite des lignes SANS unitCost (coût/marge du
          // garage) — le portail client ne doit jamais recevoir ce champ interne.
          include: {
            lines: {
              select: { id: true, description: true, quantityTenThousandths: true, unitPriceTenThousandths: true, isLabor: true, sortOrder: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        garage: { select: { name: true, phone: true, email: true, logoBase64: true, logoPath: true } },
      },
    })
    if (!job) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

    const rawQuote = job.quotes[0] ?? null
    const quote = rawQuote
      ? {
          ...rawQuote,
          totalHT:  roundCents(calcTotalHT(billingLines(rawQuote.lines))),
          totalTTC: roundCents(calcTotalTTC(billingLines(rawQuote.lines), rawQuote.taxRate)),
        }
      : null

    return NextResponse.json({
      customerName: job.customerName,
      vehicleModel: job.vehicleModel,
      licensePlate: job.licensePlate,
      status: job.status,
      date: job.date,
      startTime: job.startTime,
      repairType: job.repairType,
      notes: job.notes,
      mechanic: job.mechanic,
      photos: job.photos,
      quote,
      garage: job.garage,
    })
  } catch {
    return NextResponse.json({ error: 'Token invalide ou expiré' }, { status: 403 })
  }
}
