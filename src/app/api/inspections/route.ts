export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { assertRelations } from '@/lib/tenant'
import { resolveInspectionContext } from '@/lib/inspection/context'

// GET /api/inspections?jobId=xxx
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const jobId = searchParams.get('jobId')
  const vehicleId = searchParams.get('vehicleId')

  const where: Record<string, unknown> = { garageId: session.user.garageId }
  if (jobId) where.jobId = jobId
  if (vehicleId) where.vehicleId = vehicleId

  const inspections = await prisma.inspection.findMany({
    where,
    include: { items: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  return NextResponse.json(inspections)
})

// POST /api/inspections — create a new inspection (with items)
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const body = await req.json()

  // SECURITY (IDOR): job & véhicule liés doivent appartenir au garage.
  const relErr = await assertRelations(session.user.garageId, [
    { model: 'job', id: body.jobId, label: 'Intervention' },
    { model: 'vehicle', id: body.vehicleId, label: 'Véhicule' },
  ])
  if (relErr) return relErr

  // RATTACHEMENT AUTORITAIRE. Le véhicule n'est pas ce que le client déclare :
  // il est résolu depuis l'intervention (Job.vehicleId, sinon immatriculation)
  // DANS LE GARAGE DE LA SESSION. Sans cela toutes les inspections restaient
  // `vehicleId = NULL` — plus d'historique véhicule ni de relance kilométrique.
  const context = await resolveInspectionContext(session.user.garageId, body.jobId, body.vehicleId)

  // Le kilométrage saisi dans la modale prime (relevé du jour) ; à défaut on
  // reprend le dernier kilométrage connu du véhicule.
  const typedMileage = body.mileage !== undefined && body.mileage !== null && body.mileage !== ''
    ? parseInt(String(body.mileage), 10)
    : null
  const mileage = Number.isFinite(typedMileage as number) ? typedMileage : context?.mileage ?? null

  const inspection = await prisma.inspection.create({
    data: {
      garageId: session.user.garageId,
      jobId: body.jobId ?? null,
      vehicleId: context?.vehicleId ?? body.vehicleId ?? null,
      clientName: body.clientName ?? context?.clientName ?? '',
      vehicleModel: body.vehicleModel ?? context?.vehicleModel ?? null,
      licensePlate: body.licensePlate ?? context?.licensePlate ?? null,
      mileage,
      status: 'draft',
      notes: body.notes ?? null,
      items: {
        create: (body.items ?? DEFAULT_CHECKLIST).map(
          (item: { category: string; label: string; status?: string; notes?: string; photoBase64?: string; sortOrder?: number }, i: number) => ({
            category: item.category,
            label: item.label,
            status: item.status ?? 'ok',
            notes: item.notes ?? null,
            photoBase64: item.photoBase64 ?? null,
            sortOrder: item.sortOrder ?? i,
          })
        ),
      },
    },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  })
  return NextResponse.json(inspection, { status: 201 })
})

// Default checklist items
const DEFAULT_CHECKLIST = [
  { category: 'brakes',     label: 'Freins avant',         sortOrder: 0 },
  { category: 'brakes',     label: 'Freins arrière',        sortOrder: 1 },
  { category: 'tires',      label: 'Pneus avant',           sortOrder: 2 },
  { category: 'tires',      label: 'Pneus arrière',         sortOrder: 3 },
  { category: 'lights',     label: 'Phares avant',          sortOrder: 4 },
  { category: 'lights',     label: 'Feux arrière',          sortOrder: 5 },
  { category: 'lights',     label: 'Clignotants',           sortOrder: 6 },
  { category: 'oil',        label: 'Niveau huile moteur',   sortOrder: 7 },
  { category: 'oil',        label: 'Niveau liquide frein',  sortOrder: 8 },
  { category: 'oil',        label: 'Niveau liquide refroid.',sortOrder: 9 },
  { category: 'suspension', label: 'Amortisseurs AV',       sortOrder: 10 },
  { category: 'suspension', label: 'Amortisseurs AR',       sortOrder: 11 },
  { category: 'body',       label: 'Carrosserie',           sortOrder: 12 },
  { category: 'body',       label: 'Pare-brise',            sortOrder: 13 },
  { category: 'battery',    label: 'Batterie',              sortOrder: 14 },
  { category: 'belts',      label: 'Courroie distribution', sortOrder: 15 },
  { category: 'filters',    label: 'Filtre à air',          sortOrder: 16 },
  { category: 'filters',    label: 'Filtre habitacle',      sortOrder: 17 },
]
