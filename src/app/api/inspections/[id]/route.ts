export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { savePhoto, deletePhoto } from '@/lib/photo-store'

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

  // Update individual item if itemId provided.
  // SECURITY (IDOR): the item MUST belong to THIS inspection (already verified to
  // belong to the caller's garage). Never trust body.itemId on its own — otherwise
  // any item of any garage could be overwritten. Atomic scope via updateMany.
  if (body.itemId !== undefined) {
    const data: Record<string, unknown> = {}
    if (body.status !== undefined) data.status = body.status
    if (body.notes !== undefined) data.notes = body.notes
    if (body.photoBase64 !== undefined) {
      // ── Les DEUX colonnes sont écrites, dans les deux branches (GF-026) ────
      // Retirer une photo posait `photoBase64 = null` et laissait `photoPath`
      // intact. Or la lecture donne la PRIORITÉ au fichier
      // (`item.photoPath ? /api/photos/… : item.photoBase64`) : la photo
      // réapparaissait au rechargement de l'inspection, et le fichier restait
      // sur le disque. Le garage la « supprimait » sans effet, indéfiniment.
      const ancienChemin = body.photoBase64
        ? null
        : (await prisma.inspectionItem.findFirst({
            where: { id: body.itemId, inspectionId: params.id }, select: { photoPath: true },
          }))?.photoPath ?? null

      const photoPath = body.photoBase64 ? savePhoto(body.photoBase64, `inspections/${params.id}`) : null
      if (photoPath) {
        data.photoBase64 = null
        data.photoPath = photoPath
      } else {
        data.photoBase64 = body.photoBase64 || null
        // Suppression explicite : le chemin doit tomber avec le contenu.
        if (!body.photoBase64) data.photoPath = null
      }
      // Le fichier n'est retiré qu'après l'écriture réussie, plus bas.
      if (ancienChemin) data.__ancienChemin = ancienChemin
    }
    const ancienChemin = typeof data.__ancienChemin === 'string' ? data.__ancienChemin : null
    delete data.__ancienChemin
    const res = await prisma.inspectionItem.updateMany({
      where: { id: body.itemId, inspectionId: params.id },
      data,
    })
    if (res.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // La base ne référence plus le fichier : on peut le retirer du disque.
    if (ancienChemin) deletePhoto(ancienChemin)
    const item = await prisma.inspectionItem.findFirst({ where: { id: body.itemId, inspectionId: params.id } })
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
