export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession, MAX_PHOTO_BASE64_LENGTH, ALLOWED_IMAGE_MIME } from '@/lib/api-helpers'
import { savePhoto, deletePhoto } from '@/lib/photo-store'

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

  // ── Garde-fous d'upload (DoS disque/BD + type de contenu) ──────────────────
  const b64 = typeof body.base64 === 'string' ? body.base64 : ''
  if (b64.length > MAX_PHOTO_BASE64_LENGTH) {
    return NextResponse.json(
      { error: 'Image trop volumineuse.', code: 'PAYLOAD_TOO_LARGE' },
      { status: 413 },
    )
  }
  // Si une donnée data-URL est fournie, elle DOIT être une image d'un type autorisé.
  const mime = b64.match(/^data:([^;,]+)[;,]/)?.[1]
  if (mime && !ALLOWED_IMAGE_MIME.test(mime)) {
    return NextResponse.json(
      { error: 'Type de fichier non autorisé (image attendue).', code: 'UNSUPPORTED_MEDIA_TYPE' },
      { status: 415 },
    )
  }

  const job = await prisma.job.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
  })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  // Try to write to disk; fall back to base64 in DB if disk write fails
  let photoPath: string | null = null
  if (b64) {
    try { photoPath = savePhoto(b64, `jobs/${params.id}`) } catch (_) { photoPath = null }
  }

  const photo = await prisma.jobPhoto.create({
    data: {
      jobId:     params.id,
      garageId:  session.user.garageId,
      phase:     body.phase ?? 'before',
      caption:   body.caption ?? null,
      base64:    photoPath ? '' : b64,  // empty when file is stored
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
