export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'

// GET /api/jobs/:id/parts
export const GET = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const job = await prisma.job.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!job) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  const parts = await prisma.jobPart.findMany({
    where: { jobId: params.id },
    include: { part: true },
  })
  return NextResponse.json(parts)
})

// POST /api/jobs/:id/parts — add a part to the job
export const POST = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const job = await prisma.job.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!job) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  const { partId, quantity = 1 } = await req.json()
  if (!partId) return NextResponse.json({ error: 'partId requis' }, { status: 400 })

  const part = await prisma.part.findFirst({ where: { id: partId, garageId: session.user.garageId } })
  if (!part) return NextResponse.json({ error: 'Pièce introuvable' }, { status: 404 })

  // Upsert: if already in job, increase quantity
  const existing = await prisma.jobPart.findFirst({ where: { jobId: params.id, partId } })
  if (existing) {
    const updated = await prisma.jobPart.update({
      where: { id: existing.id },
      data: { quantity: existing.quantity + Number(quantity) },
      include: { part: true },
    })
    return NextResponse.json(updated)
  }

  const jobPart = await prisma.jobPart.create({
    data: {
      jobId: params.id,
      partId,
      quantity: Number(quantity),
      unitPrice: part.unitPrice,
      unitCost: part.unitCost,
    },
    include: { part: true },
  })

  // Deduct from stock
  await prisma.part.update({
    where: { id: partId },
    data: { quantity: { decrement: Number(quantity) } },
  })

  return NextResponse.json(jobPart, { status: 201 })
})

// DELETE /api/jobs/:id/parts  body: { jobPartId }
export const DELETE = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const { jobPartId } = await req.json()

  const jobPart = await prisma.jobPart.findFirst({
    where: { id: jobPartId, job: { garageId: session.user.garageId } },
  })
  if (!jobPart) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  // Restore stock
  await prisma.part.update({
    where: { id: jobPart.partId },
    data: { quantity: { increment: jobPart.quantity } },
  })

  await prisma.jobPart.delete({ where: { id: jobPartId } })
  return NextResponse.json({ success: true })
})
