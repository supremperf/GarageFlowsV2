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
import { drapeauxDuService } from '@/lib/einvoicing/desktop-bridge'
import { isPostgresDatabase } from '@/lib/db'
import { isPlatformConnectable } from '@/lib/einvoicing/catalog'
// Données du registre : module SERVEUR, jamais importé par le navigateur.
import {
  EINVOICE_PLATFORM_CATALOG,
  EINVOICE_CATALOG_SOURCE,
  EINVOICE_CATALOG_IMPORTED_AT,
} from '@/lib/einvoicing/catalog-data'
import { einvoiceAdapterRegistry } from '@/lib/einvoicing/adapter'
import { enregistrerAdaptateurs } from '@/lib/einvoicing/registry'

export const GET = withAuth(async () => {
  const session = await requireSession()
  if (!['OWNER', 'MANAGER'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  enregistrerAdaptateurs()

  // Sur un POSTE, les drapeaux locaux sont tous faux — les variables
  // `EINVOICING_*` n'y sont jamais provisionnées. Les servir tels quels faisait
  // afficher « fonctionnalité désactivée » et grisait le formulaire de connexion,
  // alors que c'est le SERVICE qui décide et qu'un tunnel existe pour l'atteindre.
  // Injoignable, on le DIT — au lieu de laisser croire à une désactivation.
  let flags = getEInvoicingFlags()
  let serviceInjoignable = false
  if (!isPostgresDatabase()) {
    const distants = await drapeauxDuService(session.user.garageId)
    if (distants) flags = distants as unknown as typeof flags
    else serviceInjoignable = true
  }
  // `normalizedName` fait partie du CONTRAT attendu par le client : l'onglet
  // e-facturation passe ce tableau tel quel à `searchPlatforms()`, qui trie et
  // filtre dessus. L'omettre de la projection le rendait `undefined` et faisait
  // lever « Cannot read properties of undefined (reading 'localeCompare') » —
  // dans un useMemo, donc pendant le rendu : l'error boundary emportait tout
  // l'écran des réglages, de façon systématique.
  const platforms = EINVOICE_PLATFORM_CATALOG.map((p) => ({
    id: p.id,
    officialName: p.officialName,
    normalizedName: p.normalizedName,
    slug: p.slug,
    approvalStatus: p.approvalStatus,
    integrationStatus: p.integrationStatus,
    authenticationMethods: p.authenticationMethods,
    capabilities: p.capabilities,
    // Provenance de l'entrée (registre officiel) et formats ANNONCÉS par la
    // plateforme — déclaratif, distinct de ce que GarageFlows sait faire.
    registeredAt: p.registeredAt ?? null,
    officialWebsite: p.officialWebsite ?? null,
    declaredFormats: p.declaredFormats ?? null,
    // Connectable UNIQUEMENT si un adaptateur réel est enregistré.
    connectable: isPlatformConnectable(p, (id) => einvoiceAdapterRegistry.hasAdapter(id)),
  }))

  return NextResponse.json({
    flags,
    // Vrai UNIQUEMENT sur un poste dont le service en ligne n'a pas répondu :
    // l'onglet doit alors parler d'indisponibilité, pas de désactivation.
    serviceInjoignable,
    platforms,
    // Provenance AFFICHÉE : l'utilisateur doit savoir d'où vient cette liste et
    // quelle autorité fait foi (§82).
    catalogSource: { ...EINVOICE_CATALOG_SOURCE, importedAt: EINVOICE_CATALOG_IMPORTED_AT },
    // Connecteurs RÉELLEMENT disponibles — la liste est vide tant qu'aucun
    // adaptateur n'est inscrit, et l'interface s'y fie.
    adapters: einvoiceAdapterRegistry.listAvailableAdapters().map((a) => ({
      providerId: a.providerId, displayName: a.displayName,
    })),
    // L'état de connexion vit sur /api/einvoicing/connection (secrets exclus).
    connection: null,
  })
})
