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
import { resolveMirrorWrite, SYNC_MAX_JOBS, type SyncJob } from '@/lib/sync/job-fields'

const FAILURE_STATUS: Record<string, number> = {
  MISSING_LICENSE: 400, LICENSE_INVALID: 403, NOT_A_GARAGE_LICENSE: 403,
  LICENSE_UNKNOWN: 403, LICENSE_REVOKED: 403, LICENSE_SUSPENDED: 403,
  LICENSE_EXPIRED: 403, GARAGE_MISMATCH: 403,
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

  const garageId = str(body.garageId, 64)
  const window = (body.window as Record<string, unknown>) ?? {}
  const from = str(window.from, 10)
  const to = str(window.to, 10)
  if (!garageId || !ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }

  const rawJobs = Array.isArray(body.jobs) ? body.jobs : []
  if (rawJobs.length > SYNC_MAX_JOBS) {
    return NextResponse.json({ ok: false, code: 'TOO_MANY_JOBS' }, { status: 413 })
  }
  const jobs = rawJobs.map(parseJob).filter((j): j is SyncJob => j !== null)
  const since = date(body.since)

  const auth = await authenticateGarageLicense(body.garageLicense, garageId)
  if (!auth.ok) {
    logger.warn('[sync/jobs] refus auth', { code: auth.code, garage: shortId(garageId) })
    return NextResponse.json({ ok: false, code: auth.code }, { status: FAILURE_STATUS[auth.code] ?? 403 })
  }

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
      const plan = resolveMirrorWrite(job, mirrorUpdatedAt)
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

    // Retrait des interventions disparues du poste DANS LA FENÊTRE annoncée
    // (suppression ou déplacement hors fenêtre). Jamais au-delà : une donnée
    // hors fenêtre n'est pas décrite par cette remontée, donc pas jugée.
    const sentIds = new Set(jobs.map((j) => j.id))
    const staleIds = existing.filter((j) => !sentIds.has(j.id)).map((j) => j.id)
    let deleted = 0
    if (staleIds.length > 0) {
      const res = await prisma.job.deleteMany({ where: { garageId, id: { in: staleIds } } })
      deleted = res.count
    }

    // ── Voie de retour : ce que le MÉCANICIEN a produit depuis `since` ────────
    const windowJobIds = jobs.map((j) => j.id)
    const changes = windowJobIds.length === 0
      ? { jobs: [], notes: [], photos: [] }
      : await collectMechanicChanges(garageId, windowJobIds, since)

    logger.info('[sync/jobs] miroir mis à jour', {
      garage: shortId(garageId), applied, deleted, executionKept,
      rejected: rejected.length, returned: changes.jobs.length + changes.notes.length + changes.photos.length,
    })

    return NextResponse.json({
      ok: true,
      applied,
      deleted,
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
