export const dynamic = 'force-dynamic'

/**
 * POST /api/sync/jobs — MIROIR des interventions d'un poste vers le CLOUD,
 * et renvoi, dans la MÊME réponse, de ce que le mécanicien a modifié depuis.
 *
 * ─── Le défaut résolu ───────────────────────────────────────────────────────
 * Le poste écrit dans SQLite, la PWA mécanicien lit PostgreSQL. Seules
 * l'attribution de clé, le statut de clé et les instantanés portail
 * remontaient : les INTERVENTIONS, elles, ne quittaient jamais le poste.
 * Constat sur la base réelle (2026-08-11) : 30 interventions sur le poste,
 * 0 pour le mécanicien miroir côté cloud. « J'affecte une intervention sur le
 * PC et le mécanicien ne la voit pas » n'était donc pas un défaut de
 * rafraîchissement : la donnée n'existait pas là où la PWA la cherche.
 *
 * ─── Ce qui transite ────────────────────────────────────────────────────────
 * Le strict nécessaire au travail du mécanicien : identification du véhicule et
 * du client, horaires, type de réparation, urgence, statut, chrono, notes de
 * planning. AUCUN prix, coût, marge, devis ni facture.
 *
 * ─── Sécurité ───────────────────────────────────────────────────────────────
 *   - preuve d'identité = licence GARAGE GF2 signée (lib/sync/garage-auth) ;
 *   - le garageId vient de la licence, jamais d'un champ libre ;
 *   - un mécanicien référencé DOIT appartenir à ce garage (sinon l'intervention
 *     est refusée, jamais rattachée de force) ;
 *   - la suppression est BORNÉE à la fenêtre annoncée et au garage authentifié.
 *
 * ─── Idempotence ────────────────────────────────────────────────────────────
 * Rejouer exactement la même remontée ne change rien et ne duplique rien : les
 * interventions sont adressées par leur identifiant, la résolution de conflit
 * est déterministe (cf. lib/sync/job-fields).
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateGarageLicense, shortId } from '@/lib/sync/garage-auth'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { logger } from '@/lib/logger'
import { resolveMirrorWrite, clockOffsetMs, SYNC_MAX_JOBS, SYNC_MAX_TOMBSTONES, type SyncJob } from '@/lib/sync/job-fields'

const FAILURE_STATUS: Record<string, number> = {
  MISSING_LICENSE: 400, LICENSE_INVALID: 403, NOT_A_GARAGE_LICENSE: 403,
  LICENSE_UNKNOWN: 403, LICENSE_REVOKED: 403, LICENSE_SUSPENDED: 403,
  LICENSE_EXPIRED: 403, GARAGE_MISMATCH: 403,
  // Revendication d'un garage déjà réservé / licence pas encore rattachée :
  // conflit d'état, pas un défaut d'authentification (GF31-AUD-003).
  GARAGE_ALREADY_CLAIMED: 409, LICENSE_NOT_BOUND: 409,
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}
function int(v: unknown, fallback: number | null): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}
function date(v: unknown): Date | null {
  if (typeof v !== 'string' || !v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Normalise une intervention reçue ; renvoie null si elle est inexploitable. */
function parseJob(raw: unknown): SyncJob | null {
  if (!raw || typeof raw !== 'object') return null
  const j = raw as Record<string, unknown>
  const id = str(j.id, 64)
  const mechanicId = str(j.mechanicId, 64)
  const jobDate = str(j.date, 10)
  const updatedAt = str(j.updatedAt, 40)
  if (!id || !mechanicId || !ISO_DATE.test(jobDate) || !updatedAt) return null
  return {
    id,
    customerName: str(j.customerName, 200),
    vehicleModel: str(j.vehicleModel, 200),
    licensePlate: str(j.licensePlate, 32) || null,
    repairType: str(j.repairType, 100) || 'other',
    estimatedDuration: int(j.estimatedDuration, 60) ?? 60,
    actualDuration: int(j.actualDuration, null),
    startTime: str(j.startTime, 10) || '08:00',
    date: jobDate,
    status: str(j.status, 32) || 'scheduled',
    notes: str(j.notes, 5000) || null,
    isUrgent: j.isUrgent === true,
    delayMinutes: int(j.delayMinutes, null),
    timerStartedAt: str(j.timerStartedAt, 40) || null,
    timerAccumulatedSec: int(j.timerAccumulatedSec, 0) ?? 0,
    mechanicId,
    updatedAt,
  }
}

export async function POST(req: Request) {
  const rl = await enforceRateLimit('license_status', clientIpFrom(req))
  if (!rl.ok) return rateLimitResponse(rl)

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }

  // REVENDICATION du client : sert à la validation de forme et au journal, mais
  // n'est JAMAIS l'identité retenue (voir `garageId` plus bas, issu de la licence).
  const claimedGarageId = str(body.garageId, 64)
  const window = (body.window as Record<string, unknown>) ?? {}
  const from = str(window.from, 10)
  const to = str(window.to, 10)
  if (!claimedGarageId || !ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }

  const rawJobs = Array.isArray(body.jobs) ? body.jobs : []
  if (rawJobs.length > SYNC_MAX_JOBS) {
    return NextResponse.json({ ok: false, code: 'TOO_MANY_JOBS' }, { status: 413 })
  }
  const jobs = rawJobs.map(parseJob).filter((j): j is SyncJob => j !== null)
  const since = date(body.since)
  // Le poste annonce-t-il avoir TRONQUÉ sa fenêtre ? Si oui, l'absence d'une
  // intervention ne prouve rien : on ne purge pas (GF31-AUD-017).
  const truncated = body.truncated === true
  // Suppressions EXPLICITES annoncées par le poste. Indépendantes de la fenêtre :
  // c'est ce qui permet de propager une suppression faite hors ligne dont la date
  // est sortie de la fenêtre, et de purger même quand la remontée est tronquée
  // (GF31-AUD-044). Bornées et filtrées : on n'accepte que des identifiants.
  const deletedIds = Array.isArray(body.deletedIds)
    ? (body.deletedIds as unknown[])
        .filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64)
        .slice(0, SYNC_MAX_TOMBSTONES)
    : []
  // Décalage d'horloge poste ↔ serveur, neutralisé avant arbitrage (GF31-AUD-016).
  const offsetMs = clockOffsetMs(body.clientNow)

  // `requireBound` : cette route n'établit JAMAIS le miroir d'un garage — c'est
  // le rôle de /api/sync/mechanic-assignment, qui crée la ligne Garage ET
  // rattache la licence dans la MÊME transaction. Une licence encore non
  // rattachée n'a donc aucune raison légitime d'écrire ici. L'accepter revenait
  // à lire, écrire et SUPPRIMER (deleteMany plus bas) dans le garage dont
  // l'appelant fournissait librement l'identifiant : la garde de garage-auth
  // (`record.garageId && claimed && …`) est inopérante quand `record.garageId`
  // est nul, ce qui est l'état NOMINAL d'une licence garage côté cloud
  // (GF31-AUD-003).
  const auth = await authenticateGarageLicense(body.garageLicense, claimedGarageId, { requireBound: true })
  if (!auth.ok) {
    logger.warn('[sync/jobs] refus auth', { code: auth.code, garage: shortId(claimedGarageId) })
    return NextResponse.json({ ok: false, code: auth.code }, { status: FAILURE_STATUS[auth.code] ?? 403 })
  }
  // Identité EFFECTIVE, opposable : celle rattachée à la licence vérifiée.
  // `requireBound` garantit qu'elle est non nulle ; la garde GARAGE_MISMATCH
  // garantit qu'elle est égale à la revendication quand celle-ci est fournie.
  const garageId: string = auth.garageId as string

  try {
    // Le garage miroir doit exister (créé par /api/sync/mechanic-assignment lors
    // de la première attribution de clé). Sans lui, aucune intervention n'est
    // rattachable : on le dit explicitement au lieu d'échouer sur une FK.
    const garage = await prisma.garage.findUnique({ where: { id: garageId }, select: { id: true } })
    if (!garage) return NextResponse.json({ ok: false, code: 'GARAGE_NOT_MIRRORED' }, { status: 409 })

    // Mécaniciens réellement connus de CE garage : une intervention affectée à
    // un identifiant étranger n'est jamais rattachée de force.
    const mechanics = await prisma.mechanic.findMany({ where: { garageId }, select: { id: true } })
    const knownMechanics = new Set(mechanics.map((m) => m.id))

    const existing = await prisma.job.findMany({
      where: { garageId, date: { gte: from, lte: to } },
      select: { id: true, updatedAt: true },
    })
    const mirrorById = new Map(existing.map((j) => [j.id, j.updatedAt]))

    let applied = 0
    let executionKept = 0
    const rejected: Array<{ id: string; code: string }> = []

    for (const job of jobs) {
      if (!knownMechanics.has(job.mechanicId)) {
        rejected.push({ id: job.id, code: 'MECHANIC_UNKNOWN' })
        continue
      }
      const mirrorUpdatedAt = mirrorById.get(job.id) ?? null
      const plan = resolveMirrorWrite(job, mirrorUpdatedAt, offsetMs)
      if (plan.executionKept) executionKept += 1

      const data: Record<string, unknown> = {}
      for (const f of plan.fields) {
        const value = (job as unknown as Record<string, unknown>)[f]
        data[f] = f === 'timerStartedAt' ? date(value) : value
      }

      if (mirrorUpdatedAt === null) {
        await prisma.job.create({ data: { ...data, id: job.id, garageId } as never })
      } else {
        // `updateMany` avec garageId : une intervention d'un autre garage
        // portant le même identifiant ne peut pas être touchée.
        await prisma.job.updateMany({ where: { id: job.id, garageId }, data: data as never })
      }
      applied += 1
    }

    // ── Suppressions EXPLICITES ───────────────────────────────────────────────
    // Portée `garageId` : un poste ne supprime que dans SON garage, quels que
    // soient les identifiants qu'il annonce. On accuse ce qui a été traité —
    // y compris ce qui n'existait déjà plus ici : la pierre tombale du poste a
    // rempli son office et doit pouvoir être effacée, sinon elle repartirait à
    // chaque remontée jusqu'à la fin des temps.
    let deletedExplicit = 0
    if (deletedIds.length > 0) {
      const res = await prisma.job.deleteMany({ where: { garageId, id: { in: deletedIds } } })
      deletedExplicit = res.count
      logger.info('[sync/jobs] suppressions explicites', {
        garage: shortId(garageId), demandees: deletedIds.length, effectives: deletedExplicit,
      })
    }

    // Retrait des interventions disparues du poste DANS LA FENÊTRE annoncée
    // (suppression ou déplacement hors fenêtre). Jamais au-delà : une donnée
    // hors fenêtre n'est pas décrite par cette remontée, donc pas jugée.
    const sentIds = new Set(jobs.map((j) => j.id))
    const staleIds = existing.filter((j) => !sentIds.has(j.id)).map((j) => j.id)
    let deleted = 0
    // Une remontée TRONQUÉE ne décrit pas la fenêtre : ce qu'elle ne contient pas
    // n'a pas été supprimé côté poste, il n'a simplement pas tenu dans l'envoi.
    // Purger sur cette base détruisait le surplus à CHAQUE synchronisation, sans
    // jamais le recréer (la tranche envoyée est toujours la même) — au-delà de
    // SYNC_MAX_JOBS interventions dans la fenêtre, le mécanicien ne voyait plus
    // rien (GF31-AUD-017).
    if (truncated && staleIds.length > 0) {
      logger.warn('[sync/jobs] fenêtre tronquée — purge suspendue', {
        garage: shortId(garageId), candidats: staleIds.length, plafond: SYNC_MAX_JOBS,
      })
    }
    if (!truncated && staleIds.length > 0) {
      const res = await prisma.job.deleteMany({ where: { garageId, id: { in: staleIds } } })
      deleted = res.count
    }

    // ── Voie de retour : ce que le MÉCANICIEN a produit depuis `since` ────────
    const windowJobIds = jobs.map((j) => j.id)
    const changes = windowJobIds.length === 0
      ? { jobs: [], notes: [], photos: [] }
      : await collectMechanicChanges(garageId, windowJobIds, since)

    logger.info('[sync/jobs] miroir mis à jour', {
      garage: shortId(garageId), applied, deleted, deletedExplicit, executionKept,
      rejected: rejected.length, returned: changes.jobs.length + changes.notes.length + changes.photos.length,
    })

    return NextResponse.json({
      ok: true,
      applied,
      deleted,
      // Accusé de réception des suppressions explicites : le poste n'efface ses
      // pierres tombales que sur cette liste. On accuse TOUT ce qui a été
      // demandé (y compris ce qui n'existait déjà plus) — la trace a rempli son
      // office ; ne pas l'accuser la ferait repartir indéfiniment.
      deletedApplied: deletedIds,
      deletedExplicit,
      executionKept,
      rejected,
      changes,
      syncedAt: new Date().toISOString(),
    })
  } catch (err) {
    logger.error('[sync/jobs] erreur base', err)
    return NextResponse.json({ ok: false, code: 'SERVICE_UNAVAILABLE' }, { status: 503 })
  }
}

/** Bornes de la voie de retour — une remontée reste petite et prévisible. */
const MAX_RETURNED_NOTES = 200
const MAX_RETURNED_PHOTOS = 200

async function collectMechanicChanges(garageId: string, jobIds: string[], since: Date | null) {
  const [jobs, notes, photos] = await Promise.all([
    prisma.job.findMany({
      where: { garageId, id: { in: jobIds }, ...(since ? { updatedAt: { gt: since } } : {}) },
      select: {
        id: true, status: true, actualDuration: true, delayMinutes: true,
        timerStartedAt: true, timerAccumulatedSec: true, updatedAt: true,
      },
    }),
    prisma.jobMechanicNote.findMany({
      where: { garageId, jobId: { in: jobIds }, ...(since ? { createdAt: { gt: since } } : {}) },
      select: { id: true, jobId: true, mechanicId: true, type: true, body: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: MAX_RETURNED_NOTES,
    }),
    // Métadonnées seulement : les octets se récupèrent un par un via
    // /api/sync/job-photo, pour ne jamais construire une réponse démesurée
    // (8 Mo × 50 photos × N interventions).
    prisma.jobPhoto.findMany({
      where: {
        garageId, jobId: { in: jobIds }, mechanicId: { not: null },
        ...(since ? { createdAt: { gt: since } } : {}),
      },
      select: { id: true, jobId: true, phase: true, caption: true, mechanicId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: MAX_RETURNED_PHOTOS,
    }),
  ])
  return { jobs, notes, photos }
}
