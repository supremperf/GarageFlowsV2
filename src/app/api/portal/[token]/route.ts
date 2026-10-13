export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { jwtVerify } from 'jose'
import { portalSecret } from '@/lib/portal-secret'
import { calcTotalHT, calcTotalTTC, roundCents } from '@/lib/billing'
import { billingLines, salesLinesToEuros } from '@/lib/money-db'
import { readPhotoAsDataUrl } from '@/lib/photo-store'

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

    // ── Repli INSTANTANÉ (portail publié par un POSTE) ─────────────────────
    // Un garage installé en local détient ses interventions dans SON SQLite :
    // le cloud n'a aucun Job à lire. Le poste a alors publié un instantané
    // (/api/sync/portal) adressé par le `jti` du jeton. On le sert tel quel.
    // Le `jti` seul ne suffit pas : garageId ET jobId doivent correspondre aux
    // revendications SIGNÉES du jeton — aucun accès transversal possible.
    if (typeof payload.jti === 'string' && payload.jti) {
      const snap = await prisma.portalSnapshot.findUnique({ where: { id: payload.jti } })
      if (snap && snap.jobId === payload.jobId && snap.garageId === payload.garageId) {
        if (snap.expiresAt.getTime() < Date.now()) {
          return NextResponse.json({ error: 'Token invalide ou expiré' }, { status: 403 })
        }
        try {
          return NextResponse.json(JSON.parse(snap.payload))
        } catch {
          return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
        }
      }
    }

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
        // `slug` : identifiant PUBLIC du garage, nécessaire au portail multi-garage
        // (`?garage=<slug>`). Sans lui, la convention n'était produite nulle part et
        // connexion comme inscription restaient impossibles sur le déploiement PWA.
        garage: { select: { name: true, slug: true, phone: true, email: true, logoBase64: true, logoPath: true } },
      },
    })
    if (!job) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

    const rawQuote = job.quotes[0] ?? null
    const quote = rawQuote
      ? {
          ...rawQuote,
          // CONTRAT : entiers exacts + dérivés euros/unités. Sans `lines`
          // dérivées, la page portail lisait `line.unitPrice` (undefined) et
          // toute l'intervention tombait sur l'écran d'erreur générique.
          lines: salesLinesToEuros(rawQuote.lines),
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
      // Le portail est public : il ne peut pas appeler /api/photos (authentifié).
      // On inline donc le logo stocké sur disque, sinon la page cliente n'affiche
      // jamais le logo du garage (seul `logoBase64` — désormais toujours null
      // après upload — était lu).
      garage: {
        ...job.garage,
        logoBase64: job.garage?.logoBase64 ?? readPhotoAsDataUrl(job.garage?.logoPath),
      },
    })
  } catch {
    return NextResponse.json({ error: 'Token invalide ou expiré' }, { status: 403 })
  }
}
