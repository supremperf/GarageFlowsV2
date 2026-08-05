/**
 * Catalogue des plateformes de facturation électronique.
 *
 * STRUCTURE centralisée et actualisable, DISTINCTE des connecteurs réellement
 * développés (voir adapter.ts). Une plateforme peut apparaître dans le catalogue,
 * mais elle n'est « connectable » QUE si un adaptateur réel et testé existe et est
 * enregistré dans `einvoiceAdapterRegistry`. Aucune plateforme n'est présentée
 * comme fonctionnelle sans connecteur réel.
 *
 * IMPORTANT — le seed ci-dessous est un PLACEHOLDER de démonstration (mêmes noms
 * d'exemple que la spécification). Il DOIT être remplacé par le registre officiel
 * en vigueur (voir docs/EINVOICING_PROVIDER_CATALOG.md). On ne fabrique donc AUCUN
 * numéro d'agrément : `officialRegistrationNumber` reste absent tant que la donnée
 * officielle n'est pas importée, et tous les `integrationStatus` valent
 * `coming_soon` (rien n'est encore connectable).
 */

export type EInvoiceApprovalStatus =
  | 'approved'
  | 'provisionally_approved'
  | 'suspended'
  | 'withdrawn'

export type EInvoiceIntegrationStatus =
  | 'available'
  | 'configuration_required'
  | 'coming_soon'
  | 'not_supported'

export type EInvoiceAuthMethod =
  | 'oauth2'
  | 'api_key'
  | 'client_credentials'
  | 'certificate'
  | 'username_password'
  | 'manual_activation'

export interface EInvoicePlatformCapabilities {
  outgoingInvoices: boolean
  incomingInvoices: boolean
  invoiceStatuses: boolean
  webhooks: boolean
  eReporting: boolean
  paymentReporting: boolean
  sandbox: boolean
}

export interface ApprovedEInvoicePlatform {
  id: string
  officialName: string
  normalizedName: string
  slug: string
  approvalStatus: EInvoiceApprovalStatus
  officialRegistrationNumber?: string
  officialWebsite?: string
  adapterId?: string
  integrationStatus: EInvoiceIntegrationStatus
  authenticationMethods: EInvoiceAuthMethod[]
  capabilities: EInvoicePlatformCapabilities
  registryUpdatedAt: string
}

/**
 * Normalise une saisie de recherche : insensible à la casse et aux accents,
 * espaces de bord retirés (Unicode NFD + suppression des diacritiques).
 */
export function normalizePlatformSearch(value: string): string {
  // NFD décompose « é » en « e » + accent combinant ; on retire ensuite la plage
  // des diacritiques combinants (U+0300–U+036F). Équivalent à \p{Diacritic} mais
  // sans le drapeau /u (compatible avec la cible TypeScript du projet).
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

const NO_CAPABILITIES: EInvoicePlatformCapabilities = {
  outgoingInvoices: false,
  incomingInvoices: false,
  invoiceStatuses: false,
  webhooks: false,
  eReporting: false,
  paymentReporting: false,
  sandbox: true,
}

/**
 * SEED de démonstration — à REMPLACER par le registre officiel. Noms d'exemple
 * (aucune donnée réglementaire réelle affirmée), tous en `coming_soon`.
 */
export const EINVOICE_PLATFORM_CATALOG: ApprovedEInvoicePlatform[] = [
  { id: 'example-alpha-facturation', officialName: 'Alpha Facturation', normalizedName: 'alpha facturation', slug: 'alpha-facturation', approvalStatus: 'provisionally_approved', integrationStatus: 'coming_soon', authenticationMethods: ['oauth2'], capabilities: { ...NO_CAPABILITIES }, registryUpdatedAt: '2026-01-01' },
  { id: 'example-axion', officialName: 'Axion', normalizedName: 'axion', slug: 'axion', approvalStatus: 'provisionally_approved', integrationStatus: 'coming_soon', authenticationMethods: ['api_key'], capabilities: { ...NO_CAPABILITIES }, registryUpdatedAt: '2026-01-01' },
  { id: 'example-azer', officialName: 'Azer', normalizedName: 'azer', slug: 'azer', approvalStatus: 'provisionally_approved', integrationStatus: 'coming_soon', authenticationMethods: ['client_credentials'], capabilities: { ...NO_CAPABILITIES }, registryUpdatedAt: '2026-01-01' },
  { id: 'example-beta-invoice', officialName: 'Beta Invoice', normalizedName: 'beta invoice', slug: 'beta-invoice', approvalStatus: 'provisionally_approved', integrationStatus: 'coming_soon', authenticationMethods: ['oauth2', 'api_key'], capabilities: { ...NO_CAPABILITIES }, registryUpdatedAt: '2026-01-01' },
]

/**
 * Recherche de plateformes : tri alphabétique stable, insensible casse/accents.
 * Priorité aux entrées dont le nom COMMENCE par la requête (comportement « tapez
 * A → toutes celles en A »), puis correspondance partielle. Performant pour
 * plusieurs centaines d'entrées (filtre linéaire simple).
 */
export function searchPlatforms(
  query: string,
  catalog: ApprovedEInvoicePlatform[] = EINVOICE_PLATFORM_CATALOG,
): ApprovedEInvoicePlatform[] {
  const sorted = [...catalog].sort((a, b) => a.normalizedName.localeCompare(b.normalizedName, 'fr'))
  const q = normalizePlatformSearch(query)
  if (!q) return sorted
  const starts = sorted.filter((p) => p.normalizedName.startsWith(q))
  const contains = sorted.filter(
    (p) => !p.normalizedName.startsWith(q) &&
      (p.normalizedName.includes(q) || p.slug.includes(q) || normalizePlatformSearch(p.officialName).includes(q)),
  )
  return [...starts, ...contains]
}

/** Une plateforme n'est réellement connectable que si un adaptateur est disponible. */
export function isPlatformConnectable(p: ApprovedEInvoicePlatform, hasAdapter: (id: string) => boolean): boolean {
  return p.integrationStatus === 'available' && typeof p.adapterId === 'string' && hasAdapter(p.adapterId)
}
