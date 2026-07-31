export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { savePhoto, deletePhoto, parsePhotoDataUrl } from '@/lib/photo-store'

// GET /api/jobs/[id]/photos
export const GET = withAuth(async (_req, { params }) => {
  const session = await requireSession()
  const photos = await prisma.jobPhoto.findMany({
    where: { jobId: params.id, garageId: session.user.garageId },
    orderBy: [{ phase: 'asc' }, { createdAt: 'asc' }],
  })
  return NextResponse.json(photos)
})

// POST /api/jobs/[id]/photos
export const POST = withAuth(async (req, { params }) => {
  const session = await requireSession()
  const body = await req.json()

  const job = await prisma.job.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
  })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  // SÉCURITÉ (DoS/validation) : la photo, si fournie, doit être une data URL
  // d'image en liste blanche et ≤ MAX_PHOTO_BYTES. On rejette AVANT tout
  // stockage (disque OU repli base64 en base) pour éviter l'abus de stockage.
  if (body.base64 !== undefined && body.base64 !== null && body.base64 !== '') {
    if (!parsePhotoDataUrl(body.base64)) {
      return NextResponse.json(
        { error: 'Image invalide ou trop volumineuse (formats: JPEG/PNG/WebP/GIF, max 8 Mo).' },
        { status: 413 },
      )
    }
  }

  // Try to write to disk; fall back to base64 in DB if disk write fails
  let photoPath: string | null = null
  if (body.base64) {
    try { photoPath = savePhoto(body.base64, `jobs/${params.id}`) } catch (_) { photoPath = null }
  }

  const photo = await prisma.jobPhoto.create({
    data: {
      jobId:     params.id,
      garageId:  session.user.garageId,
      phase:     body.phase ?? 'before',
      caption:   body.caption ?? null,
      base64:    photoPath ? '' : (body.base64 ?? ''),  // empty when file is stored
      photoPath,
    },
  })
  return NextResponse.json(photo, { status: 201 })
})

// DELETE /api/jobs/[id]/photos?photoId=xxx
export const DELETE = withAuth(async (req, { params }) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const photoId = searchParams.get('photoId')
  if (!photoId) return NextResponse.json({ error: 'photoId required' }, { status: 400 })

  // Fetch before deleting so we can clean up the file
  const photo = await prisma.jobPhoto.findFirst({
    where: { id: photoId, garageId: session.user.garageId },
  })

  await prisma.jobPhoto.deleteMany({
    where: { id: photoId, garageId: session.user.garageId },
  })

  if (photo?.photoPath) deletePhoto(photo.photoPath)

  return NextResponse.json({ success: true })
})
