/**
 * Vérification des webhooks de statut d'un fournisseur de facturation électronique.
 *
 * Un fournisseur/PDP notifie les changements de statut (RECEIVED/ACCEPTED/PAID…)
 * via webhook. On vérifie :
 *  - la SIGNATURE HMAC-SHA256 du corps brut (comparaison temps constant) ;
 *  - la FRAÎCHEUR de l'horodatage (anti-rejeu) ;
 *  - l'idempotence via l'id d'événement (à la charge de l'appelant).
 *
 * Aucune valeur de secret n'est journalisée.
 */
import crypto from 'crypto'
import type { LifecycleStatus } from './types'

export interface WebhookEvent {
  id: string
  transmissionId: string
  status: LifecycleStatus
  /** Horodatage epoch (secondes). */
  timestamp: number
}

export interface WebhookVerifyOptions {
  /** Tolérance de fraîcheur en secondes (défaut 300). */
  toleranceSec?: number
  /** Horloge injectable (défaut Date.now) — tests déterministes. */
  now?: () => number
}

export type WebhookVerifyResult =
  | { ok: true; event: WebhookEvent }
  | { ok: false; reason: string }

/** Calcule la signature attendue `sha256=<hex>` du corps brut. */
export function signWebhook(rawBody: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

/**
 * Vérifie un webhook. `signatureHeader` = valeur de l'en-tête `X-GF-Signature`.
 * Fail-closed : secret manquant → refus.
 */
export function verifyWebhook(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string | undefined,
  opts: WebhookVerifyOptions = {},
): WebhookVerifyResult {
  if (!secret || !secret.trim()) return { ok: false, reason: 'secret_absent' }
  if (!signatureHeader) return { ok: false, reason: 'signature_absente' }

  const expected = signWebhook(rawBody, secret)
  if (!timingSafeEqualStr(signatureHeader, expected)) return { ok: false, reason: 'signature_invalide' }

  let parsed: Partial<WebhookEvent>
  try { parsed = JSON.parse(rawBody) } catch { return { ok: false, reason: 'corps_invalide' } }

  if (!parsed.id || !parsed.transmissionId || !parsed.status || typeof parsed.timestamp !== 'number') {
    return { ok: false, reason: 'champs_manquants' }
  }

  const toleranceSec = opts.toleranceSec ?? 300
  const nowSec = Math.floor((opts.now ?? Date.now)() / 1000)
  if (Math.abs(nowSec - parsed.timestamp) > toleranceSec) {
    return { ok: false, reason: 'horodatage_hors_tolerance' } // anti-rejeu
  }

  return { ok: true, event: parsed as WebhookEvent }
}
