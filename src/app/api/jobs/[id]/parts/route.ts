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

  // Validate quantity: a positive finite number. Previously a negative value
  // (e.g. -50) inverted the stock decrement, ADDING inventory.
  const qty = Number(quantity)
  if (!Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json({ error: 'Quantité invalide (doit être > 0)' }, { status: 400 })
  }

  const part = await prisma.part.findFirst({ where: { id: partId, garageId: session.user.garageId } })
  if (!part) return NextResponse.json({ error: 'Pièce introuvable' }, { status: 404 })

  // Upsert the job-part line AND decrement stock atomically. The quantity added
  // to the job must always equal the quantity removed from stock — both the
  // "already on job" and "new line" branches now decrement, inside one
  // transaction so a partial failure can never desync inventory.
  const existing = await prisma.jobPart.findFirst({ where: { jobId: params.id, partId } })

  const result = await prisma.$transaction(async (tx) => {
    let line
    if (existing) {
      line = await tx.jobPart.update({
        where: { id: existing.id },
        data: { quantity: existing.quantity + qty },
        include: { part: true },
      })
    } else {
      line = await tx.jobPart.create({
        data: {
          jobId: params.id,
          partId,
          quantity: qty,
          unitPrice: part.unitPrice,
          unitCost: part.unitCost,
        },
        include: { part: true },
      })
    }
    await tx.part.update({
      where: { id: partId },
      data: { quantity: { decrement: qty } },
    })
    return line
  })

  return NextResponse.json(result, { status: existing ? 200 : 201 })
})

// DELETE /api/jobs/:id/parts  body: { jobPartId }
export const DELETE = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const { jobPartId } = await req.json()

  const jobPart = await prisma.jobPart.findFirst({
    where: { id: jobPartId, job: { garageId: session.user.garageId } },
  })
  if (!jobPart) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  // Restore stock and remove the line atomically.
  await prisma.$transaction([
    prisma.part.update({
      where: { id: jobPart.partId },
      data: { quantity: { increment: jobPart.quantity } },
    }),
    prisma.jobPart.delete({ where: { id: jobPartId } }),
  ])
  return NextResponse.json({ success: true })
})
