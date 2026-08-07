export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { checkStatusTransition, isDeletable } from '@/lib/document-status'

export const GET = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const w = await prisma.warranty.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!w) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(w)
})

export const PATCH = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const existing = await prisma.warranty.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await req.json()

  // Machine à états : whitelist + « claimed » terminal. On ne peut pas dé-réclamer
  // une garantie via PATCH pour ensuite la supprimer (contournement du verrou).
  if (body.status !== undefined) {
    const transitionError = checkStatusTransition('warranty', existing.status, String(body.status))
    if (transitionError) return NextResponse.json({ error: transitionError }, { status: 409 })
  }

  const data: Record<string, unknown> = {}
  if (body.status !== undefined)      data.status     = body.status
  if (body.claimNotes !== undefined)  data.claimNotes = body.claimNotes
  if (body.notes !== undefined)       data.notes      = body.notes
  if (body.status === 'claimed' && !existing.claimedAt) data.claimedAt = new Date()
  const updated = await prisma.warranty.update({ where: { id: params.id, garageId: session.user.garageId }, data })
  return NextResponse.json(updated)
})

export const DELETE = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const existing = await prisma.warranty.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Verrou basé sur claimedAt (vérité durable) en plus du statut : une garantie
  // réclamée n'est jamais supprimable, même si son statut avait été altéré.
  if (!isDeletable('warranty', existing.status, { claimed: existing.claimedAt != null })) {
    return NextResponse.json({ error: 'Impossible de supprimer une garantie réclamée' }, { status: 400 })
  }
  await prisma.warranty.delete({ where: { id: params.id, garageId: session.user.garageId } })
  return NextResponse.json({ success: true })
})
