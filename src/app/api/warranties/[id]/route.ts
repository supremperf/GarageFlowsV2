export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'

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
  const data: Record<string, unknown> = {}
  if (body.status !== undefined)      data.status     = body.status
  if (body.claimNotes !== undefined)  data.claimNotes = body.claimNotes
  if (body.notes !== undefined)       data.notes      = body.notes
  if (body.status === 'claimed' && !existing.claimedAt) data.claimedAt = new Date()
  const updated = await prisma.warranty.update({ where: { id: params.id }, data })
  return NextResponse.json(updated)
})

export const DELETE = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const existing = await prisma.warranty.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status === 'claimed') return NextResponse.json({ error: 'Impossible de supprimer une garantie réclamée' }, { status: 400 })
  await prisma.warranty.delete({ where: { id: params.id } })
  return NextResponse.json({ success: true })
})
