export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma, isPostgresDatabase } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { loanerToEuros } from '@/lib/money-db'
import { UpdateLoanerReservationSchema } from '@/lib/schemas'
import { findOverlappingReservation, lockLoanerVehicleRow, STATUTS_OCCUPANTS } from '@/lib/loaner/availability'

export const PATCH = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const existing = await prisma.loanerReservation.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Le corps était recopié champ par champ SANS aucune validation :
  //  - `status` verbatim — une valeur hors énumération (« en cours ») faisait
  //    sortir le prêt de toutes les vues ET de tous les garde-fous, qui filtrent
  //    sur ['reserved','active'] : le véhicule redevenait réservable alors qu'il
  //    était physiquement sorti, et sa suppression n'était plus bloquée ;
  //  - `new Date(body.startDate)` sans contrôle — une date illisible persistait
  //    en « Invalid Date », alors que le POST refuse ce cas depuis GF31-AUD-022 ;
  //  - `Number(body.mileageIn)` — « abc » devenait NaN.
  const parsed = UpdateLoanerReservationSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Réservation invalide', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const body = parsed.data

  // Période résultante : le PATCH peut ne toucher qu'une seule borne, la
  // cohérence se juge donc sur l'état APRÈS application.
  const startDate = body.startDate !== undefined ? new Date(body.startDate) : existing.startDate
  const endDate   = body.endDate   !== undefined ? new Date(body.endDate)   : existing.endDate
  // Même règle que la création : seule l'inversion est refusée (cf. POST).
  if (endDate.getTime() < startDate.getTime()) {
    return NextResponse.json(
      { error: 'La date de fin ne peut pas précéder la date de début.', code: 'VALIDATION_ERROR' },
      { status: 400 },
    )
  }

  const data: Record<string, unknown> = {}
  if (body.status !== undefined)       data.status       = body.status
  if (body.clientName !== undefined)   data.clientName   = body.clientName
  if (body.clientPhone !== undefined)  data.clientPhone  = body.clientPhone
  if (body.startDate !== undefined)    data.startDate    = startDate
  if (body.endDate !== undefined)      data.endDate      = endDate
  if (body.mileageOut !== undefined)   data.mileageOut   = body.mileageOut
  if (body.mileageIn !== undefined)    data.mileageIn    = body.mileageIn
  if (body.conditionOut !== undefined) data.conditionOut = body.conditionOut
  if (body.conditionIn !== undefined)  data.conditionIn  = body.conditionIn
  if (body.notes !== undefined)        data.notes        = body.notes
  if (body.isPaid !== undefined)       data.isPaid       = body.isPaid
  if (body.dailyRate !== undefined)     data.dailyRateTenThousandths = body.dailyRate
  if (body.depositAmount !== undefined) data.depositAmountCents      = body.depositAmount
  if (body.status === 'returned' && !existing.returnedAt) data.returnedAt = new Date()

  // ── DISPONIBILITÉ (§64, §156) ──────────────────────────────────────────────
  // Le contrôle atomique n'existait que sur la CRÉATION : déplacer une
  // réservation sur une période déjà prise, ou ranimer une réservation annulée
  // qui en recouvre une autre, contournait la garantie « un véhicule, un prêt à
  // la fois ». Une règle métier qui ne tient que sur un chemin d'écriture sur
  // deux n'en est pas une.
  const statutApres = (body.status ?? existing.status) as string
  const occupeApres = (STATUTS_OCCUPANTS as readonly string[]).includes(statutApres)
  const periodeChange =
    startDate.getTime() !== existing.startDate.getTime() ||
    endDate.getTime() !== existing.endDate.getTime()
  const redevientOccupant =
    occupeApres && !(STATUTS_OCCUPANTS as readonly string[]).includes(existing.status)
  const doitVerifier = occupeApres && (periodeChange || redevientOccupant)

  let conflit: { clientName: string } | null = null
  const updated = await prisma.$transaction(async (tx) => {
    if (doitVerifier) {
      if (isPostgresDatabase()) {
        await lockLoanerVehicleRow(tx, existing.vehicleId)
      }
      const existante = await findOverlappingReservation(tx, {
        garageId: session.user.garageId,
        vehicleId: existing.vehicleId,
        startDate,
        endDate,
        exclureId: existing.id,
      })
      if (existante) { conflit = existante; return null }
    }
    return tx.loanerReservation.update({
      where: { id: params.id, garageId: session.user.garageId },
      data,
      include: { vehicle: { select: { id: true, name: true, licensePlate: true } } },
    })
  })

  if (!updated) {
    return NextResponse.json(
      {
        error: `Ce véhicule est déjà réservé sur cette période (${(conflit as unknown as { clientName: string } | null)?.clientName ?? 'autre client'}).`,
        code: 'VEHICLE_UNAVAILABLE',
      },
      { status: 409 },
    )
  }

  return NextResponse.json(loanerToEuros(updated))
})

export const DELETE = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const existing = await prisma.loanerReservation.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await prisma.loanerReservation.update({ where: { id: params.id, garageId: session.user.garageId }, data: { status: 'cancelled' } })
  return NextResponse.json({ success: true })
})
