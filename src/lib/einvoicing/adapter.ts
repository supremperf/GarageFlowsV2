/**
 * Architecture par ADAPTATEURS pour la facturation électronique.
 *
 * Chaque plateforme agréée est intégrée derrière un adaptateur indépendant. Le
 * registre global est VOLONTAIREMENT VIDE : aucun connecteur réel n'est encore
 * livré ni testé. Tant qu'aucun adaptateur n'est enregistré, aucune plateforme
 * n'est « connectable » (voir catalog.isPlatformConnectable). On ne présente
 * jamais un envoi simulé comme un envoi réglementaire réel.
 */

export type CanonicalEInvoiceStatus =
  | 'draft'
  | 'submission_pending'
  | 'submitted'
  | 'received_by_platform'
  | 'rejected'
  | 'delivered'
  | 'accepted'
  | 'refused'
  | 'paid'
  | 'error'
  | 'unknown'

export interface ProviderConnectionContext {
  garageId: string
  providerId: string
  environment: 'sandbox' | 'production'
  /** Identifiants DÉJÀ DÉCHIFFRÉS côté serveur (jamais journalisés). */
  credentials: Record<string, string>
  legalEntityId?: string
}

export interface EInvoiceProviderCapabilities {
  outgoingInvoices: boolean
  incomingInvoices: boolean
  invoiceStatuses: boolean
  webhooks: boolean
  eReporting: boolean
  paymentReporting: boolean
  sandbox: boolean
}

export interface ConnectionValidationResult {
  ok: boolean
  reason?: string
}

export interface ConnectionTestResult {
  ok: boolean
  accountName?: string
  siren?: string
  environment?: 'sandbox' | 'production'
  capabilities?: Partial<EInvoiceProviderCapabilities>
  expiresAt?: string
  /** Message opérateur clair (jamais « Erreur 500 » seule). */
  message: string
  recommendedAction?: string
}

export interface AuthorizationContext { garageId: string; providerId: string; redirectUri: string; state: string }
export interface AuthorizationUrlResult { url: string }
export interface AuthorizationCodeContext { garageId: string; providerId: string; code: string; redirectUri: string }
export interface AuthorizationResult { credentials: Record<string, string>; expiresAt?: string }
export interface RefreshAuthorizationContext extends ProviderConnectionContext {}
export interface RefreshAuthorizationResult { credentials: Record<string, string>; expiresAt?: string }

export interface SubmitInvoiceContext extends ProviderConnectionContext {
  invoiceId: string
  idempotencyKey: string
  documentFormat: 'facturx' | 'ubl' | 'cii'
  document: Uint8Array
  documentSha256: string
}
export interface SubmitInvoiceResult {
  externalId: string
  status: CanonicalEInvoiceStatus
  rawStatus?: string
}
export interface InvoiceStatusContext extends ProviderConnectionContext { externalId: string }
export interface InvoiceStatusResult { status: CanonicalEInvoiceStatus; rawStatus?: string; rawPayload?: unknown }
export interface WebhookVerificationContext { providerId: string; headers: Record<string, string>; rawBody: string; secret?: string }
export interface VerifiedWebhookEvent { externalId?: string; status?: CanonicalEInvoiceStatus; rawPayload: unknown }
export interface RevokeConnectionContext extends ProviderConnectionContext {}

export interface EInvoiceProviderAdapter {
  readonly providerId: string
  readonly displayName: string

  getCapabilities(): Promise<EInvoiceProviderCapabilities>
  validateConfiguration(context: ProviderConnectionContext): Promise<ConnectionValidationResult>
  testConnection(context: ProviderConnectionContext): Promise<ConnectionTestResult>

  createAuthorizationUrl?(context: AuthorizationContext): Promise<AuthorizationUrlResult>
  exchangeAuthorizationCode?(context: AuthorizationCodeContext): Promise<AuthorizationResult>
  refreshAuthorization?(context: RefreshAuthorizationContext): Promise<RefreshAuthorizationResult>

  submitInvoice(context: SubmitInvoiceContext): Promise<SubmitInvoiceResult>
  getInvoiceStatus(context: InvoiceStatusContext): Promise<InvoiceStatusResult>

  verifyWebhook?(context: WebhookVerificationContext): Promise<VerifiedWebhookEvent>
  revokeConnection?(context: RevokeConnectionContext): Promise<void>

  mapProviderStatus(rawStatus: string, rawPayload?: unknown): CanonicalEInvoiceStatus
}

export class EInvoiceAdapterRegistry {
  private readonly adapters = new Map<string, EInvoiceProviderAdapter>()

  register(adapter: EInvoiceProviderAdapter): void {
    this.adapters.set(adapter.providerId, adapter)
  }
  getAdapter(providerId: string): EInvoiceProviderAdapter {
    const a = this.adapters.get(providerId)
    if (!a) throw new Error(`Aucun adaptateur de facturation électronique pour « ${providerId} ».`)
    return a
  }
  hasAdapter(providerId: string): boolean {
    return this.adapters.has(providerId)
  }
  listAvailableAdapters(): EInvoiceProviderAdapter[] {
    return Array.from(this.adapters.values())
  }
}

/**
 * Registre GLOBAL — VIDE tant qu'aucun connecteur réel n'est développé et testé.
 * N'enregistrez ici QUE des adaptateurs réellement fonctionnels (jamais un stub
 * qui simulerait un envoi réussi).
 */
export const einvoiceAdapterRegistry = new EInvoiceAdapterRegistry()
