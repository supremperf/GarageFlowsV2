/**
 * Abstraction fournisseur de facturation électronique + machine à états du cycle
 * de vie. La logique métier ne dépend JAMAIS d'un fournisseur concret : elle
 * parle à cette interface. Un adaptateur simulé (sandbox) l'implémente pour les
 * démos/tests ; un adaptateur PDP réel viendra plus tard (contrat requis).
 */
import type { EInvoiceDocument, EInvoiceFormat, LifecycleStatus, ValidationResult } from './types'

export interface SubmitOptions {
  format?: EInvoiceFormat
  /** Clé d'idempotence : deux dépôts avec la même clé ne créent qu'une transmission. */
  idempotencyKey?: string
}

export interface SubmitResult {
  ok: boolean
  /** Identifiant de transmission attribué par le fournisseur. */
  transmissionId: string
  status: LifecycleStatus
  format: EInvoiceFormat
  /** XML sérialisé effectivement transmis (UBL ou CII). */
  xml: string
  validation: ValidationResult
}

export interface StatusResult {
  transmissionId: string
  status: LifecycleStatus
  /** Historique horodaté des statuts (timestamps epoch ms). */
  history: { status: LifecycleStatus; at: number }[]
}

export interface EInvoiceProvider {
  readonly name: string
  /** Dépose une facture. Valide, sérialise, attribue un id de transmission. */
  submit(doc: EInvoiceDocument, opts?: SubmitOptions): Promise<SubmitResult>
  /** Renvoie le statut courant d'une transmission. */
  getStatus(transmissionId: string): Promise<StatusResult | null>
}

/** Transitions autorisées du cycle de vie (flux d'émission → décision → paiement). */
export const LIFECYCLE_TRANSITIONS: Record<LifecycleStatus, LifecycleStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['RECEIVED', 'REJECTED', 'CANCELLED'],
  RECEIVED: ['ACCEPTED', 'REFUSED'],
  ACCEPTED: ['PAID', 'REFUSED'],
  REJECTED: [],
  REFUSED: [],
  PAID: [],
  CANCELLED: [],
}

/** Une transition `from → to` est-elle valide ? */
export function canTransition(from: LifecycleStatus, to: LifecycleStatus): boolean {
  return LIFECYCLE_TRANSITIONS[from]?.includes(to) ?? false
}
