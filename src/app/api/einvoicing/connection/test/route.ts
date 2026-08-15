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
import { testerConnexion } from '@/lib/einvoicing/test-connection'
import { relayerVersCloud } from '@/lib/einvoicing/desktop-bridge'
import { isPostgresDatabase } from '@/lib/db'

export const POST = withAuth(async (req) => {
  const session = await requireSession()
  if (!can(session.user.role, 'settings:manage')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
  // Un test déclenche un appel sortant : on le limite comme les autres actions
  // à effet réseau (§33). La limite est posée AVANT la délégation au service en
  // ligne : déléguer d'abord ferait porter au cloud un débit que le poste doit
  // contenir lui-même.
  const rl = await enforceRateLimit('license_status', `einvoice-test:${clientIpFrom(req)}`)
  if (!rl.ok) return rateLimitResponse(rl)

  // Poste : les modèles d'e-facturation n'existent qu'en PostgreSQL. On délègue
  // au service en ligne, qui exécute `testerConnexion` — LE MÊME code — avec les
  // identifiants qu'il est seul à détenir en clair.
  if (!isPostgresDatabase()) return relayerVersCloud(session.user.garageId, 'connection.test')

  // Logique partagée avec le tunnel poste → cloud (`/api/sync/einvoicing`) :
  // deux implémentations d'un test de connexion finiraient par se contredire.
  const { status, ...resultat } = await testerConnexion(
    session.user.garageId,
    getEInvoicingFlags().defaultEnvironment,
    session.user.id,
  )
  return NextResponse.json(resultat, { status })
})
