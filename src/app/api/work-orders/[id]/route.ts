export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { assertRelations } from '@/lib/tenant'
import { parseWorksJson, parsePartsJson, serializeWorksJsonV2, serializePartsJsonV2, workOrderTotalHtCents, workLinesToEuros, partLinesToEuros } from '@/lib/money-json'
import { workOrderToEuros } from '@/lib/money-db'
import { checkStatusTransition, isDeletable } from '@/lib/document-status'


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

// GET /api/work-orders/[id]
export const GET = withAuth(async (_req, { params }) => {
  const session = await requireSession()
  const wo = await prisma.workOrder.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    include: {
      mechanic: { select: { id: true, name: true, color: true } },
      job: { select: { id: true, customerName: true, vehicleModel: true, licensePlate: true } },
    },
  })
  if (!wo) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(wo ? workOrderView(wo) : wo)
})

// PATCH /api/work-orders/[id]
export const PATCH = withAuth(async (req, { params }) => {
  const session = await requireSession()
  const body = await req.json()

  const existing = await prisma.workOrder.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // ── DOCUMENT SIGNÉ = SCELLÉ ────────────────────────────────────────────────
  // Le JSON d'un OR signé est canonicalisé VERBATIM dans le document signé
  // (lib/signature/document.ts) : le ré-écrire — même à contenu équivalent —
  // invaliderait la signature. Lignes et taux sont donc VERROUILLÉS ; seuls les
  // champs non scellés (statut, notes, contact…) restent modifiables, et le
  // JSON stocké n'est JAMAIS ré-sérialisé.
  const isSigned = Boolean(existing.signedAt || existing.signatureData)
  if (isSigned && (body.worksJson !== undefined || body.partsJson !== undefined || body.taxRate !== undefined)) {
    return NextResponse.json(
      { error: 'Ordre signé : lignes et taux de TVA sont verrouillés (document scellé)' },
      { status: 400 },
    )
  }

  const updateData: Record<string, unknown> = {}
  if (!isSigned) {
    // Entrées : nouvelles valeurs OU JSON stocké ; validation stricte +
    // re-sérialisation V2 systématique (les écritures sont TOUJOURS v2).
    const worksInput = body.worksJson !== undefined ? body.worksJson : existing.worksJson
    const partsInput = body.partsJson !== undefined ? body.partsJson : existing.partsJson
    const taxRate = body.taxRate !== undefined ? body.taxRate : existing.taxRate

    const normalized = normalizeWorkOrderJson(worksInput, partsInput, taxRate)
    if (!normalized) {
      return NextResponse.json({ error: 'worksJson/partsJson invalides' }, { status: 400 })
    }
    // Centimes entiers = UNIQUE source de vérité (colonnes Float supprimées).
    updateData.worksJson = normalized.worksJson
    updateData.partsJson = normalized.partsJson
    updateData.taxRate = taxRate
    updateData.totalHtCents = normalized.totalHtCents
    updateData.totalTtcCents = normalized.totalTtcCents
  }

  if (body.status !== undefined) {
    // Machine à états : un OR ne revient jamais à « draft » (sinon le DELETE
    // « brouillon uniquement » serait contournable et permettrait d'effacer un
    // ordre signé — document scellé — en deux appels).
    const transitionError = checkStatusTransition('workOrder', existing.status, body.status)
    if (transitionError) return NextResponse.json({ error: transitionError }, { status: 409 })
    updateData.status = body.status
  }
  if (body.clientName !== undefined) updateData.clientName = body.clientName
  if (body.clientPhone !== undefined) updateData.clientPhone = body.clientPhone
  if (body.clientEmail !== undefined) updateData.clientEmail = body.clientEmail
  if (body.clientAddress !== undefined) updateData.clientAddress = body.clientAddress
  if (body.vehicleMake !== undefined) updateData.vehicleMake = body.vehicleMake
  if (body.vehicleModel !== undefined) updateData.vehicleModel = body.vehicleModel
  if (body.licensePlate !== undefined) updateData.licensePlate = body.licensePlate
  if (body.mileage !== undefined) updateData.mileage = body.mileage
  if (body.vin !== undefined) updateData.vin = body.vin
  if (body.mechanicId !== undefined) {
    // Validate the mechanic belongs to this garage before cross-linking.
    if (body.mechanicId !== null) {
      const mech = await prisma.mechanic.findFirst({
        where: { id: body.mechanicId, garageId: session.user.garageId },
      })
      if (!mech) return NextResponse.json({ error: 'mechanicId invalide' }, { status: 400 })
    }
    updateData.mechanicId = body.mechanicId
  }
  if (body.notes !== undefined) updateData.notes = body.notes

  // SECURITY (IDOR): un mécanicien réassigné doit appartenir au garage.
  const relErr = await assertRelations(session.user.garageId, [
    { model: 'mechanic', id: body.mechanicId, label: 'Mécanicien' },
  ])
  if (relErr) return relErr

  // Atomique (anti-TOCTOU) : la portée garageId est dans le where.
  const res = await prisma.workOrder.updateMany({
    where: { id: params.id, garageId: session.user.garageId },
    data: updateData,
  })
  if (res.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const wo = await prisma.workOrder.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    include: {
      mechanic: { select: { id: true, name: true, color: true } },
      job: { select: { id: true, customerName: true, vehicleModel: true, licensePlate: true } },
    },
  })
  return NextResponse.json(wo ? workOrderView(wo) : wo)
})

// DELETE /api/work-orders/[id]
export const DELETE = withAuth(async (_req, { params }) => {
  const session = await requireSession()
  const existing = await prisma.workOrder.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Un OR signé est SCELLÉ (preuve juridique) : jamais supprimable, quel que
  // soit son statut. Sinon, seuls les brouillons le sont.
  const signed = Boolean(existing.signedAt || existing.signatureData)
  if (!isDeletable('workOrder', existing.status, { signed })) {
    return NextResponse.json(
      { error: signed
          ? 'Un ordre de réparation signé ne peut pas être supprimé (document scellé).'
          : 'Seuls les ordres en brouillon peuvent être supprimés' },
      { status: 400 },
    )
  }
  await prisma.workOrder.deleteMany({ where: { id: params.id, garageId: session.user.garageId } })
  return NextResponse.json({ success: true })
})
