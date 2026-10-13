/**
 * Voie de retour CLOUD → POSTE de la messagerie client, et remontée des
 * réponses du garage.
 *
 * Un ticket naît dans l'espace client, servi par le cloud. Sans ce module, la
 * table `PortalTicket` d'un poste restait vide pour toujours : le bouton
 * « Messages » ouvrait un panneau vide et le garagiste concluait qu'aucun client
 * ne lui écrivait. Un client qui signale un problème et n'obtient jamais de
 * réponse ne revient pas.
 *
 * ── Le compte « ombre » ─────────────────────────────────────────────────────
 * `PortalTicket.portalUserId` est OBLIGATOIRE, et l'auteur d'un ticket peut être
 * un client inscrit tout seul en ligne — donc inconnu du poste. Le rapatriement
 * crée alors un compte local réduit à ce que le garage doit afficher (adresse,
 * nom), avec un haché de mot de passe VIDE.
 *
 * Un haché vide ne peut satisfaire aucune comparaison bcrypt : ce compte ne peut
 * donc servir à s'authentifier nulle part. C'est délibéré — le poste n'a pas à
 * détenir de quoi ouvrir une session au nom d'un client, et il ne sert de toute
 * façon pas le portail (son serveur n'écoute que sur 127.0.0.1). Le vrai compte,
 * celui qui authentifie, reste dans le cloud et n'en descend jamais.
 *
 * ── Ce qui est écrasé, et ce qui ne l'est pas ───────────────────────────────
 * Le cloud fait autorité sur la CONVERSATION (elle s'y déroule) ; les messages
 * sont écrits sous l'identifiant que le cloud leur a donné, donc rejouer un
 * passage met à jour au lieu d'empiler.
 *
 * Tout est BEST-EFFORT : une panne réseau ne doit jamais empêcher de travailler.
 */
import { prisma } from '@/lib/db'
import { cloudPost, isDesktopInstance, garageLicenseToken } from '@/lib/sync/cloud-client'
import { logger } from '@/lib/logger'

/** Deux tickets touchés à la même seconde, dont un seul reçu, ne doivent pas sauter. */
const RECUL_CURSEUR_MS = 60_000

export interface ResultatTickets {
  skipped?: boolean
  recus?: number
  appliques?: number
  code?: string
}

/** Rapatrie les conversations du garage et leurs messages. */
export async function pullGarageTickets(garageId: string): Promise<ResultatTickets> {
  if (!isDesktopInstance()) return { skipped: true }

  try {
    const licence = await garageLicenseToken(garageId)
    if (!licence) return { code: 'NO_GARAGE_LICENSE' }

    // Curseur déduit de ce que le poste détient RÉELLEMENT : un compteur en
    // mémoire redemanderait tout l'historique à chaque démarrage.
    const dernier = await prisma.portalTicket.findFirst({
      where: { garageId },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    })
    const since = dernier
      ? new Date(dernier.updatedAt.getTime() - RECUL_CURSEUR_MS).toISOString()
      : undefined

    const sortie = await cloudPost('/api/sync/tickets', { garageLicense: licence, mode: 'pull', since })
    if (!sortie.ok) return { code: sortie.code ?? 'UNKNOWN' }

    const tickets = (sortie.data as { tickets?: unknown[] } | undefined)?.tickets
    if (!Array.isArray(tickets)) return { code: 'REPONSE_INATTENDUE' }

    let appliques = 0
    for (const brut of tickets) {
      const t = brut as Record<string, unknown>
      const id = typeof t.id === 'string' ? t.id : ''
      const auteur = t.portalUser as { id?: string; email?: string; name?: string } | null
      if (!id || !auteur?.id || !auteur.email) continue

      await prisma.$transaction(async (tx) => {
        // Compte « ombre » : présent pour satisfaire le lien et afficher un nom,
        // JAMAIS pour authentifier (haché vide → aucune comparaison ne réussit).
        const existant = await tx.portalUser.findFirst({
          where: { garageId, email: auteur.email as string },
          select: { id: true },
        })
        if (!existant) {
          await tx.portalUser.create({
            data: {
              id: auteur.id as string, garageId, email: auteur.email as string,
              name: auteur.name ?? null, passwordHash: '', emailVerified: true,
            },
          })
        }
        const portalUserId = existant?.id ?? (auteur.id as string)

        const donnees = {
          garageId,
          portalUserId,
          subject: String(t.subject ?? ''),
          category: String(t.category ?? 'general'),
          priority: String(t.priority ?? 'normal'),
          status: String(t.status ?? 'open'),
          lastMessageAt: t.lastMessageAt ? new Date(String(t.lastMessageAt)) : new Date(),
          closedAt: t.closedAt ? new Date(String(t.closedAt)) : null,
          // Les fiches client et véhicule ne sont pas publiées : pointer vers un
          // identifiant absent créerait une clé étrangère pendante.
          clientId: null, vehicleId: null,
        }
        await tx.portalTicket.upsert({ where: { id }, create: { id, ...donnees }, update: donnees })

        for (const m of Array.isArray(t.messages) ? t.messages : []) {
          const msg = m as Record<string, unknown>
          const mid = typeof msg.id === 'string' ? msg.id : ''
          if (!mid) continue
          const contenu = {
            ticketId: id,
            authorType: String(msg.authorType ?? 'client'),
            authorName: String(msg.authorName ?? '—'),
            body: String(msg.body ?? ''),
            createdAt: msg.createdAt ? new Date(String(msg.createdAt)) : new Date(),
          }
          await tx.portalTicketMessage.upsert({
            where: { id: mid }, create: { id: mid, ...contenu }, update: contenu,
          })
        }
      })
      appliques++
    }

    if (appliques > 0) logger.info('[sync/messages] conversations rapatriées', { appliques })
    return { recus: tickets.length, appliques }
  } catch (err) {
    logger.warn('[sync/messages] erreur', { message: (err as Error)?.message })
    return { code: 'LOCAL_ERROR' }
  }
}

/**
 * Remonte la réponse du garage — ou la clôture — pour que le CLIENT la voie.
 *
 * Sans cela, le garage répondrait dans le vide : son message resterait sur le
 * poste et le client continuerait d'attendre. C'est le mouvement qui donne son
 * sens au rapatriement ; lire sans pouvoir répondre serait pire que ne rien voir.
 */
export async function pushTicketAnswer(
  garageId: string,
  ticketId: string,
  action: 'staff_reply' | 'close' | 'reopen',
  options: { message?: string; authorName?: string } = {},
): Promise<{ remonte: boolean; code?: string }> {
  if (!isDesktopInstance()) return { remonte: true }

  try {
    const licence = await garageLicenseToken(garageId)
    if (!licence) return { remonte: false, code: 'NO_GARAGE_LICENSE' }

    const sortie = await cloudPost('/api/sync/tickets', {
      garageLicense: licence, mode: 'answer', ticketId, action,
      message: options.message, authorName: options.authorName,
    })
    if (sortie.ok) return { remonte: true }

    logger.warn('[sync/messages] réponse non remontée', { code: sortie.code ?? 'UNKNOWN', statut: sortie.status ?? 0 })
    return { remonte: false, code: sortie.code ?? 'UNKNOWN' }
  } catch (err) {
    logger.warn('[sync/messages] erreur de remontée', { message: (err as Error)?.message })
    return { remonte: false, code: 'LOCAL_ERROR' }
  }
}
