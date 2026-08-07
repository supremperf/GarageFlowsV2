export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { purchaseOrderToEuros } from '@/lib/money-db'
import { checkStatusTransition } from '@/lib/document-status'

export const GET = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const order = await prisma.purchaseOrder.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(purchaseOrderToEuros(order))
})

export const PATCH = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const existing = await prisma.purchaseOrder.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await req.json()

  // Machine à états : whitelist + interdictions dures. « received » n'est pas
  // atteignable ici (réception = POST /receive, qui gère le stock atomiquement),
  // et un BC réceptionné/annulé est terminal → pas de ré-inflation du stock ni de
  // contournement du verrou de suppression par rétrogradation de statut.
  if (body.status !== undefined) {
    const transitionError = checkStatusTransition('purchaseOrder', existing.status, String(body.status))
    if (transitionError) return NextResponse.json({ error: transitionError }, { status: 409 })
  }

  const data: Record<string, unknown> = {}
  if (body.status !== undefined)        data.status        = body.status
  if (body.supplierName !== undefined)  data.supplierName  = body.supplierName
  if (body.supplierEmail !== undefined) data.supplierEmail = body.supplierEmail
  if (body.notes !== undefined)         data.notes         = body.notes
  if (body.status === 'sent' && !existing.sentAt)         data.sentAt = new Date()
  const updated = await prisma.purchaseOrder.update({ where: { id: params.id, garageId: session.user.garageId }, data })
  return NextResponse.json(purchaseOrderToEuros(updated))
})

export const DELETE = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const existing = await prisma.purchaseOrder.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status !== 'draft') return NextResponse.json({ error: 'Seuls les brouillons peuvent être supprimés' }, { status: 400 })
  await prisma.purchaseOrder.delete({ where: { id: params.id, garageId: session.user.garageId } })
  return NextResponse.json({ success: true })
})
