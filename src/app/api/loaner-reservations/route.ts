export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma, isPostgresDatabase } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { assertRelations } from '@/lib/tenant'
import { loanerToEuros } from '@/lib/money-db'
import { CreateLoanerReservationSchema } from '@/lib/schemas'
import { findOverlappingReservation, lockLoanerVehicleRow } from '@/lib/loaner/availability'

export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const vehicleId = searchParams.get('vehicleId')
  const status = searchParams.get('status')
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  const where: Record<string, unknown> = { garageId: session.user.garageId }
  if (vehicleId) where.vehicleId = vehicleId
  if (status) where.status = status
  if (startDate && endDate) {
    // Le filtre testait « le début OU la fin tombe dans la fenêtre » : une
    // réservation qui ENGLOBE la semaine affichée (commencée avant, finissant
    // après) n'était donc jamais renvoyée, et le planning montrait « libre » un
    // véhicule sorti depuis trois semaines. Le bon critère est le chevauchement.
    const debutFenetre = new Date(startDate)
    // La fenêtre inclut la journée entière de `endDate` : sans cela, une
    // réservation commençant à 08:00 le dernier jour était exclue.
    const finFenetre = new Date(new Date(endDate).getTime() + 24 * 60 * 60 * 1000)
    where.startDate = { lt: finFenetre }
    where.endDate = { gte: debutFenetre }
  }

  const reservations = await prisma.loanerReservation.findMany({
    where,
    include: { vehicle: { select: { id: true, name: true, licensePlate: true, color: true } } },
    orderBy: { startDate: 'asc' },
  })

  return NextResponse.json(reservations.map(loanerToEuros))
})

export const POST = withAuth(async (req) => {
  const session = await requireSession()

  // Validation par schéma (§32). Elle couvre d'un coup trois défauts qui étaient
  // traités à la main, chacun de façon incomplète : dates illisibles persistées
  // en « Invalid Date », montants non numériques silencieusement ramenés à 0 €,
  // et kilométrages `Number('abc') = NaN`.
  const parsed = CreateLoanerReservationSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Réservation invalide', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const body = parsed.data

  const startDate = new Date(body.startDate)
  const endDate = new Date(body.endDate)
  // Seule la période INVERSÉE est refusée. « Du 10 au 10 » — le prêt d'une
  // journée — est un cas courant que l'interface propose et chiffre : le
  // refuser comme « durée nulle » aurait interdit le prêt du jour même.
  // L'occupation d'une telle période est traitée par `finEffective`.
  if (endDate.getTime() < startDate.getTime()) {
    return NextResponse.json(
      { error: 'La date de fin ne peut pas précéder la date de début.', code: 'VALIDATION_ERROR' },
      { status: 400 },
    )
  }

  const vehicle = await prisma.loanerVehicle.findFirst({ where: { id: body.vehicleId, garageId: session.user.garageId } })
  if (!vehicle) return NextResponse.json({ error: 'Véhicule introuvable' }, { status: 404 })

  // SECURITY (IDOR): une intervention liée doit appartenir au garage.
  const relErr = await assertRelations(session.user.garageId, [{ model: 'job', id: body.jobId, label: 'Intervention' }])
  if (relErr) return relErr

  // ── DISPONIBILITÉ — contrôle ATOMIQUE (§64) ────────────────────────────────
  // Aucun contrôle n'existait : le même véhicule de prêt pouvait être réservé
  // deux fois sur la même période, y compris par deux utilisateurs simultanés.
  // Le contrôle vit DANS la transaction, précédé d'un verrou de ligne sur le
  // véhicule (PostgreSQL) qui sérialise les réservations concurrentes du MÊME
  // véhicule — sans quoi deux lectures « libre » se croiseraient.
  let conflit: { id: string; clientName: string } | null = null
  const reservation = await prisma.$transaction(async (tx) => {
    if (isPostgresDatabase()) {
      await lockLoanerVehicleRow(tx, body.vehicleId)
    }
    const existante = await findOverlappingReservation(tx, {
      garageId: session.user.garageId,
      vehicleId: body.vehicleId,
      startDate,
      endDate,
    })
    if (existante) { conflit = existante; return null }

    return tx.loanerReservation.create({
      data: {
        garageId:     session.user.garageId,
        vehicleId:    body.vehicleId,
        jobId:        body.jobId ?? null,
        clientName:   body.clientName,
        clientPhone:  body.clientPhone ?? null,
        startDate,
        endDate,
        mileageOut:   body.mileageOut ?? null,
        conditionOut: body.conditionOut ?? null,
        notes:        body.notes ?? null,
        isPaid:       Boolean(body.isPaid),
        // Tarif journalier en dix-milliemes, caution en centimes — sources de vérité uniques.
        dailyRateTenThousandths: body.dailyRate ?? null,
        depositAmountCents:      body.depositAmount ?? null,
        status:       'reserved',
      },
      include: { vehicle: { select: { id: true, name: true, licensePlate: true } } },
    })
  })

  if (!reservation) {
    return NextResponse.json(
      {
        error: `Ce véhicule est déjà réservé sur cette période (${(conflit as unknown as { clientName: string } | null)?.clientName ?? 'autre client'}).`,
        code: 'VEHICLE_UNAVAILABLE',
      },
      { status: 409 },
    )
  }

  return NextResponse.json(loanerToEuros(reservation), { status: 201 })
})
