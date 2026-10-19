/**
 * Réception d'un webhook de plateforme agréée — orchestration serveur.
 *
 * Le webhook ne CRÉE jamais de transmission : il ne peut que faire progresser
 * une transmission DÉJÀ connue. C'est la garantie qu'un appelant ne peut pas
 * inventer une facture ni un envoi.
 *
 * ─── Comment la bonne connexion est retrouvée ───────────────────────────────
 * La charge utile porte l'identifiant EXTERNE attribué par la plateforme à
 * l'envoi. On retrouve la transmission correspondante (provider + externalId),
 * puis SA connexion — donc SON garage et SON secret. Un secret global ne
 * prouverait rien : le garage A pourrait signer un événement du garage B.
 *
 * Si plusieurs garages partagent le même identifiant externe (identifiants
 * fournisseurs non globaux), on REFUSE au lieu de choisir : deviner le bon
 * garage reviendrait à modifier la facture d'un autre.
 *
 * ─── Ce que le webhook ne fait pas ─────────────────────────────────────────
 * · il ne déclenche aucun envoi ;
 * · il n'invente aucun statut : un statut brut inconnu devient `unknown` et
 *   n'écrase rien (la transmission garde son dernier statut prouvé) ;
 * · il ne journalise ni le corps ni le secret.
 */

import { serverPrisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { einvoiceAdapterRegistry, type CanonicalEInvoiceStatus } from './adapter'
import { enregistrerAdaptateurs } from './registry'
import { dechiffrer, lireConnexion, type EInvoiceEnvironment } from './connection'
import {
  doitRemplacerStatut,
  verifierSignatureWebhook,
  type MotifSignature,
} from './webhook-signature'

export type EchecWebhook =
  | 'BAD_REQUEST'
  | 'ADAPTER_ABSENT'
  | 'UNKNOWN_TRANSMISSION'
  | 'AMBIGUOUS_TRANSMISSION'
  | 'WEBHOOK_NOT_CONFIGURED'
  | 'SIGNATURE_INVALIDE'

export interface ResultatWebhook {
  ok: boolean
  http: number
  code?: EchecWebhook
  motif?: MotifSignature
  transmissionId?: string
  status?: CanonicalEInvoiceStatus
  /** L'événement avait déjà été traité (même identifiant). */
  duplicate?: boolean
  /** Statut traduit mais non appliqué (régression ou inconnu). */
  ignored?: boolean
  message?: string
}

/** Charge utile maximale : un événement de statut n'a aucune raison d'être gros. */
export const TAILLE_MAX_WEBHOOK = 64 * 1024

const chaine = (v: unknown, max = 256): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null

interface TransmissionTrouvee {
  id: string
  garageId: string
  environment: string
  status: string
  externalId: string | null
  providerId: string
}

export async function traiterWebhook(input: {
  providerId: string
  corpsBrut: string
  entetes: Record<string, string | undefined>
  /** Injectable pour les tests ; secondes Unix. */
  maintenant?: number
}): Promise<ResultatWebhook> {
  if (!input.corpsBrut || input.corpsBrut.length > TAILLE_MAX_WEBHOOK) {
    return { ok: false, http: 400, code: 'BAD_REQUEST', message: 'Charge utile absente ou trop volumineuse.' }
  }

  let charge: Record<string, unknown>
  try {
    const parse = JSON.parse(input.corpsBrut) as unknown
    if (!parse || typeof parse !== 'object' || Array.isArray(parse)) throw new Error('objet attendu')
    charge = parse as Record<string, unknown>
  } catch {
    return { ok: false, http: 400, code: 'BAD_REQUEST', message: 'JSON invalide.' }
  }

  const externalId = chaine(charge.externalId)
  const statutBrut = chaine(charge.status, 64)
  const eventId = chaine(charge.eventId ?? input.entetes['x-gf-event-id'], 128)
  if (!externalId || !statutBrut) {
    return {
      ok: false, http: 400, code: 'BAD_REQUEST',
      message: '`externalId` et `status` sont obligatoires.',
    }
  }

  enregistrerAdaptateurs()
  if (!einvoiceAdapterRegistry.hasAdapter(input.providerId)) {
    return { ok: false, http: 404, code: 'ADAPTER_ABSENT', message: 'Connecteur inconnu.' }
  }

  const db = serverPrisma()
  const transmissions = (await db.eInvoiceTransmission.findMany({
    where: { providerId: input.providerId, externalId },
    take: 5,
    select: { id: true, garageId: true, environment: true, status: true, externalId: true, providerId: true },
  })) as TransmissionTrouvee[]

  if (transmissions.length === 0) {
    return {
      ok: false, http: 404, code: 'UNKNOWN_TRANSMISSION',
      message: 'Aucune transmission ne correspond à cet identifiant externe.',
    }
  }
  const garages = new Set(transmissions.map((t) => t.garageId))
  if (garages.size > 1) {
    return {
      ok: false, http: 409, code: 'AMBIGUOUS_TRANSMISSION',
      message: 'Identifiant externe ambigu : plusieurs garages sont concernés.',
    }
  }
  const transmission = transmissions[0]

  const connexion = await lireConnexion(
    transmission.garageId,
    transmission.environment as EInvoiceEnvironment,
  )
  if (!connexion || connexion.providerId !== input.providerId) {
    return {
      ok: false, http: 409, code: 'WEBHOOK_NOT_CONFIGURED',
      message: 'Aucune connexion de ce garage pour cette plateforme.',
    }
  }
  const identifiants = dechiffrer(connexion.credentials)
  const secret = identifiants && 'webhookSecret' in identifiants
    ? (identifiants as { webhookSecret?: string }).webhookSecret
    : null

  const signature = verifierSignatureWebhook({
    secret,
    entetes: input.entetes,
    corpsBrut: input.corpsBrut,
    maintenant: input.maintenant,
  })
  if (!signature.ok) {
    // On distingue CONFIGURATION absente (409, l'exploitant doit agir) d'un
    // appel non signé (401, l'appelant n'est pas la plateforme).
    if (signature.motif === 'SECRET_ABSENT') {
      return {
        ok: false, http: 409, code: 'WEBHOOK_NOT_CONFIGURED',
        message: 'Aucun secret de webhook n’est configuré pour cette connexion.',
      }
    }
    logger.warn('[einvoicing/webhook] signature refusée', {
      providerId: input.providerId, transmissionId: transmission.id, motif: signature.motif,
    })
    return {
      ok: false, http: 401, code: 'SIGNATURE_INVALIDE', motif: signature.motif,
      message: 'Signature absente, invalide ou hors de la fenêtre autorisée.',
    }
  }

  if (eventId) {
    const deja = await db.eInvoiceEvent.findFirst({
      where: { transmissionId: transmission.id, type: 'webhook', message: eventId },
      select: { id: true },
    })
    if (deja) {
      return {
        ok: true, http: 200, duplicate: true,
        transmissionId: transmission.id,
        status: transmission.status as CanonicalEInvoiceStatus,
      }
    }
  }

  const adaptateur = einvoiceAdapterRegistry.getAdapter(input.providerId)
  const canonique = adaptateur.mapProviderStatus(statutBrut)
  const remplace = doitRemplacerStatut(transmission.status, canonique)

  if (remplace) {
    await db.eInvoiceTransmission.update({
      where: { id: transmission.id },
      data: {
        status: canonique,
        // Un statut de succès efface l'erreur précédente ; un statut d'échec la
        // porte. `unknown` n'arrive jamais ici (doitRemplacerStatut le refuse).
        errorMessage: canonique === 'rejected' || canonique === 'refused' || canonique === 'error'
          ? (chaine(charge.message, 500) ?? null)
          : null,
      },
    })
  }

  await db.eInvoiceEvent.create({
    data: {
      transmissionId: transmission.id,
      garageId: transmission.garageId,
      type: 'webhook',
      status: canonique,
      message: eventId,
      // UNIQUEMENT des champs non sensibles : jamais le corps brut, qui peut
      // contenir des données client.
      payload: JSON.stringify({ eventId, externalId, rawStatus: statutBrut, applied: remplace }),
    },
  })

  logger.info('[einvoicing/webhook] événement traité', {
    providerId: input.providerId,
    transmissionId: transmission.id,
    status: canonique,
    applique: remplace,
  })

  return {
    ok: true,
    http: 200,
    transmissionId: transmission.id,
    status: remplace ? canonique : (transmission.status as CanonicalEInvoiceStatus),
    ignored: !remplace,
  }
}
