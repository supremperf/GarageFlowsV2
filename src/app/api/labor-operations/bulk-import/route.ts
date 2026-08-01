export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'

// POST /api/labor-operations/bulk-import
// Body: { operations: [{ name, category, durationMin, unitPrice }] }
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const body = await req.json()

  const ops: Array<{ name: string; category?: string; durationMin: number; unitPrice: number; description?: string }> =
    Array.isArray(body.operations) ? body.operations : []

  if (ops.length === 0) {
    return NextResponse.json({ error: 'Aucune opération fournie' }, { status: 400 })
  }
  // Anti-DoS : borne dure sur la taille du lot (transaction de N créations).
  const MAX_BULK = 1000
  if (ops.length > MAX_BULK) {
    return NextResponse.json({ error: `Trop d'opérations (max ${MAX_BULK}).` }, { status: 413 })
  }

  // Validate all entries before inserting.
  // IMPORTANT : Number(x) peut valoir NaN (chaîne non numérique / champ manquant),
  // et `NaN < 1` === false — l'ancienne garde était donc contournable et
  // persistait des NaN. On exige des nombres FINIS et bornés.
  for (const op of ops) {
    if (!op.name?.trim()) {
      return NextResponse.json({ error: 'Chaque opération doit avoir un nom' }, { status: 400 })
    }
    const durationMin = Number(op.durationMin)
    if (!Number.isFinite(durationMin) || durationMin < 1 || durationMin > 100_000) {
      return NextResponse.json({ error: `Durée invalide pour "${op.name}"` }, { status: 400 })
    }
    const unitPrice = Number(op.unitPrice)
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1_000_000) {
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
          unitPrice: Number(op.unitPrice),
          description: op.description || null,
          isActive: true,
          garageId: session.user.garageId,
        },
      })
    )
  )

  return NextResponse.json({ created: created.length, operations: created }, { status: 201 })
})
