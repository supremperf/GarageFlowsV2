/**
 * Voie de retour CLOUD → POSTE : ce que le mécanicien a produit.
 *
 * ─── Pourquoi un curseur PAR FLUX ───────────────────────────────────────────
 * Trois flux remontent ensemble — exécution des interventions, commentaires,
 * photos — et ils n'avancent pas au même rythme. Un curseur unique force les
 * trois à se caler sur un seul instant, et il n'existe aucun bon choix :
 *
 *   · le plus RÉCENT des trois fait avancer le curseur au rythme du flux le
 *     plus bavard, et saute définitivement les éléments des autres
 *     (GF31-AUD-017, corrigé à l'époque en prenant le plus ancien) ;
 *   · le plus ANCIEN fixe le curseur sur le flux le plus en retard. Un garage
 *     dont la dernière photo date de trois mois redemande donc, à chaque
 *     passage, tout ce qui s'est écrit depuis trois mois — puis n'en garde que
 *     les `RETURN_MAX_NOTES` plus ANCIENS. Passé ce plafond, la réponse ne
 *     contient plus que des commentaires déjà appliqués : les nouveaux ne
 *     redescendent JAMAIS. Le blocage est définitif, et silencieux.
 *
 * Un curseur par flux supprime le choix : chaque flux avance à son rythme, ne
 * bloque pas les autres et ne se fait pas dépasser. Le plafond redevient une
 * simple pagination — le curseur progresse à chaque passage, donc la file finit
 * toujours par s'écouler. `truncated` le dit explicitement pour que le poste
 * enchaîne au lieu d'attendre le prochain déclencheur.
 */

import type { PrismaClient } from '@prisma/client'

/** Bornes de la voie de retour — une réponse reste petite et prévisible. */
export const RETURN_MAX_NOTES = 200
export const RETURN_MAX_PHOTOS = 200

/** Curseurs indépendants, un par flux. `null` = tout depuis l'origine. */
export interface ReturnCursors {
  jobs: Date | null
  notes: Date | null
  photos: Date | null
}

/** Date exploitable, ou `null`. Une valeur illisible n'est jamais un instant. */
function date(v: unknown): Date | null {
  if (typeof v !== 'string' || !v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Curseurs annoncés par le poste.
 *
 * `since` reste accepté : un poste plus ancien que ce serveur n'envoie que lui,
 * et doit continuer de fonctionner exactement comme avant. Il sert alors de
 * repli pour les trois flux.
 */
export function parseReturnCursors(body: Record<string, unknown>): ReturnCursors {
  const repli = date(body.since)
  return {
    jobs:   date(body.sinceJobs)   ?? repli,
    notes:  date(body.sinceNotes)  ?? repli,
    photos: date(body.sincePhotos) ?? repli,
  }
}

/**
 * Sous-ensemble du client Prisma réellement utilisé.
 *
 * `Pick` plutôt qu'une interface structurelle : les délégués Prisma sont
 * génériques, et une signature écrite à la main ne leur correspond jamais tout
 * à fait — le client réel finissait rejeté par le compilateur.
 */
export type ReturnPathClient = Pick<PrismaClient, 'job' | 'jobMechanicNote' | 'jobPhoto'>

export interface ReturnPathResult {
  jobs: Array<Record<string, unknown>>
  notes: Array<Record<string, unknown>>
  photos: Array<Record<string, unknown>>
  /** Un flux a-t-il atteint son plafond ? Le poste doit alors repasser. */
  truncated: { notes: boolean; photos: boolean }
}

/** Rien à remonter : forme stable, `truncated` compris. */
export function emptyReturn(): ReturnPathResult {
  return { jobs: [], notes: [], photos: [], truncated: { notes: false, photos: false } }
}

/**
 * Collecte ce que le mécanicien a produit depuis les curseurs annoncés.
 * Les photos ne remontent qu'en MÉTADONNÉES : les octets se récupèrent une par
 * une via `/api/sync/job-photo`, pour ne jamais construire une réponse
 * démesurée (8 Mo × 50 photos × N interventions).
 */
export async function collectMechanicChanges(
  db: ReturnPathClient,
  garageId: string,
  jobIds: string[],
  cursors: ReturnCursors,
): Promise<ReturnPathResult> {
  if (jobIds.length === 0) return emptyReturn()

  const [jobs, notes, photos] = await Promise.all([
    db.job.findMany({
      where: { garageId, id: { in: jobIds }, ...(cursors.jobs ? { updatedAt: { gt: cursors.jobs } } : {}) },
      select: {
        id: true, status: true, actualDuration: true, delayMinutes: true,
        timerStartedAt: true, timerAccumulatedSec: true, updatedAt: true,
      },
    }),
    db.jobMechanicNote.findMany({
      where: { garageId, jobId: { in: jobIds }, ...(cursors.notes ? { createdAt: { gt: cursors.notes } } : {}) },
      select: { id: true, jobId: true, mechanicId: true, type: true, body: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: RETURN_MAX_NOTES,
    }),
    db.jobPhoto.findMany({
      where: {
        garageId, jobId: { in: jobIds }, mechanicId: { not: null },
        ...(cursors.photos ? { createdAt: { gt: cursors.photos } } : {}),
      },
      select: { id: true, jobId: true, phase: true, caption: true, mechanicId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: RETURN_MAX_PHOTOS,
    }),
  ])

  return {
    jobs, notes, photos,
    truncated: {
      notes:  notes.length  >= RETURN_MAX_NOTES,
      photos: photos.length >= RETURN_MAX_PHOTOS,
    },
  }
}
