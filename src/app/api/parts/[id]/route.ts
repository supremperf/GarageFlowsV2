export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { parseAmountToScaled } from '@/lib/money'
import { partToEuros } from '@/lib/money-db'
import { UpdatePartSchema } from '@/lib/schemas'

// PATCH /api/parts/:id
export const PATCH = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const existing = await prisma.part.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!existing) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  // Mêmes garde-fous qu'à la création : sans schéma, une modification pouvait
  // remettre le stock à une valeur négative ou glisser un prix à 6 décimales
  // silencieusement arrondi — la création était contrôlée, pas la mise à jour.
  const parsed = UpdatePartSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Pièce invalide', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const body = parsed.data
  const allowed = ['name', 'reference', 'description', 'quantity', 'minQuantity', 'location'] as const
  const data: Record<string, unknown> = {}
  for (const f of allowed) { if (body[f] !== undefined) data[f] = body[f] }
  // Saisie en euros → entiers exacts (dix-millièmes) : unique source de vérité.
  // Conversion STRICTE : le schéma a déjà borné les décimales.
  for (const [champ, colonne] of [['unitCost', 'unitCostTenThousandths'], ['unitPrice', 'unitPriceTenThousandths']] as const) {
    const v = body[champ]
    if (v === undefined) continue
    const scaled = parseAmountToScaled(v)
    if (scaled === null) {
      return NextResponse.json({ error: 'Montant invalide', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    data[colonne] = scaled
  }

  const updated = await prisma.part.update({ where: { id: params.id, garageId: session.user.garageId }, data })
  return NextResponse.json(partToEuros(updated))
})

// DELETE /api/parts/:id
export const DELETE = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  // Contrôle de propriété AVANT suppression : renvoie un 404 propre et uniforme
  // (comme les autres ressources) au lieu d'un P2025 non typé pour une pièce
  // d'un autre garage. La portée garageId reste dans le where du delete.
  const existing = await prisma.part.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!existing) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
  await prisma.part.delete({ where: { id: params.id, garageId: session.user.garageId } })
  return NextResponse.json({ success: true })
})
