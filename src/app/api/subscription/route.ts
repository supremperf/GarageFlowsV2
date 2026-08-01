export const dynamic = 'force-dynamic'

/**
 * GET /api/subscription  (authentifié)
 * Renvoie la DÉCISION d'accès de l'abonnement du garage courant, calculée CÔTÉ
 * SERVEUR (statut effectif recalculé à partir des échéances). Ne renvoie aucun
 * identifiant externe sensible.
 */
import { NextResponse } from 'next/server'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { getAccess } from '@/lib/billing/service'

export const GET = withAuth(async () => {
  const session = await requireSession()
  const decision = await getAccess(session.user.garageId)
  return NextResponse.json(decision)
})
