export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { fromScaled } from '@/lib/money'
import { rankParts } from '@/lib/stock/search'

/**
 * GET /api/parts/search?q=fil&limit=20
 *
 * Autocomplétion des pièces pour les lignes de devis/facture.
 *
 * ISOLATION — la requête est TOUJOURS bornée au `garageId` de la session. Aucun
 * paramètre client ne peut élargir le périmètre : une pièce d'un autre garage
 * n'est jamais proposée, même en connaissant son identifiant.
 *
 * PERFORMANCE — le classement (insensible casse/accents) se fait en mémoire sur
 * un jeu BORNÉ de colonnes et de lignes (`SCAN_CAP`). Pour un catalogue de
 * garage (quelques centaines à quelques milliers de références) c'est immédiat,
 * et la réponse renvoyée à l'interface est limitée à `limit` suggestions : on ne
 * déverse jamais le catalogue dans le navigateur.
 */

/** Nombre maximal de références balayées côté serveur (garde-fou mémoire). */
const SCAN_CAP = 5000
/** Nombre maximal de suggestions renvoyées à l'interface. */
const MAX_SUGGESTIONS = 25

export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)

  const q = (searchParams.get('q') ?? '').slice(0, 100)
  const limitParam = Number(searchParams.get('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(Math.floor(limitParam), MAX_SUGGESTIONS)
    : 10

  // Requête vide : on ne renvoie rien plutôt que tout le catalogue — la liste
  // déroulante ne s'ouvre qu'à partir du premier caractère saisi.
  if (q.trim().length === 0) return NextResponse.json({ data: [] })

  const parts = await prisma.part.findMany({
    where: { garageId: session.user.garageId },
    select: {
      id: true,
      name: true,
      reference: true,
      supplierRef: true,
      supplierName: true,
      description: true,
      quantity: true,
      minQuantity: true,
      location: true,
      unitPriceTenThousandths: true,
      unitCostTenThousandths: true,
    },
    orderBy: { name: 'asc' },
    take: SCAN_CAP,
  })

  const ranked = rankParts(parts, q, limit)

  // La suggestion porte TOUT ce qu'il faut pour éviter une erreur de saisie :
  // quelle pièce, combien il en reste, à quel prix — et l'identifiant interne
  // qui rendra la synchronisation du stock fiable.
  return NextResponse.json({
    data: ranked.map((p) => ({
      ...p,
      unitPrice: fromScaled(p.unitPriceTenThousandths),
      unitCost: fromScaled(p.unitCostTenThousandths),
      lowStock: p.quantity <= p.minQuantity,
    })),
    query: q,
    truncated: parts.length === SCAN_CAP,
  })
})
