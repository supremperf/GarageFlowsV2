export const dynamic = 'force-dynamic'

/**
 * POST /api/sync/mechanic-assignment — REMONTÉE d'une attribution de clé
 * mécanicien faite sur un POSTE (Electron) vers la base CLOUD.
 *
 * ─── Le problème résolu ─────────────────────────────────────────────────────
 * `src/lib/db.ts` choisit UNE base par déploiement : SQLite sur le poste,
 * PostgreSQL (Neon) sur la PWA. Aucune synchronisation n'existait. Le patron
 * attribuait donc la clé dans l'EXE — écriture purement locale — et le
 * mécanicien se voyait refuser l'activation sur app.garageflows.fr avec
 * `MECHANIC_KEY_UNASSIGNED`, la ligne LicenseKey du cloud ayant garageId,
 * mechanicId et parentLicenseId à NULL, et le garage du poste n'existant pas
 * côté serveur (contraintes de clé étrangère).
 *
 * ─── Ce qui est synchronisé (STRICTEMENT le nécessaire) ─────────────────────
 * L'activation mécanicien (`activateMechanicKey`) exige exactement :
 *   - la ligne LicenseKey mécanicien avec garageId + mechanicId + parent valide ;
 *   - une ligne Mechanic existante dans ce garage ;
 *   - une ligne Garage (contrainte FK).
 * On ne remonte QUE cela : identité du garage (id, nom) et du mécanicien
 * (id, nom, avatar, couleur). Aucune donnée client, véhicule, financière.
 *
 * ─── Sécurité ───────────────────────────────────────────────────────────────
 *   - preuve d'identité = licence GARAGE GF2 signée (voir lib/sync/garage-auth) ;
 *     format, algorithme, claims et keygen INCHANGÉS ;
 *   - le `plid` SIGNÉ de la clé mécanicien doit désigner cette licence garage :
 *     un poste ne peut pas s'approprier la clé d'un autre garage ;
 *   - le garageId écrit vient de la licence, jamais d'un champ libre ;
 *   - NON DESTRUCTIF : une clé déjà attribuée à un AUTRE mécanicien n'est jamais
 *     écrasée (409 ALREADY_ASSIGNED) ; ré-envoyer la même attribution est
 *     idempotent ;
 *   - `recordMac` recalculé (il couvre parentLicenseId + mechanicId) ;
 *   - transaction unique : pas d'état intermédiaire visible ;
 *   - journalisation sans secret (identifiants tronqués, jamais de jeton).
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyLicenseToken } from '@/lib/license/verify'
import { computeRecordMac } from '@/lib/license/record-mac'
import { authenticateGarageLicense, shortId } from '@/lib/sync/garage-auth'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { logger } from '@/lib/logger'

const FAILURE_STATUS: Record<string, number> = {
  MISSING_LICENSE: 400, LICENSE_INVALID: 403, NOT_A_GARAGE_LICENSE: 403,
  LICENSE_UNKNOWN: 403, LICENSE_REVOKED: 403, LICENSE_SUSPENDED: 403,
  LICENSE_EXPIRED: 403, GARAGE_MISMATCH: 403,
}

/** Slug déterministe et unique — Garage.slug est @unique et obligatoire. */
function mirrorSlug(garageId: string): string {
  return `gf-${garageId}`.slice(0, 96)
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

export async function POST(req: Request) {
  const rl = await enforceRateLimit('license_status', clientIpFrom(req))
  if (!rl.ok) return rateLimitResponse(rl)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 }) }

  const garage   = (body.garage as Record<string, unknown>) ?? {}
  const mechanic = (body.mechanic as Record<string, unknown>) ?? {}
  const garageId   = str(garage.id, 64)
  const garageName = str(garage.name, 200) || 'Garage'
  const mechanicId = str(mechanic.id, 64)
  const mechanicName = str(mechanic.name, 200) || 'Mécanicien'
  const mechanicAvatar = str(mechanic.avatar, 8) || mechanicName.slice(0, 2).toUpperCase()
  const mechanicColor  = /^#[0-9a-fA-F]{6}$/.test(str(mechanic.color, 7)) ? str(mechanic.color, 7) : '#3b82f6'
  const mechanicToken  = typeof body.mechanicLicense === 'string' ? body.mechanicLicense.trim() : ''

  if (!garageId || !mechanicId || !mechanicToken) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }

  // 1. Le poste prouve son identité avec sa licence GARAGE.
  const auth = await authenticateGarageLicense(body.garageLicense, garageId)
  if (!auth.ok) {
    logger.warn('[sync/mechanic] refus auth', { code: auth.code, garage: shortId(garageId) })
    return NextResponse.json({ ok: false, code: auth.code }, { status: FAILURE_STATUS[auth.code] ?? 403 })
  }

  // 2. La clé mécanicien doit être signée ET rattachée à CETTE licence garage.
  const mv = verifyLicenseToken(mechanicToken)
  if (!mv.valid || !mv.payload || !mv.isMechanic) {
    return NextResponse.json({ ok: false, code: 'MECHANIC_LICENSE_INVALID' }, { status: 403 })
  }
  if (mv.payload.plid !== auth.licenseId) {
    logger.warn('[sync/mechanic] plid étranger', { key: shortId(mv.payload.lid), parent: shortId(mv.payload.plid) })
    return NextResponse.json({ ok: false, code: 'PARENT_MISMATCH' }, { status: 403 })
  }

  const mechPayload = mv.payload
  const mechLid  = mechPayload.lid
  const now      = new Date()

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 3. Rattachement de la licence garage à la première utilisation
      //    (même règle que /api/mechanic-licenses et validateLicensedSession).
      if (!auth.garageId) {
        await tx.licenseKey.updateMany({
          where: { licenseId: auth.licenseId, garageId: null },
          data:  { garageId },
        })
      }

      // 4. Miroir MINIMAL du garage — la FK Mechanic.garageId l'exige.
      //    `create` seulement : on ne réécrit jamais un garage déjà présent
      //    (il peut appartenir à une instance PWA avec ses propres données).
      const existingGarage = await tx.garage.findUnique({ where: { id: garageId }, select: { id: true } })
      if (!existingGarage) {
        await tx.garage.create({ data: { id: garageId, name: garageName, slug: mirrorSlug(garageId) } })
      }

      // 5. Miroir MINIMAL du mécanicien (identité seule).
      const existingMech = await tx.mechanic.findUnique({ where: { id: mechanicId }, select: { id: true, garageId: true } })
      if (!existingMech) {
        await tx.mechanic.create({
          data: { id: mechanicId, name: mechanicName, avatar: mechanicAvatar, color: mechanicColor, garageId },
        })
      } else if (existingMech.garageId !== garageId) {
        // Le même identifiant appartient déjà à un AUTRE garage : on refuse
        // plutôt que de le déplacer (aucun écrasement silencieux).
        throw new SyncConflict('MECHANIC_FOREIGN_GARAGE')
      }

      // 6. La ligne de la clé mécanicien doit exister côté serveur (poussée par
      //    le keygen via /api/admin/licenses/create).
      const record = await tx.licenseKey.findUnique({ where: { licenseId: mechLid } })
      if (!record) throw new SyncConflict('MECHANIC_KEY_UNKNOWN')
      if (record.licenseType !== 'mechanic') throw new SyncConflict('MECHANIC_KEY_UNKNOWN')
      if (record.status === 'revoked' || record.revokedAt) throw new SyncConflict('MECHANIC_KEY_REVOKED')
      if (record.garageId && record.garageId !== garageId) throw new SyncConflict('MECHANIC_KEY_FOREIGN_GARAGE')

      // NON DESTRUCTIF : jamais d'écrasement d'une attribution existante.
      if (record.mechanicId && record.mechanicId !== mechanicId) {
        throw new SyncConflict('ALREADY_ASSIGNED')
      }
      const alreadyInSync = record.mechanicId === mechanicId
        && record.garageId === garageId
        && record.parentLicenseId === auth.licenseId

      if (!alreadyInSync) {
        const recordMac = computeRecordMac({
          licenseId: record.licenseId, token: record.token, status: record.status,
          expiryAt: record.expiryAt, hwid: record.hwid,
          parentLicenseId: auth.licenseId, mechanicId,
        })
        await tx.licenseKey.update({
          where: { licenseId: mechLid },
          data: {
            garageId,
            mechanicId,
            parentLicenseId: auth.licenseId,
            mechanicHint: record.mechanicHint ?? mechPayload.mn ?? null,
            assignedAt: record.assignedAt ?? now,
            recordMac,
          },
        })
      }

      // 7. Historique d'attribution — idempotent : une seule ligne ouverte
      //    par (clé, mécanicien). Le ré-envoi n'en crée pas une deuxième.
      const openAssignment = await tx.mechanicLicenseAssignment.findFirst({
        where: { licenseId: mechLid, mechanicId, unassignedAt: null },
        select: { id: true },
      })
      if (!openAssignment) {
        await tx.mechanicLicenseAssignment.create({
          data: { licenseId: mechLid, mechanicId, garageId, assignedBy: null, previousMechanicId: null },
        })
      }

      return { alreadyInSync }
    })

    logger.info('[sync/mechanic] attribution synchronisée', {
      key: shortId(mechLid), garage: shortId(garageId), mechanic: shortId(mechanicId),
      source: 'desktop', idempotent: result.alreadyInSync, at: now.toISOString(),
    })
    return NextResponse.json({
      ok: true,
      idempotent: result.alreadyInSync,
      licenseId: mechLid,
      garageId,
      mechanicId,
      syncedAt: now.toISOString(),
    })
  } catch (err) {
    if (err instanceof SyncConflict) {
      logger.warn('[sync/mechanic] conflit', { code: err.code, key: shortId(mechLid), garage: shortId(garageId) })
      return NextResponse.json({ ok: false, code: err.code }, { status: 409 })
    }
    logger.error('[sync/mechanic] erreur base', err)
    return NextResponse.json({ ok: false, code: 'SERVICE_UNAVAILABLE' }, { status: 503 })
  }
}

class SyncConflict extends Error {
  constructor(public readonly code: string) { super(code) }
}
