/**
 * Synchronisation POSTE ⇄ CLOUD des INTERVENTIONS.
 *
 * Appelée après chaque écriture sur une intervention (création, modification,
 * réaffectation, suppression). Best-effort et bornée : l'action du garage ne
 * dépend JAMAIS du réseau — elle est déjà committée localement quand la
 * remontée part.
 *
 * Deux directions dans un seul aller-retour :
 *   POSTE → CLOUD  la fenêtre de planning courante (le mécanicien voit sa tâche) ;
 *   CLOUD → POSTE  ce que le mécanicien a produit (statut, chrono, commentaires,
 *                  photos) depuis le dernier échange.
 *
 * Ne lève jamais. Ne bloque jamais l'appelant.
 */
import { prisma } from '@/lib/db'
import { cloudPost, isDesktopInstance } from '@/lib/sync/cloud-client'
import { logger } from '@/lib/logger'
import { shortId } from '@/lib/sync/garage-auth'
import {
  syncWindow, SYNC_MAX_JOBS, SYNC_MAX_TOMBSTONES, shouldApplyCloudExecution, type SyncJob,
} from '@/lib/sync/job-fields'

export interface JobSyncResult {
  synced: boolean
  code?: string
  pushed?: number
  deleted?: number
  appliedBack?: number
  skipped?: boolean
}

/** Photos rapatriées au maximum par passage — la suite au tour suivant. */
const MAX_PHOTO_PULLS_PER_RUN = 10

/**
 * Marge de recouvrement du curseur : on redemande une petite fenêtre déjà vue
 * plutôt que de risquer de manquer un élément écrit pendant l'aller-retour
 * précédent. Les créations étant adressées par identifiant, revoir un élément
 * ne le duplique pas.
 */
const CURSOR_OVERLAP_MS = 60_000

/** Licence GARAGE active servant de preuve d'identité au poste. */
async function garageLicenseToken(garageId: string): Promise<string | null> {
  const license = await prisma.licenseKey.findFirst({
    where: { garageId, status: 'active', licenseType: { not: 'mechanic' } },
    select: { token: true },
    orderBy: { createdAt: 'desc' },
  })
  return license?.token ?? null
}

/**
 * Curseur de la voie de retour : le plus récent élément déjà rapatrié.
 * Déduit des données locales — aucun stockage supplémentaire, donc rien à
 * réparer si la base est restaurée depuis une sauvegarde.
 */
async function returnCursor(garageId: string): Promise<Date | null> {
  const [note, photo] = await Promise.all([
    prisma.jobMechanicNote.findFirst({
      where: { garageId }, select: { createdAt: true }, orderBy: { createdAt: 'desc' },
    }),
    prisma.jobPhoto.findFirst({
      where: { garageId, mechanicId: { not: null } },
      select: { createdAt: true }, orderBy: { createdAt: 'desc' },
    }),
  ])
  const stamps = [note?.createdAt, photo?.createdAt].filter((d): d is Date => d instanceof Date)
  if (stamps.length === 0) return null
  // Le curseur est COMMUN aux deux flux : prendre le PLUS RÉCENT des deux le
  // faisait avancer au rythme du flux le plus bavard. Un garage où les
  // commentaires arrivent souvent et les photos rarement voyait donc le curseur
  // dépasser des photos jamais rapatriées — définitivement invisibles côté poste
  // (GF31-AUD-017). On retient le PLUS ANCIEN : le flux le plus en retard
  // commande. Le surcoût est nul en pratique — la voie de retour est
  // idempotente (upserts par identifiant) et déjà conçue pour rejouer, comme en
  // témoigne le recouvrement ci-dessous.
  const oldest = new Date(Math.min(...stamps.map((d) => d.getTime())))
  return new Date(oldest.getTime() - CURSOR_OVERLAP_MS)
}

/**
 * Remonte la fenêtre de planning du garage et applique la voie de retour.
 * `now` est injectable pour les tests.
 */
export async function syncGarageJobs(garageId: string, now: Date = new Date()): Promise<JobSyncResult> {
  if (!isDesktopInstance()) return { synced: true, skipped: true }
  if (!garageId) return { synced: false, code: 'NO_GARAGE' }

  try {
    const token = await garageLicenseToken(garageId)
    if (!token) return { synced: false, code: 'NO_GARAGE_LICENSE' }

    const window = syncWindow(now)
    const rows = await prisma.job.findMany({
      where: { garageId, date: { gte: window.from, lte: window.to } },
      select: {
        id: true, customerName: true, vehicleModel: true, licensePlate: true, repairType: true,
        estimatedDuration: true, actualDuration: true, startTime: true, date: true, status: true,
        notes: true, isUrgent: true, delayMinutes: true, timerStartedAt: true,
        timerAccumulatedSec: true, mechanicId: true, updatedAt: true,
      },
      take: SYNC_MAX_JOBS,
      orderBy: { date: 'asc' },
    })

    const jobs: SyncJob[] = rows.map((j) => ({
      ...j,
      timerStartedAt: j.timerStartedAt ? j.timerStartedAt.toISOString() : null,
      updatedAt: j.updatedAt.toISOString(),
    }))

    // Suppressions EXPLICITES en attente d'accusé de réception. Elles voyagent
    // indépendamment de la fenêtre : c'est tout leur intérêt (GF31-AUD-044).
    const tombstones = await prisma.jobTombstone.findMany({
      where: { garageId },
      select: { jobId: true },
      orderBy: { deletedAt: 'asc' },
      take: SYNC_MAX_TOMBSTONES,
    })
    const deletedIds = tombstones.map((t) => t.jobId)

    const since = await returnCursor(garageId)
    const out = await cloudPost('/api/sync/jobs', {
      garageLicense: token,
      garageId,
      window,
      jobs,
      deletedIds,
      since: since ? since.toISOString() : null,
      // La fenêtre a-t-elle été envoyée COMPLÈTE ? Le cloud supprime les
      // interventions de la fenêtre qu'il n'a pas reçues ; avec plus de
      // SYNC_MAX_JOBS interventions, le surplus était donc détruit à chaque
      // remontée — et jamais recréé, `orderBy: date asc` renvoyant toujours la
      // même tranche. Le mécanicien ne voyait plus rien au-delà (GF31-AUD-017).
      truncated: rows.length >= SYNC_MAX_JOBS,
      // Horloge du POSTE au moment de l'envoi : permet au serveur de neutraliser
      // le décalage entre les deux horloges avant tout arbitrage (GF31-AUD-016).
      clientNow: now.toISOString(),
    })

    if (!out.ok) {
      logger.warn('[sync/jobs:push] non confirmée', {
        garage: shortId(garageId), code: out.code ?? 'UNKNOWN', status: out.status ?? 0,
      })
      return { synced: false, code: out.code ?? 'UNKNOWN', pushed: jobs.length }
    }

    // Le cloud accuse ce qu'il a RÉELLEMENT traité : on n'efface jamais une
    // pierre tombale sur la seule foi d'un envoi. Ce qu'il n'a pas confirmé
    // repartira à la prochaine remontée.
    const acquittees = Array.isArray(out.data?.deletedApplied)
      ? (out.data.deletedApplied as unknown[]).filter((v): v is string => typeof v === 'string')
      : []
    if (acquittees.length > 0) {
      await prisma.jobTombstone.deleteMany({ where: { garageId, jobId: { in: acquittees } } })
    }

    const appliedBack = await applyCloudChanges(garageId, token, out.data?.changes)

    logger.info('[sync/jobs:push] confirmée', {
      garage: shortId(garageId),
      pushed: jobs.length,
      applied: Number(out.data?.applied ?? 0),
      deleted: Number(out.data?.deleted ?? 0),
      executionKept: Number(out.data?.executionKept ?? 0),
      appliedBack,
    })
    return {
      synced: true,
      pushed: jobs.length,
      deleted: Number(out.data?.deleted ?? 0),
      appliedBack,
    }
  } catch (err) {
    logger.warn('[sync/jobs:push] erreur', { garage: shortId(garageId), message: (err as Error)?.message })
    return { synced: false, code: 'LOCAL_ERROR' }
  }
}

interface CloudChanges {
  jobs?: Array<Record<string, unknown>>
  notes?: Array<Record<string, unknown>>
  photos?: Array<Record<string, unknown>>
}

/** Applique localement ce que le mécanicien a produit. Ne lève jamais. */
async function applyCloudChanges(
  garageId: string,
  token: string,
  raw: unknown,
): Promise<number> {
  const changes = (raw ?? {}) as CloudChanges
  let applied = 0

  // 1. Exécution (statut, chrono) — uniquement si le cloud est plus récent que
  //    la version locale, sinon on écraserait une décision du garage.
  for (const j of changes.jobs ?? []) {
    const id = typeof j.id === 'string' ? j.id : ''
    const cloudAt = typeof j.updatedAt === 'string' ? new Date(j.updatedAt) : null
    if (!id || !cloudAt || Number.isNaN(cloudAt.getTime())) continue
    const local = await prisma.job.findFirst({
      where: { id, garageId }, select: { id: true, updatedAt: true },
    })
    if (!local) continue
    if (!shouldApplyCloudExecution(local.updatedAt, cloudAt)) continue
    await prisma.job.updateMany({
      where: { id, garageId },
      data: {
        status: typeof j.status === 'string' ? j.status : undefined,
        actualDuration: typeof j.actualDuration === 'number' ? j.actualDuration : null,
        delayMinutes: typeof j.delayMinutes === 'number' ? j.delayMinutes : null,
        timerStartedAt: typeof j.timerStartedAt === 'string' ? new Date(j.timerStartedAt) : null,
        timerAccumulatedSec: typeof j.timerAccumulatedSec === 'number' ? j.timerAccumulatedSec : undefined,
      },
    })
    applied += 1
  }

  // 2. Commentaires du mécanicien — créés à l'identique (même identifiant),
  //    donc rejouer la même réponse n'en duplique aucun.
  for (const n of changes.notes ?? []) {
    const id = typeof n.id === 'string' ? n.id : ''
    const jobId = typeof n.jobId === 'string' ? n.jobId : ''
    if (!id || !jobId) continue
    const exists = await prisma.jobMechanicNote.findUnique({ where: { id }, select: { id: true } })
    if (exists) continue
    const job = await prisma.job.findFirst({ where: { id: jobId, garageId }, select: { id: true } })
    if (!job) continue
    const mechanicId = typeof n.mechanicId === 'string' ? n.mechanicId : null
    const mechanic = mechanicId
      ? await prisma.mechanic.findFirst({ where: { id: mechanicId, garageId }, select: { id: true } })
      : null
    await prisma.jobMechanicNote.create({
      data: {
        id,
        jobId,
        garageId,
        mechanicId: mechanic?.id ?? null,
        type: typeof n.type === 'string' ? n.type : 'comment',
        body: typeof n.body === 'string' ? n.body.slice(0, 5000) : '',
        createdAt: typeof n.createdAt === 'string' ? new Date(n.createdAt) : undefined,
      },
    }).catch(() => { /* course entre deux passages : l'identifiant existe déjà */ })
    applied += 1
  }

  // 3. Photos — métadonnées connues, octets récupérés un par un et bornés.
  let pulled = 0
  for (const p of changes.photos ?? []) {
    if (pulled >= MAX_PHOTO_PULLS_PER_RUN) break
    const id = typeof p.id === 'string' ? p.id : ''
    const jobId = typeof p.jobId === 'string' ? p.jobId : ''
    if (!id || !jobId) continue
    const exists = await prisma.jobPhoto.findUnique({ where: { id }, select: { id: true } })
    if (exists) continue
    const job = await prisma.job.findFirst({ where: { id: jobId, garageId }, select: { id: true } })
    if (!job) continue

    const res = await cloudPost('/api/sync/job-photo', { garageLicense: token, garageId, photoId: id }, 20_000)
    const photo = (res.data?.photo ?? null) as Record<string, unknown> | null
    if (!res.ok || !photo || typeof photo.base64 !== 'string' || !photo.base64) continue
    pulled += 1

    const mechanicId = typeof p.mechanicId === 'string' ? p.mechanicId : null
    const mechanic = mechanicId
      ? await prisma.mechanic.findFirst({ where: { id: mechanicId, garageId }, select: { id: true } })
      : null
    await prisma.jobPhoto.create({
      data: {
        id,
        jobId,
        garageId,
        phase: typeof p.phase === 'string' ? p.phase : 'during',
        caption: typeof p.caption === 'string' ? p.caption.slice(0, 500) : null,
        base64: photo.base64,
        photoPath: null,
        mechanicId: mechanic?.id ?? null,
        createdAt: typeof p.createdAt === 'string' ? new Date(p.createdAt) : undefined,
      },
    }).catch(() => { /* déjà rapatriée entre-temps */ })
    applied += 1
  }

  return applied
}

/**
 * Déclenchement APRÈS une écriture, sans faire attendre la réponse HTTP.
 *
 * Regroupement : plusieurs écritures rapprochées (glisser-déposer en rafale,
 * réaffectation multiple) ne produisent qu'une remontée. On ne lance jamais
 * deux remontées simultanées pour un même garage — la suivante est simplement
 * marquée « à refaire » et part à la fin de celle en cours.
 */
const pending = new Map<string, { timer: ReturnType<typeof setTimeout> | null; running: boolean; again: boolean }>()
const DEBOUNCE_MS = 400

export function scheduleJobSync(garageId: string | null | undefined): void {
  if (!garageId || !isDesktopInstance()) return
  const state = pending.get(garageId) ?? { timer: null, running: false, again: false }
  pending.set(garageId, state)

  if (state.running) { state.again = true; return }
  if (state.timer) clearTimeout(state.timer)
  state.timer = setTimeout(() => { void runNow(garageId) }, DEBOUNCE_MS)
}

async function runNow(garageId: string): Promise<void> {
  const state = pending.get(garageId)
  if (!state) return
  state.timer = null
  state.running = true
  try {
    await syncGarageJobs(garageId)
    lastRunAt.set(garageId, Date.now())
  } finally {
    state.running = false
    if (state.again) {
      state.again = false
      scheduleJobSync(garageId)
    }
  }
}

const lastRunAt = new Map<string, number>()

/**
 * Intervalle minimal entre deux remontées déclenchées par une simple LECTURE.
 * Sans lui, l'écran de planning — qui se rafraîchit régulièrement — lancerait
 * une remontée par requête.
 */
export const BACKGROUND_SYNC_MIN_INTERVAL_MS = 10_000

/**
 * Rattrapage OPPORTUNISTE, accroché à la consultation du planning.
 *
 * C'est ce qui fait remonter au poste ce que le mécanicien a produit (chrono,
 * commentaires, photos) même quand le garage ne modifie rien : sans cela, la
 * voie de retour n'existerait qu'au moment d'une écriture. Fortement limité en
 * cadence, et jamais bloquant.
 */
export function pollJobSync(garageId: string | null | undefined): void {
  if (!garageId || !isDesktopInstance()) return
  const last = lastRunAt.get(garageId) ?? 0
  if (Date.now() - last < BACKGROUND_SYNC_MIN_INTERVAL_MS) return
  lastRunAt.set(garageId, Date.now()) // marqué AVANT : pas de rafale concurrente
  scheduleJobSync(garageId)
}

/** Réinitialise l'état de regroupement — réservé aux tests. */
export function __resetJobSyncScheduler(): void {
  for (const state of Array.from(pending.values())) {
    if (state.timer) clearTimeout(state.timer)
  }
  pending.clear()
  lastRunAt.clear()
}
