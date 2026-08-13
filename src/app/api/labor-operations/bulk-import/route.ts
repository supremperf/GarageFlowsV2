export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { parseAmountToScaled } from '@/lib/money'

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
    // `Number('abc')` vaut NaN, et toute comparaison avec NaN est FAUSSE : la
    // garde `< 1` / `< 0` laissait donc passer n'importe quelle saisie non
    // numérique, que `toScaled(NaN)` enregistrait ensuite à **0 €** — repli
    // défensif légitime dans la couche monétaire, catastrophique ici. Tout le
    // barème main-d'œuvre importé partait à zéro, l'API confirmant un succès
    // (GF31-AUD-050).
    const duree = Number(op.durationMin)
    if (!Number.isFinite(duree) || duree < 1) {
      return NextResponse.json({ error: `Durée invalide pour "${op.name}"` }, { status: 400 })
    }
    // `parseAmountToScaled` est le seul parseur BORNÉ du projet : il refuse le
    // non-numérique, la notation exponentielle, les décimales en trop, le
    // négatif, et le dépassement du domaine des colonnes Int 32 bits.
    if (parseAmountToScaled(op.unitPrice as string | number, { allowNegative: false }) === null) {
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
          // Déjà validé ci-dessus : la valeur est finie, positive et bornée.
          unitPriceTenThousandths: parseAmountToScaled(op.unitPrice as string | number, { allowNegative: false }) as number,
          description: op.description || null,
          isActive: true,
          garageId: session.user.garageId,
        },
      })
    )
  )

  return NextResponse.json({ created: created.length, operations: created }, { status: 201 })
})
