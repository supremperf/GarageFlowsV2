/**
 * Adaptateur SANDBOX (simulé) de facturation électronique.
 *
 * Implémente `EInvoiceProvider` de façon RÉELLE et fonctionnelle, en mémoire :
 *  - valide le document (EN 16931 cœur) — refuse (REJECTED) si invalide ;
 *  - sérialise en UBL ou CII et conserve le XML transmis ;
 *  - attribue un id de transmission, gère l'idempotence et l'historique de statut ;
 *  - permet de faire AVANCER le cycle de vie (RECEIVED → ACCEPTED → PAID…) pour
 *    les démos et tests, en refusant les transitions invalides.
 *
 * Aucune connexion réseau, aucune PDP réelle. Sert de double de test/démo et de
 * référence d'implémentation pour un futur adaptateur PDP. Déterministe : l'horloge
 * et le générateur d'identifiants sont injectables.
 */
import type { EInvoiceDocument, EInvoiceFormat, LifecycleStatus } from '../types'
import type { EInvoiceProvider, StatusResult, SubmitOptions, SubmitResult } from '../provider'
import { canTransition } from '../provider'
import { validateDocument } from '../validate'
import { toUBL } from '../ubl'
import { toCII } from '../cii'

interface Record_ {
  transmissionId: string
  status: LifecycleStatus
  format: EInvoiceFormat
  xml: string
  history: { status: LifecycleStatus; at: number }[]
  idempotencyKey?: string
}

export interface SandboxOptions {
  /** Horloge injectable (défaut Date.now) — pour des tests déterministes. */
  now?: () => number
  /** Générateur d'id injectable (défaut compteur `sbx-<n>`). */
  newId?: () => string
}

export class SandboxEInvoiceProvider implements EInvoiceProvider {
  readonly name = 'sandbox'
  private store = new Map<string, Record_>()
  private byIdem = new Map<string, string>()
  private seq = 0
  private now: () => number
  private newId: () => string

  constructor(opts: SandboxOptions = {}) {
    this.now = opts.now ?? (() => Date.now())
    this.newId = opts.newId ?? (() => `sbx-${++this.seq}`)
  }

  async submit(doc: EInvoiceDocument, opts: SubmitOptions = {}): Promise<SubmitResult> {
    const format: EInvoiceFormat = opts.format ?? 'CII'

    // Idempotence : même clé → même transmission (pas de doublon).
    if (opts.idempotencyKey && this.byIdem.has(opts.idempotencyKey)) {
      const rec = this.store.get(this.byIdem.get(opts.idempotencyKey)!)!
      return {
        ok: rec.status !== 'REJECTED',
        transmissionId: rec.transmissionId,
        status: rec.status,
        format: rec.format,
        xml: rec.xml,
        validation: validateDocument(doc),
      }
    }

    const validation = validateDocument(doc)
    const xml = format === 'UBL' ? toUBL(doc) : toCII(doc)
    const transmissionId = this.newId()
    const at = this.now()
    const status: LifecycleStatus = validation.valid ? 'SUBMITTED' : 'REJECTED'

    const rec: Record_ = {
      transmissionId,
      status,
      format,
      xml,
      history: [{ status, at }],
      idempotencyKey: opts.idempotencyKey,
    }
    this.store.set(transmissionId, rec)
    if (opts.idempotencyKey) this.byIdem.set(opts.idempotencyKey, transmissionId)

    return { ok: validation.valid, transmissionId, status, format, xml, validation }
  }

  async getStatus(transmissionId: string): Promise<StatusResult | null> {
    const rec = this.store.get(transmissionId)
    if (!rec) return null
    return { transmissionId, status: rec.status, history: [...rec.history] }
  }

  /**
   * Fait avancer le cycle de vie (simulation d'un retour de plateforme). Refuse
   * une transition non autorisée. Renvoie le nouveau statut, ou `null` si inconnu.
   */
  async advance(transmissionId: string, to: LifecycleStatus): Promise<StatusResult | null> {
    const rec = this.store.get(transmissionId)
    if (!rec) return null
    if (!canTransition(rec.status, to)) {
      throw new Error(`Transition invalide ${rec.status} → ${to}`)
    }
    rec.status = to
    rec.history.push({ status: to, at: this.now() })
    return { transmissionId, status: rec.status, history: [...rec.history] }
  }

  /** Récupère le XML transmis (preuve/archivage de démonstration). */
  getDocumentXml(transmissionId: string): string | null {
    return this.store.get(transmissionId)?.xml ?? null
  }
}
