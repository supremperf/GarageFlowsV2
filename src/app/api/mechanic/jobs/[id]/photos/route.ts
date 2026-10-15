export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireMechanic, withMechanic, findAssignedJob, logMechanicAction } from '@/lib/mechanic-api'
import { savePhoto } from '@/lib/photo-store'
import { validateMechanicPhoto, MECHANIC_PHOTO_MAX_PER_JOB } from '@/lib/mechanic-photo'

const ALLOWED_PHASES = new Set(['before', 'during', 'after'])

// POST /api/mechanic/jobs/[id]/photos  { base64, phase?, caption? }
// APPEND-ONLY : le mécanicien ajoute une photo à SON intervention. Il ne peut
// ni modifier ni supprimer une photo (aucun PUT/DELETE ici).
export const POST = withMechanic(async (req, { params }: { params: { id: string } }) => {
  const ctx = await requireMechanic()

  const job = await findAssignedJob(ctx, params.id)
  if (!job) return NextResponse.json({ error: 'Intervention non accessible.' }, { status: 404 })

  let body: { base64?: unknown; phase?: unknown; caption?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })
  }

  // Validation stricte du contenu image (type réel + taille + empreinte).
  const valid = validateMechanicPhoto(body.base64)
  if (!valid.ok) return NextResponse.json({ error: valid.reason }, { status: 400 })

  // §7 — Plafond du nombre de photos par intervention (anti-abus/stockage).
  const existing = await prisma.jobPhoto.count({ where: { jobId: job.id, garageId: ctx.garageId } })
  if (existing >= MECHANIC_PHOTO_MAX_PER_JOB) {
    return NextResponse.json(
      { error: `Nombre maximal de photos atteint pour cette intervention (${MECHANIC_PHOTO_MAX_PER_JOB}).` },
      { status: 403 },
    )
  }

  const phase = typeof body.phase === 'string' && ALLOWED_PHASES.has(body.phase) ? body.phase : 'during'
  const caption = typeof body.caption === 'string' ? body.caption.slice(0, 500) : null

  // Nom de fichier généré côté serveur (jamais fourni par le client).
  let photoPath: string | null = null
  try {
    photoPath = savePhoto(String(body.base64), `jobs/${job.id}`)
  } catch {
    photoPath = null
  }

  const photo = await prisma.jobPhoto.create({
    data: {
      jobId: job.id,
      garageId: ctx.garageId,      // de confiance (session), pas du client
      mechanicId: ctx.mechanicId,  // traçabilité auteur
      phase,
      caption,
      base64: photoPath ? '' : String(body.base64),
      photoPath,
    },
    select: { id: true, phase: true, caption: true, photoPath: true, mechanicId: true, createdAt: true },
  })

  await logMechanicAction({ ctx, action: 'photo_added', jobId: job.id, targetType: 'JobPhoto', targetId: photo.id, metadata: { phase, mime: valid.mime, bytes: valid.bytes, hash: valid.hash } })

  return NextResponse.json(photo, { status: 201 })
})
