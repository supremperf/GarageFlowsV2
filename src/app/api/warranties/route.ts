export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { assertRelations } from '@/lib/tenant'
import { addMonths } from 'date-fns'

export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const vehicleId = searchParams.get('vehicleId')
  const expiringDays = searchParams.get('expiringDays')

  const where: Record<string, unknown> = { garageId: session.user.garageId }
  if (status) where.status = status
  if (vehicleId) where.vehicleId = vehicleId
  if (expiringDays) {
    const cutoff = addMonths(new Date(), 0)
    cutoff.setDate(cutoff.getDate() + Number(expiringDays))
    where.expiresAt = { lte: cutoff }
    where.status = 'active'
  }

  const warranties = await prisma.warranty.findMany({
    where,
    include: { job: { select: { id: true, repairType: true, date: true } } },
    orderBy: { expiresAt: 'asc' },
  })

  return NextResponse.json(warranties)
})

export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const body = await req.json()

  if (!body.partName?.trim())  return NextResponse.json({ error: 'partName requis' }, { status: 400 })
  if (!body.clientName?.trim()) return NextResponse.json({ error: 'clientName requis' }, { status: 400 })

  // SECURITY (IDOR): job & véhicule liés doivent appartenir au garage.
  const relErr = await assertRelations(session.user.garageId, [
    { model: 'job', id: body.jobId, label: 'Intervention' },
    { model: 'vehicle', id: body.vehicleId, label: 'Véhicule' },
  ])
  if (relErr) return relErr

  // ── Le réglage du garage est enfin LU (GF-039) ────────────────────────────
  // `warrantyMonthsDefault` était validé, persisté, et n'avait aucun lecteur :
  // toute garantie partait à 12 mois quoi qu'ait réglé le garage. L'aide de
  // l'écran affirme pourtant « Appliquée automatiquement à chaque nouvelle
  // garantie » — le mensonge était explicite. Le `?? 12` reste le filet pour un
  // garage sans réglage.
  const garage = await prisma.garage.findUnique({
    where: { id: session.user.garageId },
    select: { warrantyMonthsDefault: true },
  })
  const durationMonths = Number(body.durationMonths ?? garage?.warrantyMonthsDefault ?? 12)
  const installedAt = body.installedAt ? new Date(body.installedAt) : new Date()
  const expiresAt = addMonths(installedAt, durationMonths)

  const warranty = await prisma.warranty.create({
    data: {
      garageId:        session.user.garageId,
      jobId:           body.jobId ?? null,
      vehicleId:       body.vehicleId ?? null,
      clientName:      body.clientName.trim(),
      licensePlate:    body.licensePlate ?? null,
      vehicleModel:    body.vehicleModel ?? null,
      partName:        body.partName.trim(),
      partReference:   body.partReference ?? null,
      lotNumber:       body.lotNumber ?? null,
      installedAt,
      durationMonths,
      expiresAt,
      mileageAtInstall: body.mileageAtInstall ? Number(body.mileageAtInstall) : null,
      supplierName:    body.supplierName ?? null,
      notes:           body.notes ?? null,
      status:          'active',
    },
  })

  return NextResponse.json(warranty, { status: 201 })
})
