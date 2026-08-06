export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { assertRelations } from '@/lib/tenant'
import { parseWorksJson, parsePartsJson, serializeWorksJsonV2, serializePartsJsonV2, workOrderTotalHtCents, workLinesToEuros, partLinesToEuros } from '@/lib/money-json'
import { workOrderToEuros } from '@/lib/money-db'


/**
 * Normalise l'entrée client (tableaux euros v1 OU objet v2 OU chaîne JSON) en
 * lignes EXACTES via lib/money-json (validation STRICTE — NaN/Infinity/formes
 * inattendues rejetées), calcule les totaux en centimes et produit les chaînes
 * V2 persistées (AUCUN flottant monétaire stocké). Renvoie null si invalide.
 */
function normalizeWorkOrderJson(
  worksInput: unknown,
  partsInput: unknown,
  taxRate: number,
): {
  worksJson: string
  partsJson: string
  totalHtCents: number
  totalTtcCents: number
} | null {
  try {
    const worksRaw = typeof worksInput === 'string' ? worksInput : JSON.stringify(worksInput ?? [])
    const partsRaw = typeof partsInput === 'string' ? partsInput : JSON.stringify(partsInput ?? [])
    const works = parseWorksJson(worksRaw).lines
    const parts = parsePartsJson(partsRaw).lines
    const totalHtCents = workOrderTotalHtCents(works, parts)
    const rate = Number(taxRate) || 0
    const totalTtcCents = totalHtCents + Math.round((totalHtCents * rate) / 100)
    return {
      worksJson: serializeWorksJsonV2(works),
      partsJson: serializePartsJsonV2(parts),
      totalHtCents,
      totalTtcCents,
    }
  } catch {
    return null
  }
}


/** Vue API d'un OR : euros dérivés + lignes euros parsées (v1 signés / v2). */
function workOrderView(wo: Parameters<typeof workOrderToEuros>[0] & { worksJson: string; partsJson: string }) {
  const base = workOrderToEuros(wo)
  try {
    return {
      ...base,
      works: workLinesToEuros(parseWorksJson(wo.worksJson).lines),
      parts: partLinesToEuros(parsePartsJson(wo.partsJson).lines),
    }
  } catch {
    // Ligne au JSON illisible : on n'écrase rien, on signale (jamais de crash de liste).
    return { ...base, works: [], parts: [], jsonError: true }
  }
}

// GET /api/work-orders
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const jobId = searchParams.get('jobId')

  const where: Record<string, unknown> = { garageId: session.user.garageId }
  if (status) where.status = status
  if (jobId) where.jobId = jobId

  const orders = await prisma.workOrder.findMany({
    where,
    include: {
      mechanic: { select: { id: true, name: true, color: true } },
      job: { select: { id: true, customerName: true, vehicleModel: true, licensePlate: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(orders.map(workOrderView)) // euros dérivés + lignes euros
})

// POST /api/work-orders
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const body = await req.json()

  if (!body.clientName) {
    return NextResponse.json({ error: 'clientName est requis' }, { status: 400 })
  }

  // SECURITY (IDOR): job & mécanicien assignés doivent appartenir au garage.
  const relErr = await assertRelations(session.user.garageId, [
    { model: 'job', id: body.jobId, label: 'Intervention' },
    { model: 'mechanic', id: body.mechanicId, label: 'Mécanicien' },
  ])
  if (relErr) return relErr

  const taxRate = body.taxRate ?? 20
  // Validation stricte + conversion v1→exact + sérialisation V2 (entiers).
  const normalized = normalizeWorkOrderJson(body.worksJson, body.partsJson, taxRate)
  if (!normalized) {
    return NextResponse.json({ error: 'worksJson/partsJson invalides' }, { status: 400 })
  }
  const { worksJson, partsJson, totalHtCents, totalTtcCents } = normalized

  // Validate optional foreign keys belong to THIS garage before referencing them.
  if (body.jobId) {
    const job = await prisma.job.findFirst({ where: { id: body.jobId, garageId: session.user.garageId } })
    if (!job) return NextResponse.json({ error: 'jobId invalide' }, { status: 400 })
  }
  if (body.mechanicId) {
    const mech = await prisma.mechanic.findFirst({ where: { id: body.mechanicId, garageId: session.user.garageId } })
    if (!mech) return NextResponse.json({ error: 'mechanicId invalide' }, { status: 400 })
  }

  const year = new Date().getFullYear()

  // Réservation du numéro + création atomiques (pas de trou de séquence) ;
  // unicité garantie par @@unique([garageId, number]).
  let workOrder
  try {
    workOrder = await prisma.$transaction(async (tx) => {
      const garage = await tx.garage.update({
        where: { id: session.user.garageId },
        data: { workOrderCounter: { increment: 1 } },
      })
      const number = `${garage.workOrderPrefix}-${year}-${String(garage.workOrderCounter).padStart(3, '0')}`
      return tx.workOrder.create({
        data: {
          number,
          garageId: session.user.garageId,
          jobId: body.jobId ?? null,
          mechanicId: body.mechanicId ?? null,
          clientName: body.clientName,
          clientPhone: body.clientPhone ?? null,
          clientEmail: body.clientEmail ?? null,
          clientAddress: body.clientAddress ?? null,
          vehicleMake: body.vehicleMake ?? null,
          vehicleModel: body.vehicleModel ?? null,
          licensePlate: body.licensePlate ?? null,
          mileage: body.mileage ?? null,
          vin: body.vin ?? null,
          worksJson,
          partsJson,
          taxRate,
          // Centimes entiers = UNIQUE source de vérité (colonnes Float supprimées).
          totalHtCents,
          totalTtcCents,
          notes: body.notes ?? null,
          status: 'draft',
        },
        include: {
          mechanic: { select: { id: true, name: true, color: true } },
          job: { select: { id: true, customerName: true, vehicleModel: true, licensePlate: true } },
        },
      })
    })
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ error: 'Numéro d\'ordre de réparation déjà utilisé, réessayez' }, { status: 409 })
    }
    throw e
  }

  return NextResponse.json(workOrderView(workOrder), { status: 201 })
})
