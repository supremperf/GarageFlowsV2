/**
 * Voie de retour CLOUD → POSTE des demandes de rendez-vous, et remontée de la
 * décision du garage.
 *
 * Une demande de rendez-vous naît dans l'espace client, servi par le cloud. Sans
 * ce module, la table `Appointment` d'un poste restait vide pour toujours : le
 * panneau « Rendez-vous » s'ouvrait sur rien, et le garagiste en concluait
 * qu'aucun client n'en demandait. Un silence coûte plus cher qu'une erreur — il
 * n'invite pas à chercher.
 *
 * ── Ce qui est écrasé, et ce qui ne l'est pas ───────────────────────────────
 * Le cloud fait autorité sur la DEMANDE (ce que le client a écrit) ; le poste
 * fait autorité sur la RÉPONSE (ce que le garage décide). La descente
 * n'applique donc le statut distant que s'il est plus avancé qu'un simple
 * `requested` local, et jamais l'inverse : une confirmation faite au comptoir,
 * pas encore remontée, ne doit pas être effacée par un passage de rapatriement.
 *
 * ── Idempotence ─────────────────────────────────────────────────────────────
 * Chaque demande est écrite sous l'identifiant que lui a donné le cloud.
 * Rejouer un passage met à jour la même ligne au lieu d'en empiler des copies.
 *
 * Tout est BEST-EFFORT : une panne réseau ne doit jamais empêcher de travailler.
 */
import { prisma } from '@/lib/db'
import { cloudPost, isDesktopInstance, garageLicenseToken } from '@/lib/sync/cloud-client'
import { logger } from '@/lib/logger'

/**
 * Recul du curseur. Deux demandes horodatées à la même seconde, dont une seule
 * reçue, feraient sinon sauter la seconde définitivement.
 */
const RECUL_CURSEUR_MS = 60_000

/**
 * Statuts locaux qu'une descente a le droit de remplacer.
 *
 * `requested` seulement : au-delà, c'est le garage qui a tranché, et le cloud
 * n'en sait pas encore autant que lui.
 */
const REMPLAÇABLES = new Set(['requested'])

export interface ResultatRendezVous {
  /** Instance non-poste : il n'y a rien à rapatrier. */
  skipped?: boolean
  recus?: number
  appliques?: number
  code?: string
}

/**
 * Rapatrie les demandes de rendez-vous du garage.
 *
 * Le curseur est déduit de ce que le poste détient RÉELLEMENT — jamais d'un
 * compteur en mémoire, qu'un redémarrage remettrait à zéro et qui ferait
 * redemander tout l'historique à chaque lancement.
 */
export async function pullGarageAppointments(garageId: string): Promise<ResultatRendezVous> {
  if (!isDesktopInstance()) return { skipped: true }

  try {
    const licence = await garageLicenseToken(garageId)
    if (!licence) return { code: 'NO_GARAGE_LICENSE' }

    const derniere = await prisma.appointment.findFirst({
      where: { garageId },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    })
    const since = derniere
      ? new Date(derniere.updatedAt.getTime() - RECUL_CURSEUR_MS).toISOString()
      : undefined

    const sortie = await cloudPost('/api/sync/appointments', {
      garageLicense: licence, mode: 'pull', since,
    })
    if (!sortie.ok) return { code: sortie.code ?? 'UNKNOWN' }

    const demandes = (sortie.data as { appointments?: unknown[] } | undefined)?.appointments
    if (!Array.isArray(demandes)) return { code: 'REPONSE_INATTENDUE' }

    let appliques = 0
    for (const brut of demandes) {
      const d = brut as Record<string, unknown>
      const id = typeof d.id === 'string' ? d.id : ''
      if (!id) continue

      const locale = await prisma.appointment.findFirst({
        where: { id, garageId },
        select: { id: true, status: true },
      })

      // Champs de la DEMANDE : le client en est l'auteur, le cloud fait autorité.
      const demande = {
        clientName: String(d.clientName ?? '—'),
        vehicleModel: typeof d.vehicleModel === 'string' ? d.vehicleModel : null,
        licensePlate: typeof d.licensePlate === 'string' ? d.licensePlate : null,
        reason: String(d.reason ?? ''),
        date: String(d.date ?? ''),
        startTime: String(d.startTime ?? ''),
        durationMin: typeof d.durationMin === 'number' ? d.durationMin : 60,
        notes: typeof d.notes === 'string' ? d.notes : null,
      }
      const statutDistant = typeof d.status === 'string' ? d.status : 'requested'

      if (!locale) {
        await prisma.appointment.create({
          data: {
            id, garageId, ...demande, status: statutDistant,
            // Les fiches client et véhicule ne sont pas publiées : pointer vers
            // un identifiant absent créerait une clé étrangère pendante.
            clientId: null, vehicleId: null, portalUserId: null,
          },
        })
        appliques++
        continue
      }

      // Le statut local ne recule jamais : une décision prise au comptoir et pas
      // encore remontée vaut mieux que ce que le cloud croit savoir.
      const data = REMPLAÇABLES.has(locale.status)
        ? { ...demande, status: statutDistant }
        : demande
      await prisma.appointment.update({ where: { id }, data })
      appliques++
    }

    if (appliques > 0) {
      logger.info('[sync/rendez-vous] demandes rapatriées', { recus: demandes.length, appliques })
    }
    return { recus: demandes.length, appliques }
  } catch (err) {
    logger.warn('[sync/rendez-vous] erreur', { message: (err as Error)?.message })
    return { code: 'LOCAL_ERROR' }
  }
}

/**
 * Remonte au cloud la décision du garage, pour que le CLIENT la voie.
 *
 * Sans cela, le garage confirmerait un rendez-vous que son client verrait encore
 * « en attente » — un décalage plus dommageable que l'absence de fonctionnalité,
 * parce que les deux parties croient savoir et se contredisent.
 *
 * L'ACTION est transmise, pas le statut : c'est la machine à états du service
 * qui décide, exactement comme sur la route de session.
 */
export async function pushAppointmentDecision(
  garageId: string,
  appointmentId: string,
  action: 'confirm' | 'cancel' | 'complete',
): Promise<{ remonte: boolean; code?: string }> {
  if (!isDesktopInstance()) return { remonte: true }

  try {
    const licence = await garageLicenseToken(garageId)
    if (!licence) return { remonte: false, code: 'NO_GARAGE_LICENSE' }

    const sortie = await cloudPost('/api/sync/appointments', {
      garageLicense: licence, mode: 'answer', appointmentId, action,
    })
    if (sortie.ok) return { remonte: true }

    logger.warn('[sync/rendez-vous] décision non remontée', { code: sortie.code ?? 'UNKNOWN', statut: sortie.status ?? 0 })
    return { remonte: false, code: sortie.code ?? 'UNKNOWN' }
  } catch (err) {
    logger.warn('[sync/rendez-vous] erreur de remontée', { message: (err as Error)?.message })
    return { remonte: false, code: 'LOCAL_ERROR' }
  }
}
