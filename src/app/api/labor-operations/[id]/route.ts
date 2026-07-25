export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'

// GET /api/labor-operations/[id]
export const GET = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const operation = await prisma.laborOperation.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
  })
  if (!operation) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
  return NextResponse.json(operation)
})

// PATCH /api/labor-operations/[id]
export const PATCH = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const existing = await prisma.laborOperation.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
  })
  if (!existing) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  const body = await req.json()

  // Validate if provided
  if (body.name !== undefined && !String(body.name).trim()) {
    return NextResponse.json({ error: 'Le nom est requis' }, { status: 400 })
  }
  if (body.durationMin !== undefined && Number(body.durationMin) < 1) {
    return NextResponse.json({ error: 'La durée doit être d\'au moins 1 minute' }, { status: 400 })
  }
  if (body.unitPrice !== undefined && Number(body.unitPrice) < 0) {
    return NextResponse.json({ error: 'Le prix ne peut pas être négatif' }, { status: 400 })
  }

  const data: Record<string, unknown> = {}
  if (body.name !== undefined)        data.name        = String(body.name).trim()
  if (body.category !== undefined)    data.category    = body.category || null
  if (body.durationMin !== undefined) data.durationMin = Number(body.durationMin)
  if (body.unitPrice !== undefined)   data.unitPrice   = Number(body.unitPrice)
  if (body.description !== undefined) data.description = body.description || null
  if (body.isActive !== undefined)    data.isActive    = Boolean(body.isActive)

  const updated = await prisma.laborOperation.update({
    where: { id: params.id, garageId: session.user.garageId },
    data,
  })
  return NextResponse.json(updated)
})

// DELETE /api/labor-operations/[id]
export const DELETE = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const existing = await prisma.laborOperation.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
  })
  if (!existing) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  await prisma.laborOperation.delete({
    where: { id: params.id, garageId: session.user.garageId },
  })
  return NextResponse.json({ success: true })
})
