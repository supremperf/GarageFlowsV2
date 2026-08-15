export const dynamic = 'force-dynamic'

/**
 * POST /api/einvoicing/invoices/[id]/submit — transmet une facture à la
 * plateforme agréée du garage.
 *
 * La facture est relue DEPUIS LA BASE, bornée au garage de la session : le
 * client ne fournit qu'un identifiant, jamais le contenu du document (§18).
 * L'idempotence est assurée par `submit.ts` : une même facture, inchangée, ne
 * peut pas partir deux fois, quel que soit le nombre de clics (§94).
 *
 * GET renvoie l'état de transmission connu pour cette facture.
 */

import { NextResponse } from 'next/server'
import { prisma, serverPrisma, isPostgresDatabase } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { linesToEuros } from '@/lib/money-db'
import { getEInvoicingFlags } from '@/lib/einvoicing/flags'
import {
  envoyerFacture,
  declarerNonParvenue,
  rafraichirStatut,
  peutEtreDeclareeNonParvenue,
  motifNonTransmissible,
} from '@/lib/einvoicing/submit'
import { factureLocale, relayerVersCloud } from '@/lib/einvoicing/desktop-bridge'

/** Statuts HTTP par cause d'échec — un rejet n'est pas une panne. */
const STATUT: Record<string, number> = {
  NO_CONNECTION: 409,
  CONNECTION_UNUSABLE: 503,
  NO_ADAPTER: 409,
  INVOICE_NOT_FOUND: 404,
  DOCUMENT_INVALID: 422,
  ALREADY_SUBMITTED: 409,
  PROVIDER_REJECTED: 422,
  PROVIDER_UNAVAILABLE: 502,
}

export const POST = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  // Émettre une facture réglementaire relève de la gestion de la facturation.
  if (!can(session.user.role, 'invoice:manage')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  // ── Poste installé ────────────────────────────────────────────────────────
  // Les modèles d'e-facturation n'existent qu'en PostgreSQL : le poste délègue
  // au service en ligne au lieu de refuser. Les drapeaux consultés sont ALORS
  // ceux du service — un poste n'a pas les variables `EINVOICING_*` (le reset ne
  // les provisionne jamais), et gater ici sur des drapeaux locaux toujours faux
  // rendrait la délégation inatteignable.
  if (!isPostgresDatabase()) {
    const corpsPoste = await req.json().catch(() => ({} as Record<string, unknown>))

    // Portée garage AVANT tout appel réseau : un identifiant inconnu ici ne doit
    // pas devenir une sonde vers le service en ligne.
    const locale = await factureLocale(session.user.garageId, params.id)
    if (!locale) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 })

    if (corpsPoste?.action === 'declare-not-received' || corpsPoste?.action === 'refresh-status') {
      const transmissionId = typeof corpsPoste.transmissionId === 'string' ? corpsPoste.transmissionId : ''
      if (!transmissionId) {
        return NextResponse.json({ error: 'transmissionId requis', code: 'VALIDATION_ERROR' }, { status: 400 })
      }
      return relayerVersCloud(
        session.user.garageId,
        corpsPoste.action === 'refresh-status' ? 'invoice.status' : 'invoice.not-received',
        { transmissionId },
      )
    }

    // Refus d'état rendu ici AUSSI : immédiat, sans réseau. Le service en ligne
    // le refait de son côté — c'est lui qui GARANTIT ; ce contrôle-ci ne fait
    // qu'épargner un aller-retour et rendre la même phrase au même moment.
    const interdit = motifNonTransmissible(locale.status)
    if (interdit) {
      return NextResponse.json({ error: interdit.message, code: interdit.code }, { status: 409 })
    }

    return relayerVersCloud(session.user.garageId, 'invoice.submit', { invoiceId: params.id })
  }

  const flags = getEInvoicingFlags()
  if (!flags.outgoingEnabled) {
    return NextResponse.json(
      { error: "L'émission de factures électroniques est désactivée.", code: 'FEATURE_DISABLED' },
      { status: 409 },
    )
  }

  // Portée garage : une facture d'un autre garage est INTROUVABLE, pas refusée.
  const facture = await prisma.invoice.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!facture) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 })

  // Brouillon et facture annulée ne sont pas transmissibles. Le verdict vient de
  // `motifNonTransmissible` — partagé avec le tunnel poste → cloud depuis le
  // 15/08/2026 : deux listes d'états refusés finiraient par diverger.
  const refus = motifNonTransmissible(facture.status)
  if (refus) {
    return NextResponse.json({ error: refus.message, code: refus.code }, { status: 409 })
  }

  const corps = await req.json().catch(() => ({} as Record<string, unknown>))

  // Deux actions portent sur une TRANSMISSION précise, non sur la facture. Elles
  // partagent la même exigence d'identifiant, et la même portée garage — vérifiée
  // en profondeur, jamais ici seulement.
  if (corps?.action === 'declare-not-received' || corps?.action === 'refresh-status') {
    const id = typeof corps.transmissionId === 'string' ? corps.transmissionId : ''
    if (!id) {
      return NextResponse.json({ error: 'transmissionId requis', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    // · relecture : on redemande son verdict à la plateforme, on ne l'invente pas ;
    // · déclaration : l'exploitant a vérifié sur le portail de sa plateforme que
    //   la facture n'y est pas. La décision est tracée au journal d'audit, jamais
    //   déduite par le logiciel.
    const r = corps.action === 'refresh-status'
      ? await rafraichirStatut(session.user.garageId, id)
      : await declarerNonParvenue(session.user.garageId, id, session.user.id)
    return NextResponse.json(r, { status: r.ok ? 200 : (STATUT[r.code ?? ''] ?? 500) })
  }

  const garage = await prisma.garage.findUnique({ where: { id: session.user.garageId } })
  if (!garage) return NextResponse.json({ error: 'Garage introuvable' }, { status: 404 })

  const resultat = await envoyerFacture({
    garageId: session.user.garageId,
    invoiceId: facture.id,
    environment: flags.defaultEnvironment,
    garage: { name: garage.name, siret: garage.siret, vatNumber: garage.vatNumber, address: garage.address },
    invoice: {
      number: facture.number,
      issueDate: facture.issueDate,
      dueDate: facture.dueDate,
      taxRate: facture.taxRate,
      clientName: facture.clientName,
      clientAddress: facture.clientAddress,
    },
    lines: linesToEuros(facture.lines).map((l) => ({
      description: l.description,
      quantityTenThousandths: l.quantityTenThousandths,
      unitPriceTenThousandths: l.unitPriceTenThousandths,
    })),
    actorUserId: session.user.id,
  })

  if (!resultat.ok) {
    return NextResponse.json(resultat, { status: STATUT[resultat.code ?? ''] ?? 500 })
  }
  return NextResponse.json(resultat)
})

export const GET = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  if (!can(session.user.role, 'financial:read')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
  // Poste : les transmissions vivent dans la base du service en ligne. On les y
  // lit, et on n'y ajoute qu'une chose — `peutEmettre`, qui dépend du RÔLE de la
  // session locale, que la licence garage n'identifie pas.
  if (!isPostgresDatabase()) {
    return relayerVersCloud(
      session.user.garageId,
      'invoice.transmissions',
      { invoiceId: params.id },
      (donnees) => ({ ...donnees, peutEmettre: can(session.user.role, 'invoice:manage') }),
    )
  }

  // Portée garage explicite : l'identifiant d'une facture ne suffit jamais.
  const transmissions = await serverPrisma().eInvoiceTransmission.findMany({
    where: { invoiceId: params.id, garageId: session.user.garageId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, providerId: true, environment: true, status: true,
      documentFormat: true, documentSha256: true, externalId: true,
      errorMessage: true, createdAt: true, updatedAt: true,
    },
  })

  const flags = getEInvoicingFlags()
  return NextResponse.json({
    // L'interface a besoin de savoir ce qu'elle a le DROIT de proposer : un
    // bouton qui mène à un refus est pire que pas de bouton. Ces deux
    // prédicats sont calculés ici, à la même source que les routes qui les
    // appliqueront — les recopier côté client les ferait diverger au premier
    // ajustement.
    transmissions: transmissions.map((t) => ({
      ...t,
      peutDeclarerNonParvenue: peutEtreDeclareeNonParvenue(t),
      peutRelireStatut: Boolean(t.externalId),
    })),
    outgoingEnabled: flags.outgoingEnabled,
    environment: flags.defaultEnvironment,
    // La permission d'émettre n'est pas celle de consulter : cette route est
    // ouverte en lecture financière, l'envoi exige la gestion de facturation.
    peutEmettre: can(session.user.role, 'invoice:manage'),
  })
})
