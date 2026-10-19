/**
 * Voie de retour CLOUD → POSTE : l'accord du client sur un devis publié.
 *
 * Le devis part vers le cloud par `/api/sync/quote`, le client le signe depuis
 * son téléphone… et sans ce module le garage ne l'apprendrait jamais. Il verrait
 * un devis éternellement « envoyé », et la preuve d'acceptation resterait dans
 * le seul cloud — alors que c'est lui qui en a besoin en cas de litige.
 *
 * ── Ce qui est appliqué, et ce qui ne l'est pas ─────────────────────────────
 * La PREUVE est toujours enregistrée : elle est datée, scellée, et ne remplace
 * rien. Le STATUT, lui, n'est appliqué que si le devis local est encore
 * `draft` ou `sent`. Un devis déjà `converted` en facture est plus avancé que
 * ce que raconte le cloud : lui réappliquer « accepted » serait un retour en
 * arrière silencieux. On garde alors la preuve et l'on laisse le statut.
 *
 * ── Idempotence ─────────────────────────────────────────────────────────────
 * La preuve est écrite sous l'identifiant que lui a donné le cloud. Rejouer le
 * même passage — reconnexion, double déclenchement, arriéré — met à jour la même
 * ligne au lieu d'en empiler des copies.
 *
 * Tout est BEST-EFFORT : une panne réseau ne doit jamais empêcher le garage de
 * travailler. Le passage suivant reprendra où celui-ci s'est arrêté, le curseur
 * étant déduit de ce que le poste détient RÉELLEMENT.
 */
import { prisma } from '@/lib/db'
import { cloudPost, isDesktopInstance, garageLicenseToken } from '@/lib/sync/cloud-client'
import { logger } from '@/lib/logger'

/**
 * Recul du curseur. Deux preuves scellées à la même seconde, dont une seule
 * reçue, feraient sinon sauter la seconde définitivement.
 */
const RECUL_CURSEUR_MS = 60_000

/** Statuts locaux qu'un accord client a le droit de faire évoluer. */
const REMPLAÇABLES = new Set(['draft', 'sent'])

export interface QuoteReturnResult {
  /** Instance non-poste : il n'y a rien à rapatrier. */
  skipped?: boolean
  /** Preuves reçues du cloud lors de ce passage. */
  recues: number
  /** Preuves réellement écrites (nouvelles ou mises à jour). */
  appliquees: number
  /** Devis dont le statut a été avancé. */
  statutsAvances: number
  /** Le cloud annonce-t-il un arriéré ? */
  resteAPuiser: boolean
  code?: string
}

const vide = (over: Partial<QuoteReturnResult> = {}): QuoteReturnResult =>
  ({ recues: 0, appliquees: 0, statutsAvances: 0, resteAPuiser: false, ...over })

/** Date de la preuve la plus récente déjà détenue, reculée d'une minute. */
async function curseur(garageId: string): Promise<string | null> {
  const derniere = await prisma.signature.findFirst({
    where: { garageId, entityType: 'quote' },
    orderBy: { signedAt: 'desc' },
    select: { signedAt: true },
  })
  if (!derniere) return null
  return new Date(derniere.signedAt.getTime() - RECUL_CURSEUR_MS).toISOString()
}

/**
 * Rapatrie les accords clients sur les devis publiés par ce garage.
 * Ne lève jamais : l'échec est retourné, pas propagé.
 */
export async function pullQuoteSignatures(garageId: string): Promise<QuoteReturnResult> {
  if (!isDesktopInstance()) return vide({ skipped: true })
  if (!garageId) return vide({ code: 'NO_GARAGE' })

  try {
    const licence = await garageLicenseToken(garageId)
    if (!licence) return vide({ code: 'NO_LICENSE' })

    const reponse = await cloudPost('/api/sync/quote-return', {
      garageLicense: licence,
      since: await curseur(garageId),
    })
    if (!reponse.ok) return vide({ code: reponse.code ?? 'REFUSED' })

    const preuves = Array.isArray(reponse.data?.signatures)
      ? (reponse.data.signatures as Array<Record<string, unknown>>)
      : []
    const resteAPuiser = reponse.data?.reste === true
    if (preuves.length === 0) return vide({ resteAPuiser })

    let appliquees = 0
    let statutsAvances = 0

    for (const p of preuves) {
      const id = typeof p.id === 'string' ? p.id : null
      const quoteId = typeof p.quoteId === 'string' ? p.quoteId : null
      const signedAt = typeof p.signedAt === 'string' ? new Date(p.signedAt) : null
      if (!id || !quoteId || !signedAt || Number.isNaN(signedAt.getTime())) continue

      // Le devis doit exister ICI et appartenir à CE garage : le cloud est
      // authentifié, mais une preuve orpheline n'aurait rien à quoi se rattacher
      // et violerait la clé étrangère.
      const local = await prisma.quote.findFirst({
        where: { id: quoteId, garageId },
        select: { id: true, status: true },
      })
      if (!local) continue

      const donnees = {
        garageId,
        entityType: 'quote',
        entityId: quoteId,
        signerName: String(p.signerName ?? 'Client'),
        signerRole: typeof p.signerRole === 'string' ? p.signerRole : 'client',
        algorithm: String(p.algorithm ?? ''),
        contentHash: String(p.contentHash ?? ''),
        imageHash: String(p.imageHash ?? ''),
        seal: String(p.seal ?? ''),
        signatureData: String(p.signatureData ?? ''),
        documentSnapshotJson: String(p.documentSnapshotJson ?? ''),
        ipAddress: typeof p.ipAddress === 'string' ? p.ipAddress : null,
        userAgent: typeof p.userAgent === 'string' ? p.userAgent : null,
        signedAt,
      }

      const statutCloud = typeof p.quoteStatus === 'string' ? p.quoteStatus : null

      await prisma.$transaction(async (tx) => {
        // Preuve d'abord : elle vaut par elle-même, indépendamment du statut.
        await tx.signature.upsert({
          where: { id },
          create: { id, ...donnees } as never,
          update: donnees as never,
        })

        // Statut ensuite, et SEULEMENT s'il fait avancer les choses.
        if (statutCloud && REMPLAÇABLES.has(local.status) && statutCloud !== local.status) {
          const maj = await tx.quote.updateMany({
            where: { id: quoteId, garageId, status: { in: Array.from(REMPLAÇABLES) } },
            data: { status: statutCloud },
          })
          if (maj.count > 0) statutsAvances++
        }
      })
      appliquees++
    }

    if (appliquees > 0) {
      logger.info('[sync/quote-return] accords rapatriés', {
        garage: garageId.slice(0, 8), appliquees, statutsAvances, resteAPuiser,
      })
    }
    return { recues: preuves.length, appliquees, statutsAvances, resteAPuiser }
  } catch (err) {
    logger.error('[sync/quote-return] échec du rapatriement', err)
    return vide({ code: 'INFRA' })
  }
}
