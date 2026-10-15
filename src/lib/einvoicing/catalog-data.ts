/**
 * DONNÉES du catalogue des plateformes agréées — module SERVEUR.
 *
 * Séparé de `catalog.ts` (types + fonctions pures) pour une raison mesurée :
 * `catalog.ts` est importé par l'onglet e-facturation, donc par le navigateur.
 * Y laisser l'importation du fichier de registre embarquait ses ~54 Ko dans le
 * bundle client — +78 Ko sur le plus gros chunk, 102 octets de marge restants
 * sous le budget de performance (GF31-AUD-023).
 *
 * Le navigateur reçoit le catalogue par `/api/einvoicing/status`, en projection
 * réduite. Il n'a jamais besoin du fichier complet.
 *
 * Provenance : voir `scripts/refresh-einvoicing-catalog.mjs`.
 */

import registre from './data/plateformes-agreees.json'
import type {
  ApprovedEInvoicePlatform,
  CatalogProvenance,
  DeclaredFormats,
  EInvoiceApprovalStatus,
  EInvoicePlatformCapabilities,
} from './catalog'

const NO_CAPABILITIES: EInvoicePlatformCapabilities = {
  outgoingInvoices: false,
  incomingInvoices: false,
  invoiceStatuses: false,
  webhooks: false,
  eReporting: false,
  paymentReporting: false,
  sandbox: true,
}

export const EINVOICE_CATALOG_SOURCE: CatalogProvenance = registre.source
export const EINVOICE_CATALOG_IMPORTED_AT: string = registre.importedAt

/** Forme brute d'une entrée du fichier importé (cf. le script d'import). */
interface EntreeRegistre {
  id: string
  officialName: string
  normalizedName: string
  slug: string
  approvalStatus: string
  officialRegistrationNumber?: string
  registeredAt?: string
  officialWebsite?: string
  declaredFormats?: DeclaredFormats
  declaredEReporting?: boolean
}

/**
 * Catalogue RÉEL, importé du registre des plateformes agréées.
 *
 * `integrationStatus` vaut `coming_soon` pour toutes : le statut d'intégration
 * ne dépend pas du registre mais de l'existence d'un adaptateur GarageFlows
 * réel et testé (voir `isPlatformConnectable`). `capabilities` reste donc à
 * faux et `authenticationMethods` vide — ces informations ne figurent pas dans
 * la source et ne sont pas inventées.
 */
export const EINVOICE_PLATFORM_CATALOG: ApprovedEInvoicePlatform[] =
  (registre.platforms as EntreeRegistre[]).map((p) => ({
    id: p.id,
    officialName: p.officialName,
    normalizedName: p.normalizedName,
    slug: p.slug,
    approvalStatus: p.approvalStatus as EInvoiceApprovalStatus,
    ...(p.officialRegistrationNumber ? { officialRegistrationNumber: p.officialRegistrationNumber } : {}),
    ...(p.registeredAt ? { registeredAt: p.registeredAt } : {}),
    ...(p.officialWebsite ? { officialWebsite: p.officialWebsite } : {}),
    integrationStatus: 'coming_soon',
    authenticationMethods: [],
    capabilities: { ...NO_CAPABILITIES },
    registryUpdatedAt: registre.importedAt,
    ...(p.declaredFormats ? { declaredFormats: p.declaredFormats } : {}),
    ...(p.declaredEReporting !== undefined ? { declaredEReporting: p.declaredEReporting } : {}),
  }))
