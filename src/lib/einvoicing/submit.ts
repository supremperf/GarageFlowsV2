/**
 * ENVOI d'une facture à la plateforme agréée — chaîne complète (§88).
 *
 *   Invoice GarageFlows
 *     ↓ validation métier          (validate.ts, fail-closed)
 *     ↓ modèle canonique           (document-model.ts, centimes entiers)
 *     ↓ format réglementaire       (cii-xml.ts, profil Factur-X MINIMUM)
 *     ↓ empreinte SHA-256
 *     ↓ clé d'idempotence PERSISTÉE
 *     ↓ plateforme                 (adaptateur réel, HTTP)
 *     ↓ identifiant externe + statut
 *     ↓ persistance                (EInvoiceTransmission + EInvoiceEvent)
 *
 * ─── L'idempotence, en détail (§94, §96) ────────────────────────────────────
 * La clé est DÉTERMINISTE : elle dérive du garage, de la facture et de
 * l'empreinte du document. Deux envois du même document produisent donc la même
 * clé, et la contrainte UNIQUE sur `EInvoiceTransmission.idempotencyKey` fait le
 * reste : la deuxième tentative ne crée pas de seconde ligne.
 *
 * La réservation est faite AVANT l'appel réseau. C'est ce qui traite le cas
 * réellement dangereux — la plateforme accepte, la réponse se perd, l'utilisateur
 * réessaie : la ligne existe déjà, on ne renvoie pas, on rend l'état connu.
 *
 * Un document MODIFIÉ change d'empreinte, donc de clé : il peut être soumis à
 * nouveau, ce qui est le comportement voulu.
 */

import crypto from 'crypto'
import { serverPrisma } from '@/lib/db'
import { einvoiceAdapterRegistry, type CanonicalEInvoiceStatus } from './adapter'
import { enregistrerAdaptateurs } from './registry'
import { buildCanonicalInvoice, type GarageLike, type InvoiceLike, type InvoiceLikeLine } from './document-model'
import { generateFacturXMinimumXml, EInvoiceValidationError } from './cii-xml'
import { dechiffrer, lireConnexion, type EInvoiceEnvironment } from './connection'
import { ErreurPlateforme } from './adapters/generic-pa'
import { logger } from '@/lib/logger'

export type EchecEnvoi =
  | 'NO_CONNECTION'        // aucune connexion configurée
  | 'CONNECTION_UNUSABLE'  // identifiants illisibles (clé de chiffrement)
  | 'NO_ADAPTER'           // aucun connecteur pour cette plateforme
  | 'INVOICE_NOT_FOUND'
  | 'DOCUMENT_INVALID'     // la facture ne passe pas la validation de profil
  | 'ALREADY_SUBMITTED'    // déjà transmise (idempotence)
  | 'PROVIDER_REJECTED'    // la plateforme a refusé le document
  | 'PROVIDER_UNAVAILABLE'

export interface ResultatEnvoi {
  ok: boolean
  code?: EchecEnvoi
  message?: string
  transmissionId?: string
  externalId?: string
  status?: CanonicalEInvoiceStatus
  rawStatus?: string
  /** Règles de validation violées, pour un message actionnable (§93). */
  issues?: Array<{ ruleId: string; message: string }>
}

/**
 * Clé d'idempotence — déterministe, cloisonnée par garage.
 *
 * Elle porte sur la FACTURE, et non sur les octets du document. La première
 * version y mêlait l'empreinte du document : modifier un champ resté modifiable
 * d'une facture émise — le nom du client, par exemple — changeait l'empreinte,
 * donc la clé, et rouvrait l'envoi. C'était une seconde déclaration de la même
 * facture à la plateforme agréée. L'unité de déclaration réglementaire étant la
 * facture, c'est elle qui doit être unique.
 *
 * L'empreinte du document reste enregistrée à part (`documentSha256`, §91) :
 * elle prouve CE QUI a été transmis, elle ne décide pas SI l'on transmet.
 */
export function cleIdempotence(garageId: string, invoiceId: string): string {
  return crypto.createHash('sha256')
    .update(`${garageId} ${invoiceId}`)
    .digest('hex')
}

/**
 * Statuts dans lesquels une transmission n'a JAMAIS abouti et peut donc etre
 * rejouee. Le critere decisif reste l'ABSENCE d'identifiant externe.
 */
const STATUTS_REJOUABLES = new Set(['error', 'rejected'])

/**
 * Violation de contrainte d'unicité, quel que soit le moteur.
 *
 * Prisma remonte `P2002` ; on reconnaît aussi les messages bruts des moteurs au
 * cas où l'erreur traverse une couche qui aplatit le code. Tout le reste doit
 * REMONTER : confondre une panne de base avec « déjà transmise » fabriquerait
 * une idempotence qui n'a pas eu lieu.
 */
function estViolationUnicite(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code
  if (code === 'P2002') return true
  const message = err instanceof Error ? err.message : ''
  return /unique constraint|UNIQUE constraint failed|duplicate key value/i.test(message)
}

/** Empreinte du document réglementaire transmis. */
export function empreinteDocument(document: Uint8Array): string {
  return crypto.createHash('sha256').update(document).digest('hex')
}

export interface EntreesEnvoi {
  garageId: string
  invoiceId: string
  environment: EInvoiceEnvironment
  garage: GarageLike
  invoice: InvoiceLike
  lines: InvoiceLikeLine[]
  actorUserId?: string | null
}

/**
 * Prépare le document réglementaire : validation métier puis sérialisation CII.
 * `cii-xml` est fail-closed — il refuse de produire un XML incohérent.
 */
export function preparerDocument(e: EntreesEnvoi): { xml: string; sha256: string } {
  const canonique = buildCanonicalInvoice(e.garage, e.invoice, e.lines)
  const xml = generateFacturXMinimumXml(canonique)
  return { xml, sha256: empreinteDocument(Buffer.from(xml, 'utf8')) }
}

export async function envoyerFacture(e: EntreesEnvoi): Promise<ResultatEnvoi> {
  enregistrerAdaptateurs()
  const db = serverPrisma()

  // 1. Connexion + identifiants ------------------------------------------------
  const connexion = await lireConnexion(e.garageId, e.environment)
  if (!connexion) {
    return { ok: false, code: 'NO_CONNECTION', message: 'Aucune plateforme connectée pour ce garage.' }
  }
  const identifiants = dechiffrer(connexion.credentials)
  if (!identifiants) {
    return {
      ok: false, code: 'CONNECTION_UNUSABLE',
      message: 'Identifiants de plateforme illisibles (clé de chiffrement absente ou modifiée). Reconfigurez la connexion.',
    }
  }
  if (!einvoiceAdapterRegistry.hasAdapter(connexion.providerId)) {
    return { ok: false, code: 'NO_ADAPTER', message: 'Aucun connecteur disponible pour cette plateforme.' }
  }
  const adaptateur = einvoiceAdapterRegistry.getAdapter(connexion.providerId)

  // 2. Document réglementaire ---------------------------------------------------
  let xml: string
  let documentSha256: string
  try {
    ({ xml, sha256: documentSha256 } = preparerDocument(e))
  } catch (err) {
    if (err instanceof EInvoiceValidationError) {
      return {
        ok: false, code: 'DOCUMENT_INVALID',
        message: 'La facture ne respecte pas le profil réglementaire : corrigez-la puis renvoyez-la.',
        issues: err.issues.map((i) => ({ ruleId: i.ruleId, message: i.message })),
      }
    }
    throw err
  }

  // 3. Idempotence — RÉSERVATION AVANT L'APPEL ---------------------------------
  //
  // La réservation précède l'appel réseau : c'est ce qui protège du cas §96
  // (« la plateforme accepte, la réponse se perd, l'utilisateur réessaie »).
  //
  // Mais réserver ne doit pas CONDAMNER. Première version : toute tentative
  // ratée — y compris un 401 dû à une clé pas encore activée, un 404 dû à un
  // chemin mal saisi, un 503 de la plateforme — laissait la clé occupée, et
  // chaque nouvel essai répondait « déjà transmise » alors que RIEN n'était
  // parti. La facture devenait réglementairement intransmissible, et le message
  // rendu à l'exploitant était faux.
  //
  // Le critère qui tranche n'est pas le statut, c'est l'IDENTIFIANT EXTERNE :
  // sans lui, la plateforme ne nous a jamais rien accusé.
  const idempotencyKey = cleIdempotence(e.garageId, e.invoiceId)
  let transmissionId: string
  try {
    const t = await db.eInvoiceTransmission.create({
      data: {
        garageId: e.garageId,
        invoiceId: e.invoiceId,
        providerId: connexion.providerId,
        connectionId: connexion.id,
        environment: e.environment,
        status: 'submission_pending',
        documentFormat: 'cii',
        documentSha256,
        idempotencyKey,
      },
    })
    transmissionId = t.id
  } catch (err) {
    // On ne traite QUE la violation de contrainte d'unicité. Un `catch` nu
    // transformait n'importe quelle panne de base en « déjà transmise » —
    // un faux succès d'idempotence sur une erreur qui n'a rien à y voir.
    if (!estViolationUnicite(err)) throw err

    const existante = await db.eInvoiceTransmission.findFirst({
      where: { garageId: e.garageId, idempotencyKey },
    })

    const jamaisAboutie =
      existante &&
      !existante.externalId &&
      STATUTS_REJOUABLES.has(existante.status)

    if (!jamaisAboutie) {
      // Soit la plateforme a accusé réception (externalId présent), soit une
      // tentative est en cours / d'issue inconnue : dans les deux cas, renvoyer
      // serait risquer une double déclaration. On rend l'état, tel qu'il est.
      const enCours = existante?.status === 'submission_pending'
      return {
        ok: false,
        code: 'ALREADY_SUBMITTED',
        message: enCours
          ? 'Un envoi de cette facture est déjà en cours. Actualisez son statut avant de réessayer.'
          : 'Cette facture a déjà été transmise à la plateforme.',
        transmissionId: existante?.id,
        externalId: existante?.externalId ?? undefined,
        status: (existante?.status as CanonicalEInvoiceStatus) ?? 'unknown',
      }
    }

    // REJEU : on réutilise la MÊME ligne et la MÊME clé d'idempotence. Cette clé
    // part vers la plateforme (en-tête `Idempotency-Key`) : si celle-ci l'honore,
    // un premier appel qu'elle aurait reçu à notre insu est dédoublonné chez elle.
    await db.eInvoiceTransmission.update({
      where: { id: existante.id },
      data: {
        status: 'submission_pending',
        errorMessage: null,
        // Le document a pu être régénéré entre-temps : on garde l'empreinte de
        // CE qui part réellement.
        documentSha256,
        providerId: connexion.providerId,
        connectionId: connexion.id,
        environment: e.environment,
      },
    })
    await db.eInvoiceEvent.create({
      data: {
        transmissionId: existante.id, garageId: e.garageId, type: 'submitted',
        status: 'submission_pending',
        message: 'Nouvelle tentative après un envoi qui n’a jamais abouti.',
      },
    })
    transmissionId = existante.id
  }

  // 4. Envoi RÉEL ---------------------------------------------------------------
  try {
    const resultat = await adaptateur.submitInvoice({
      garageId: e.garageId,
      providerId: connexion.providerId,
      environment: e.environment,
      credentials: identifiants as unknown as Record<string, string>,
      legalEntityId: connexion.legalEntityId ?? undefined,
      invoiceId: e.invoiceId,
      idempotencyKey,
      documentFormat: 'cii',
      document: Buffer.from(xml, 'utf8'),
      documentSha256,
    })

    await db.eInvoiceTransmission.update({
      where: { id: transmissionId },
      data: { status: resultat.status, externalId: resultat.externalId, errorMessage: null },
    })
    await db.eInvoiceEvent.create({
      data: {
        transmissionId, garageId: e.garageId, type: 'submitted',
        status: resultat.status,
        message: resultat.rawStatus ?? null,
      },
    })
    await db.eInvoiceAuditEvent.create({
      data: {
        garageId: e.garageId, actorUserId: e.actorUserId ?? null, action: 'submit',
        targetType: 'Invoice', targetId: e.invoiceId,
        // Aucun secret, aucun montant : de quoi tracer, rien de plus.
        metadata: JSON.stringify({ transmissionId, providerId: connexion.providerId, environment: e.environment }),
      },
    })

    logger.info('[einvoicing] facture transmise', {
      garageId: e.garageId, transmissionId, status: resultat.status,
    })
    return {
      ok: true, transmissionId,
      externalId: resultat.externalId, status: resultat.status, rawStatus: resultat.rawStatus,
    }
  } catch (err) {
    // Trois issues, et non deux. Ce qui les sépare est la seule question qui
    // compte pour un rejeu : la plateforme a-t-elle pu prendre la facture ?
    //
    //  · elle a RÉPONDU un code d'erreur (4xx/5xx) → elle ne l'a pas prise ;
    //    rejouable sans risque de double déclaration.
    //  · la configuration est inutilisable (rien n'est parti) → rejouable.
    //  · la connexion a été coupée SANS réponse (délai dépassé, socket fermée)
    //    → issue INCONNUE. Renvoyer à l'aveugle risquerait la double
    //    déclaration : on l'enregistre comme telle et l'on exige une décision
    //    humaine (§92, §96) plutôt que d'inventer un statut.
    const repondu = err instanceof ErreurPlateforme && err.status >= 400
    const rejet = err instanceof ErreurPlateforme && err.status >= 400 && err.status < 500
    const configInutilisable = err instanceof ErreurPlateforme && err.status === 0
    const issueInconnue = !repondu && !configInutilisable

    const statut = rejet ? 'rejected' : issueInconnue ? 'unknown' : 'error'
    const message = err instanceof ErreurPlateforme
      ? err.message
      : 'La plateforme n’a pas répondu : impossible de savoir si la facture lui est parvenue.'

    await db.eInvoiceTransmission.update({
      where: { id: transmissionId },
      data: { status: statut, errorMessage: message },
    })
    await db.eInvoiceEvent.create({
      data: { transmissionId, garageId: e.garageId, type: 'error', status: statut, message },
    })

    logger.warn('[einvoicing] envoi non abouti', { garageId: e.garageId, transmissionId, statut })
    return {
      ok: false,
      code: rejet ? 'PROVIDER_REJECTED' : 'PROVIDER_UNAVAILABLE',
      message: issueInconnue
        ? `${message} Vérifiez sur le portail de la plateforme avant de renvoyer.`
        : message,
      transmissionId,
      status: statut as CanonicalEInvoiceStatus,
    }
  }
}

/**
 * Déclare qu'un envoi d'issue INCONNUE n'est jamais parvenu à la plateforme,
 * et rouvre le droit de le rejouer.
 *
 * Quand la connexion tombe sans réponse, GarageFlows ne PEUT PAS savoir si la
 * facture a été prise. Renvoyer d'office risquerait une double déclaration ;
 * bloquer à jamais rendrait la facture intransmissible. La seule sortie
 * honnête est une décision humaine — l'exploitant vérifie sur le portail de sa
 * plateforme — et cette décision est tracée : qui, quand, sur quelle facture.
 */
export async function declarerNonParvenue(
  garageId: string,
  transmissionId: string,
  actorUserId?: string | null,
): Promise<ResultatEnvoi> {
  const db = serverPrisma()
  const t = await db.eInvoiceTransmission.findFirst({ where: { id: transmissionId, garageId } })
  if (!t) return { ok: false, code: 'INVOICE_NOT_FOUND', message: 'Transmission introuvable.' }

  if (t.externalId) {
    return {
      ok: false, code: 'ALREADY_SUBMITTED',
      message: 'Cette transmission porte un identifiant de plateforme : elle est bien parvenue.',
      transmissionId: t.id, externalId: t.externalId,
    }
  }
  if (t.status !== 'unknown') {
    return {
      ok: false, code: 'PROVIDER_UNAVAILABLE',
      message: `Seule une transmission d'issue inconnue peut être déclarée non parvenue (statut actuel : ${t.status}).`,
      transmissionId: t.id,
    }
  }

  await db.eInvoiceTransmission.update({
    where: { id: t.id },
    data: { status: 'error', errorMessage: 'Déclarée non parvenue par l’exploitant : rejeu autorisé.' },
  })
  await db.eInvoiceEvent.create({
    data: {
      transmissionId: t.id, garageId, type: 'status_update', status: 'error',
      message: 'Déclarée non parvenue par l’exploitant : rejeu autorisé.',
    },
  })
  await db.eInvoiceAuditEvent.create({
    data: {
      garageId, actorUserId: actorUserId ?? null, action: 'declare_not_received',
      targetType: 'EInvoiceTransmission', targetId: t.id,
      metadata: JSON.stringify({ invoiceId: t.invoiceId, providerId: t.providerId, environment: t.environment }),
    },
  })

  return { ok: true, transmissionId: t.id, status: 'error' }
}

/**
 * Relit le statut auprès de la plateforme et met à jour la transmission.
 * Le statut BRUT est conservé : on n'invente jamais un `accepted` (§92).
 */
export async function rafraichirStatut(
  garageId: string,
  transmissionId: string,
): Promise<ResultatEnvoi> {
  enregistrerAdaptateurs()
  const db = serverPrisma()

  const t = await db.eInvoiceTransmission.findFirst({ where: { id: transmissionId, garageId } })
  if (!t) return { ok: false, code: 'INVOICE_NOT_FOUND', message: 'Transmission introuvable.' }
  if (!t.externalId) {
    return { ok: false, code: 'PROVIDER_UNAVAILABLE', message: 'Transmission sans identifiant externe : rien à relire.' }
  }

  const connexion = await lireConnexion(garageId, t.environment as EInvoiceEnvironment)
  const identifiants = connexion ? dechiffrer(connexion.credentials) : null
  if (!connexion || !identifiants) {
    return { ok: false, code: 'NO_CONNECTION', message: 'Aucune connexion exploitable pour relire ce statut.' }
  }
  if (!einvoiceAdapterRegistry.hasAdapter(connexion.providerId)) {
    return { ok: false, code: 'NO_ADAPTER', message: 'Aucun connecteur disponible pour cette plateforme.' }
  }

  try {
    const r = await einvoiceAdapterRegistry.getAdapter(connexion.providerId).getInvoiceStatus({
      garageId, providerId: connexion.providerId, environment: t.environment as EInvoiceEnvironment,
      credentials: identifiants as unknown as Record<string, string>,
      externalId: t.externalId,
    })
    await db.eInvoiceTransmission.update({ where: { id: t.id }, data: { status: r.status } })
    await db.eInvoiceEvent.create({
      data: { transmissionId: t.id, garageId, type: 'status_update', status: r.status, message: r.rawStatus ?? null },
    })
    return { ok: true, transmissionId: t.id, externalId: t.externalId, status: r.status, rawStatus: r.rawStatus }
  } catch (err) {
    const message = err instanceof ErreurPlateforme ? err.message : 'Impossible de joindre la plateforme.'
    return { ok: false, code: 'PROVIDER_UNAVAILABLE', message, transmissionId: t.id }
  }
}
