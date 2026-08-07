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

  // IMMUTABILITÉ DE LA SIGNATURE : un OR déjà scellé ne peut PAS être re-signé
  // (écraser la signature détruirait la preuve/audit SAV). Contrôle-puis-action
  // ATOMIQUE via updateMany conditionnel : seule une ligne encore NON signée
  // (signedAt = null) est mise à jour — deux requêtes concurrentes ne peuvent
  // pas sceller deux signatures différentes (anti-TOCTOU).
  const sealed = await prisma.workOrder.updateMany({
    where: { id: params.id, garageId: session.user.garageId, signedAt: null },
    data: { signatureData: body.signatureData, signedAt: new Date(), status: 'signed' },
  })
  if (sealed.count === 0) {
    // Soit l'OR n'existe pas / autre garage (404), soit il est déjà signé (409).
    const existing = await prisma.workOrder.findFirst({
      where: { id: params.id, garageId: session.user.garageId },
      select: { signedAt: true },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ error: 'Ordre de réparation déjà signé — signature scellée, non remplaçable.' }, { status: 409 })
  }

  const wo = await prisma.workOrder.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    include: { mechanic: { select: { id: true, name: true, color: true } } },
  })
  return NextResponse.json(wo)
})
