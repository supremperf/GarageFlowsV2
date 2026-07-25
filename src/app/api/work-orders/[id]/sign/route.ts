export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'

// POST /api/work-orders/[id]/sign
export const POST = withAuth(async (req, { params }) => {
  const session = await requireSession()
  const body = await req.json()

  if (!body.signatureData || typeof body.signatureData !== 'string') {
    return NextResponse.json({ error: 'signatureData requis (base64 PNG)' }, { status: 400 })
  }

  const existing = await prisma.workOrder.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const wo = await prisma.workOrder.update({
    where: { id: params.id },
    data: {
      signatureData: body.signatureData,
      signedAt: new Date(),
      status: 'signed',
    },
    include: {
      mechanic: { select: { id: true, name: true, color: true } },
    },
  })

  return NextResponse.json(wo)
})
