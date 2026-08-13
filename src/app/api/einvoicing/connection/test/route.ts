export const dynamic = 'force-dynamic'

/**
 * POST /api/einvoicing/connection/test — TEST DE CONNEXION RÉEL.
 *
 * Le bouton « Tester la connexion » doit réellement joindre la plateforme (§86).
 * Cette route ne renvoie donc JAMAIS `{ ok: true }` sans qu'un échange réseau
 * ait eu lieu : elle délègue à `adaptateur.testConnection()`, qui obtient
 * effectivement un jeton (en OAuth2) puis interroge le point d'entrée.
 *
 * Le résultat est HORODATÉ en base (`lastTestedAt`, `lastTestOk`) : l'écran
 * affiche un état mesuré, pas une supposition.
 */

import { NextResponse } from 'next/server'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { getEInvoicingFlags } from '@/lib/einvoicing/flags'
import { einvoiceAdapterRegistry } from '@/lib/einvoicing/adapter'
import { enregistrerAdaptateurs } from '@/lib/einvoicing/registry'
import { dechiffrer, lireConnexion } from '@/lib/einvoicing/connection'
import { serverPrisma, isPostgresDatabase } from '@/lib/db'

export const POST = withAuth(async (req) => {
  const session = await requireSession()
  if (!can(session.user.role, 'settings:manage')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
  // Modèles réservés au déploiement serveur : refus explicite sur le poste.
  if (!isPostgresDatabase()) {
    return NextResponse.json(
      { error: 'La facturation électronique est gérée par le service en ligne, pas par le poste.', code: 'SERVER_ONLY' },
      { status: 501 },
    )
  }

  // Un test déclenche un appel sortant : on le limite comme les autres actions
  // à effet réseau (§33).
  const rl = await enforceRateLimit('license_status', `einvoice-test:${clientIpFrom(req)}`)
  if (!rl.ok) return rateLimitResponse(rl)

  enregistrerAdaptateurs()
  const environment = getEInvoicingFlags().defaultEnvironment
  const connexion = await lireConnexion(session.user.garageId, environment)
  if (!connexion) {
    return NextResponse.json(
      { ok: false, code: 'NO_CONNECTION', message: 'Aucune connexion configurée.' },
      { status: 409 },
    )
  }

  const identifiants = dechiffrer(connexion.credentials)
  if (!identifiants) {
    return NextResponse.json(
      {
        ok: false, code: 'CONNECTION_UNUSABLE',
        message: 'Identifiants illisibles (clé de chiffrement absente ou modifiée). Ressaisissez-les.',
      },
      { status: 503 },
    )
  }
  if (!einvoiceAdapterRegistry.hasAdapter(connexion.providerId)) {
    return NextResponse.json(
      { ok: false, code: 'NO_ADAPTER', message: 'Aucun connecteur disponible pour cette plateforme.' },
      { status: 409 },
    )
  }

  const resultat = await einvoiceAdapterRegistry.getAdapter(connexion.providerId).testConnection({
    garageId: session.user.garageId,
    providerId: connexion.providerId,
    environment,
    credentials: identifiants as unknown as Record<string, string>,
    legalEntityId: connexion.legalEntityId ?? undefined,
  })

  // L'état affiché vient d'une MESURE, pas d'une supposition.
  await serverPrisma().garageEInvoiceConnection.update({
    where: { id: connexion.id },
    data: {
      lastTestedAt: new Date(),
      lastTestOk: resultat.ok,
      status: resultat.ok ? 'connected' : 'error',
    },
  })
  await serverPrisma().eInvoiceAuditEvent.create({
    data: {
      garageId: session.user.garageId, actorUserId: session.user.id, action: 'test',
      targetType: 'GarageEInvoiceConnection', targetId: connexion.id,
      metadata: JSON.stringify({ environment, ok: resultat.ok }),
    },
  })

  return NextResponse.json(resultat, { status: resultat.ok ? 200 : 502 })
})
