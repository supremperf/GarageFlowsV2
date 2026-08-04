export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireMechanic, withMechanic, findAssignedJob, logMechanicAction } from '@/lib/mechanic-api'

const ALLOWED_TYPES = new Set(['comment', 'note', 'observation', 'issue'])
const ACTION_BY_TYPE: Record<string, string> = {
  comment: 'comment_added',
  note: 'note_added',
  observation: 'observation_added',
  issue: 'issue_reported',
}

// POST /api/mechanic/jobs/[id]/notes  { type, body }
// APPEND-ONLY : commentaire / note / observation / signalement sur SON
// intervention. Aucune modification ni suppression possible.
export const POST = withMechanic(async (req, { params }: { params: { id: string } }) => {
  const ctx = await requireMechanic()

  const job = await findAssignedJob(ctx, params.id)
  if (!job) return NextResponse.json({ error: 'Intervention non accessible.' }, { status: 404 })

  let payload: { type?: unknown; body?: unknown }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })
  }

  const type = typeof payload.type === 'string' && ALLOWED_TYPES.has(payload.type) ? payload.type : null
  const text = typeof payload.body === 'string' ? payload.body.trim() : ''
  if (!type) return NextResponse.json({ error: 'Type de note invalide.' }, { status: 400 })
  if (!text) return NextResponse.json({ error: 'Le contenu est obligatoire.' }, { status: 400 })
  if (text.length > 4000) return NextResponse.json({ error: 'Contenu trop long (max 4000 caractères).' }, { status: 400 })

  // §7 — Re-vérifier la propriété AU MOMENT de l'écriture (transaction) : si
  // l'intervention a été réattribuée entre le contrôle et l'insertion, le
  // mécanicien tout juste dessaisi ne peut plus y ajouter de note (409).
  const note = await prisma.$transaction(async (tx) => {
    const still = await tx.job.findFirst({
      where: { id: job.id, garageId: ctx.garageId, mechanicId: ctx.mechanicId },
      select: { id: true },
    })
    if (!still) throw NextResponse.json({ error: 'Intervention non accessible.' }, { status: 409 })
    return tx.jobMechanicNote.create({
      data: {
        jobId: job.id,
        garageId: ctx.garageId,
        mechanicId: ctx.mechanicId,
        licenseId: ctx.licenseId,
        type,
        body: text,
      },
      select: { id: true, type: true, body: true, mechanicId: true, createdAt: true },
    })
  })

  await logMechanicAction({ ctx, action: ACTION_BY_TYPE[type], jobId: job.id, targetType: 'JobMechanicNote', targetId: note.id })

  return NextResponse.json(note, { status: 201 })
})
