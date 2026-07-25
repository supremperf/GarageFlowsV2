export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { savePhoto } from '@/lib/photo-store'

// GET /api/inspections/[id]
export const GET = withAuth(async (_req, { params }) => {
  const session = await requireSession()
  const inspection = await prisma.inspection.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!inspection) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(inspection)
})

// PATCH /api/inspections/[id] — update inspection + items
export const PATCH = withAuth(async (req, { params }) => {
  const session = await requireSession()
  const body = await req.json()

  // Verify ownership
  const existing = await prisma.inspection.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Update individual item if itemId provided
  if (body.itemId !== undefined) {
    const item = await prisma.inspectionItem.update({
      where: { id: body.itemId },
      data: {
        ...(body.status !== undefined && { status: body.status }),
        ...(body.notes !== undefined && { notes: body.notes }),
        ...(body.photoBase64 !== undefined && (() => {
          const photoPath = body.photoBase64
            ? savePhoto(body.photoBase64, `inspections/${params.id}`)
            : null
          return photoPath
            ? { photoBase64: null, photoPath }
            : { photoBase64: body.photoBase64 || null }
        })()),
      },
    })
    return NextResponse.json(item)
  }

  // Full inspection update
  const inspection = await prisma.inspection.update({
    where: { id: params.id, garageId: session.user.garageId },
    data: {
      ...(body.status !== undefined && { status: body.status }),
      ...(body.notes !== undefined && { notes: body.notes }),
      ...(body.mileage !== undefined && { mileage: body.mileage ? parseInt(body.mileage) : null }),
      ...(body.clientName !== undefined && { clientName: body.clientName }),
      ...(body.vehicleModel !== undefined && { vehicleModel: body.vehicleModel }),
      ...(body.licensePlate !== undefined && { licensePlate: body.licensePlate }),
    },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  })
  return NextResponse.json(inspection)
})

// DELETE /api/inspections/[id]
export const DELETE = withAuth(async (_req, { params }) => {
  const session = await requireSession()
  await prisma.inspection.delete({ where: { id: params.id, garageId: session.user.garageId } })
  return NextResponse.json({ success: true })
})
