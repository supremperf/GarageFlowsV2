/**
 * Facturation électronique (EN 16931) — point d'entrée public.
 *
 * Chaîne : mapInvoiceToDocument → validateDocument → toUBL / toCII → provider.submit.
 * Voir docs/ELECTRONIC_INVOICING_ARCHITECTURE.md et E_INVOICING_LIMITATIONS.md.
 */
export * from './types'
export { mapInvoiceToDocument, normalizeDate } from './map'
export type { InvoiceInput, GarageInput, InvoiceLineInput, MapOptions } from './map'
export { validateDocument } from './validate'
export { toUBL } from './ubl'
export { toCII } from './cii'
export { escapeXml, formatCents } from './xml'
export { canTransition, LIFECYCLE_TRANSITIONS } from './provider'
export type { EInvoiceProvider, SubmitResult, StatusResult, SubmitOptions } from './provider'
export { SandboxEInvoiceProvider } from './providers/sandbox'
export type { SandboxOptions } from './providers/sandbox'
export { verifyWebhook, signWebhook } from './webhook'
export type { WebhookEvent, WebhookVerifyResult } from './webhook'
