export const dynamic = 'force-dynamic'

/**
 * GET /api/einvoicing/status — état (drapeaux) + catalogue PUBLIC des plateformes.
 *
 * Lecture seule, Phase 2. Aucun secret, aucune donnée d'un autre garage : renvoie
 * uniquement des booléens de configuration et le catalogue public. Réservé au
 * staff gestionnaire (OWNER/MANAGER) — les mécaniciens sont exclus (§30). La
 * gestion des connexions (déchiffrement, test, envoi) arrive en Phase 3.
 */

import { NextResponse } from 'next/server'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { getEInvoicingFlags } from '@/lib/einvoicing/flags'
import { EINVOICE_PLATFORM_CATALOG } from '@/lib/einvoicing/catalog'

export const GET = withAuth(async () => {
  const session = await requireSession()
  if (!['OWNER', 'MANAGER'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const flags = getEInvoicingFlags()
  const platforms = EINVOICE_PLATFORM_CATALOG.map((p) => ({
    id: p.id,
    officialName: p.officialName,
    slug: p.slug,
    approvalStatus: p.approvalStatus,
    integrationStatus: p.integrationStatus,
    authenticationMethods: p.authenticationMethods,
    capabilities: p.capabilities,
  }))

  // connection: null — la persistance des connexions arrive en Phase 3.
  return NextResponse.json({ flags, platforms, connection: null })
})
