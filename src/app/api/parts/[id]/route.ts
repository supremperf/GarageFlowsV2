export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { parseAmountToScaled } from '@/lib/money'
import { partToEuros } from '@/lib/money-db'
import { UpdatePartSchema } from '@/lib/schemas'
import { MOVEMENT } from '@/lib/stock/invoice-stock'

// PATCH /api/parts/:id
export const PATCH = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  // La matrice réserve `stock:manage` à MANAGER/OWNER, mais AUCUNE route ne
  // l'appliquait : un RECEPTIONIST modifiait stock et prix de vente. Même
  // correction que pour les factures (GF31-AUD-009) — la matrice décide.
  if (!can(session.user.role, 'stock:manage')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
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
  // `supplierName` / `supplierRef` are editable descriptive metadata. They do
  // not feed a live provider or generate a fabricated supplier quote.
  const allowed = ['name', 'reference', 'description', 'minQuantity', 'location', 'supplierName', 'supplierRef'] as const
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

  // ── QUANTITÉ : correction d'inventaire, pas une écriture comme une autre ────
  //
  // `quantity` était posé en valeur ABSOLUE par un `update` nu. Deux défauts :
  //
  //  1. Mise à jour perdue. L'écran envoie la valeur qu'il AFFICHE ; si une
  //     facture a décrémenté la pièce entre l'affichage et l'envoi, la vente est
  //     réintroduite en stock (10 affiché, on corrige à 12, une facture sort 3 →
  //     on attend 9, on obtient 12).
  //  2. Aucune traçabilité. Le moteur de facturation écrit un `StockMovement`
  //     pour chaque unité qui bouge (§45), et `DELETE` refuse d'effacer une
  //     pièce mouvementée pour préserver ce journal — mais la correction
  //     manuelle, elle, ne laissait rien. L'origine d'un écart devenait
  //     irreconstituable.
  //
  // La correction est donc conditionnée à la quantité OBSERVÉE (`expectedQuantity`)
  // et écrit son mouvement ADJUST dans la même transaction.
  if (body.quantity !== undefined) {
    if (body.expectedQuantity === undefined) {
      return NextResponse.json(
        {
          error: 'Correction de stock : la quantité observée (expectedQuantity) est requise.',
          code: 'EXPECTED_QUANTITY_REQUIRED',
        },
        { status: 400 },
      )
    }
    const cible = body.quantity
    const observee = body.expectedQuantity
    const delta = cible - observee

    const resultat = await prisma.$transaction(async (tx) => {
      // Écriture CONDITIONNÉE : si la quantité a bougé depuis la lecture, 0 ligne
      // touchée — on ne réécrit rien par-dessus le travail d'un autre.
      const maj = await tx.part.updateMany({
        where: { id: params.id, garageId: session.user.garageId, quantity: observee },
        data: { ...data, quantity: cible },
      })
      if (maj.count !== 1) return null
      if (delta !== 0) {
        await tx.stockMovement.create({
          data: {
            garageId: session.user.garageId,
            partId: params.id,
            type: MOVEMENT.ADJUST,
            quantityDelta: delta,
            reason: `Correction d'inventaire (${observee} → ${cible})`,
          },
        })
      }
      return tx.part.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
    })

    if (!resultat) {
      const actuelle = await prisma.part.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
      return NextResponse.json(
        {
          error: `Le stock a changé depuis l'affichage (${observee} → ${actuelle?.quantity ?? '?'}). Rechargez avant de corriger.`,
          code: 'STOCK_CONFLICT',
          currentQuantity: actuelle?.quantity ?? null,
        },
        { status: 409 },
      )
    }
    return NextResponse.json(partToEuros(resultat))
  }

  const updated = await prisma.part.update({ where: { id: params.id, garageId: session.user.garageId }, data })
  return NextResponse.json(partToEuros(updated))
})

// DELETE /api/parts/:id
export const DELETE = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  if (!can(session.user.role, 'stock:manage')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
  // Contrôle de propriété AVANT suppression : renvoie un 404 propre et uniforme
  // (comme les autres ressources) au lieu d'un P2025 non typé pour une pièce
  // d'un autre garage. La portée garageId reste dans le where du delete.
  const existing = await prisma.part.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!existing) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  // `StockMovement.part` est en `onDelete: Cascade` : supprimer une pièce
  // EFFACE tout son journal de mouvements. La cause d'une variation de stock
  // devenait alors irreconstituable, et la facture qui l'avait consommée
  // impossible à annuler (GF31-AUD-015). Une pièce qui a réellement bougé porte
  // donc de l'historique comptable : on refuse de la détruire.
  //
  // Une pièce jamais mouvementée — créée par erreur, référence abandonnée —
  // reste librement supprimable : c'est le cas courant, il n'est pas entravé.
  const mouvements = await prisma.stockMovement.count({
    where: { partId: params.id, garageId: session.user.garageId },
  })
  if (mouvements > 0) {
    return NextResponse.json(
      {
        error:
          `« ${existing.name} » a un historique de stock (${mouvements} mouvement(s)) rattaché à des factures. ` +
          'Le supprimer effacerait cet historique. Mettez sa quantité à 0 pour la retirer de la vente.',
        code: 'PART_HAS_HISTORY',
      },
      { status: 409 },
    )
  }

  // ── Pièce POSÉE sur une intervention : refus métier, pas une 500 (GF-037) ──
  // `JobPart.partId` est en `RESTRICT` (schéma comme migration SQLite) : la
  // suppression échouait sur une violation de clé étrangère, que le filet
  // générique de `withAuth` traduisait en « Une erreur interne est survenue »
  // (500). Le garage n'apprenait ni la cause ni le remède. La garde
  // précédente ne regardait que `StockMovement`, et poser une pièce sur une
  // intervention n'en écrivait aucun jusqu'à GF-028 — le compteur valait donc
  // zéro et laissait passer.
  const posees = await prisma.jobPart.count({
    where: { partId: params.id, job: { garageId: session.user.garageId } },
  })
  if (posees > 0) {
    return NextResponse.json(
      {
        error:
          `« ${existing.name} » est posée sur ${posees} intervention(s). Retirez-la de ces ` +
          'interventions avant de la supprimer, ou mettez sa quantité à 0 pour la retirer de la vente.',
        code: 'PART_USED_BY_JOB',
      },
      { status: 409 },
    )
  }

  // ── Détacher les lignes de documents AVANT de supprimer (GF-037) ───────────
  // Le schéma déclare `onDelete: SetNull` sur `InvoiceLine.partId` et
  // `QuoteLine.partId`, et la migration du CLOUD crée bien la contrainte. La
  // migration SQLite du POSTE, elle, n'a ajouté que des colonnes TEXT nues —
  // SQLite ne sait pas poser une contrainte sur une table existante. Sur un
  // poste, la suppression laissait donc un `partId` ORPHELIN : à la validation
  // de la facture, le moteur de stock ne retrouvait plus la pièce et refusait
  // le document en 409 « Pièce introuvable », sans que rien n'indique quoi
  // faire. Le même geste passait sans encombre côté cloud.
  //
  // Plutôt que d'interdire une suppression aujourd'hui légitime, on FAIT ce que
  // la contrainte manquante aurait fait. Sur le cloud, le détachement précède
  // simplement celui de la clé étrangère : même état final, des deux côtés.
  // (Recréer les tables SQLite pour poser la contrainte serait tout sauf
  // minimal.)
  await prisma.$transaction(async (tx) => {
    await tx.invoiceLine.updateMany({
      where: { partId: params.id, invoice: { garageId: session.user.garageId } },
      data:  { partId: null },
    })
    await tx.quoteLine.updateMany({
      where: { partId: params.id, quote: { garageId: session.user.garageId } },
      data:  { partId: null },
    })
    await tx.part.delete({ where: { id: params.id, garageId: session.user.garageId } })
  })
  return NextResponse.json({ success: true })
})
