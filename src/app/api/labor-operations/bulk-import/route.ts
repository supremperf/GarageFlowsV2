export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { toScaled } from '@/lib/money'

// POST /api/labor-operations/bulk-import
// Body: { operations: [{ name, category, durationMin, unitPrice }] }
const MAX_OPERATIONS = 500 // borne anti-DoS : une transaction de N inserts par requête

export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const body = await req.json()

  const ops: Array<{ name: string; category?: string; durationMin: number; unitPrice: number; description?: string }> =
    Array.isArray(body.operations) ? body.operations : []

  if (ops.length === 0) {
    return NextResponse.json({ error: 'Aucune opération fournie' }, { status: 400 })
  }
  // Borne supérieure : un tableau non borné construirait une transaction géante
  // (mémoire + verrous DB longs) → déni de service. On refuse au-delà du plafond.
  if (ops.length > MAX_OPERATIONS) {
    return NextResponse.json(
      { error: `Trop d'opérations (${ops.length}). Maximum ${MAX_OPERATIONS} par import.` },
      { status: 400 },
    )
  }

  // Validate all entries before inserting
  for (const op of ops) {
    if (!op.name?.trim()) {
      return NextResponse.json({ error: 'Chaque opération doit avoir un nom' }, { status: 400 })
    }
    if (Number(op.durationMin) < 1) {
      return NextResponse.json({ error: `Durée invalide pour "${op.name}"` }, { status: 400 })
    }
    if (Number(op.unitPrice) < 0) {
      return NextResponse.json({ error: `Prix invalide pour "${op.name}"` }, { status: 400 })
    }
  }

  const created = await prisma.$transaction(
    ops.map(op =>
      prisma.laborOperation.create({
        data: {
          name: op.name.trim(),
          category: op.category || null,
          durationMin: Number(op.durationMin),
          unitPriceTenThousandths: toScaled(Number(op.unitPrice)), // € -> dix-milliemes exacts
          description: op.description || null,
          isActive: true,
          garageId: session.user.garageId,
        },
      })
    )
  )

  return NextResponse.json({ created: created.length, operations: created }, { status: 201 })
})
