/**
 * Remontée POSTE → CLOUD des attributions de clés mécanicien.
 *
 * Appelé APRÈS que l'attribution locale est committée : l'action du patron ne
 * dépend jamais du réseau. Le résultat est renvoyé pour que l'interface indique
 * l'état RÉEL (« synchronisation cloud en attente » plutôt qu'un faux succès).
 *
 * Idempotent : ré-appeler avec la même attribution renvoie `idempotent: true`
 * côté serveur et ne crée aucun doublon d'historique.
 */
import { prisma } from '@/lib/db'
import { cloudPost, isDesktopInstance } from '@/lib/sync/cloud-client'
import { logger } from '@/lib/logger'
import { shortId } from '@/lib/sync/garage-auth'

export interface MechanicSyncResult {
  /** true si le cloud a confirmé l'attribution. */
  synced: boolean
  /** Code d'échec exploitable par l'UI (jamais de secret). */
  code?: string
  /** true si aucune remontée n'est nécessaire (instance cloud). */
  skipped?: boolean
}

/**
 * Pousse l'attribution de `licenseId` vers le serveur officiel.
 * Ne lève jamais. Marque `cloudSyncedAt` en cas de succès.
 */
export async function pushMechanicAssignment(licenseId: string): Promise<MechanicSyncResult> {
  if (!isDesktopInstance()) return { synced: true, skipped: true }

  try {
    const key = await prisma.licenseKey.findUnique({
      where: { licenseId },
      select: {
        licenseId: true, token: true, licenseType: true,
        garageId: true, mechanicId: true, parentLicenseId: true,
      },
    })
    if (!key || key.licenseType !== 'mechanic') return { synced: false, code: 'KEY_NOT_FOUND' }
    if (!key.garageId || !key.mechanicId) return { synced: false, code: 'NOT_ASSIGNED' }

    // Licence GARAGE servant de preuve d'identité : d'abord la licence parente
    // désignée par le `plid` signé, sinon une licence active de ce garage.
    const parent = key.parentLicenseId
      ? await prisma.licenseKey.findUnique({
          where: { licenseId: key.parentLicenseId },
          select: { token: true, licenseType: true, status: true },
        })
      : null
    const garageLicense = parent && parent.licenseType !== 'mechanic' && parent.status === 'active'
      ? parent
      : await prisma.licenseKey.findFirst({
          where: { garageId: key.garageId, status: 'active', licenseType: { not: 'mechanic' } },
          select: { token: true, licenseType: true, status: true },
          orderBy: { createdAt: 'desc' },
        })
    if (!garageLicense?.token) return { synced: false, code: 'NO_GARAGE_LICENSE' }

    const [garage, mechanic] = await Promise.all([
      prisma.garage.findUnique({ where: { id: key.garageId }, select: { id: true, name: true } }),
      prisma.mechanic.findUnique({
        where: { id: key.mechanicId },
        select: { id: true, name: true, avatar: true, color: true },
      }),
    ])
    if (!garage || !mechanic) return { synced: false, code: 'LOCAL_DATA_MISSING' }

    const out = await cloudPost('/api/sync/mechanic-assignment', {
      garageLicense:   garageLicense.token,
      mechanicLicense: key.token,
      garage:   { id: garage.id, name: garage.name },
      mechanic: { id: mechanic.id, name: mechanic.name, avatar: mechanic.avatar, color: mechanic.color },
    })

    if (out.ok) {
      await prisma.licenseKey.update({
        where: { licenseId },
        data: { cloudSyncedAt: new Date() },
      }).catch(() => { /* le suivi ne doit jamais casser l'action */ })
      logger.info('[sync/mechanic:push] confirmée', {
        key: shortId(licenseId), garage: shortId(key.garageId), mechanic: shortId(key.mechanicId),
        idempotent: out.data?.idempotent === true,
      })
      return { synced: true }
    }

    logger.warn('[sync/mechanic:push] non confirmée', {
      key: shortId(licenseId), code: out.code ?? 'UNKNOWN', status: out.status ?? 0,
    })
    return { synced: false, code: out.code ?? 'UNKNOWN' }
  } catch (err) {
    logger.warn('[sync/mechanic:push] erreur', { key: shortId(licenseId), message: (err as Error)?.message })
    return { synced: false, code: 'LOCAL_ERROR' }
  }
}

/**
 * Propage un changement de STATUT (suspension / réactivation / RÉVOCATION).
 *
 * Contrepartie de `pushMechanicAssignment` : sans elle, une clé révoquée sur le
 * poste resterait ACTIVE sur app.garageflows.fr et le mécanicien écarté
 * garderait l'accès depuis son téléphone. Ne lève jamais.
 */
export async function pushMechanicStatus(licenseId: string, status: string): Promise<MechanicSyncResult> {
  if (!isDesktopInstance()) return { synced: true, skipped: true }

  try {
    const key = await prisma.licenseKey.findUnique({
      where: { licenseId },
      select: { token: true, licenseType: true, garageId: true, parentLicenseId: true },
    })
    if (!key || key.licenseType !== 'mechanic') return { synced: false, code: 'KEY_NOT_FOUND' }

    const parent = key.parentLicenseId
      ? await prisma.licenseKey.findUnique({
          where: { licenseId: key.parentLicenseId },
          select: { token: true, licenseType: true, status: true },
        })
      : null
    const garageLicense = parent && parent.licenseType !== 'mechanic' && parent.status === 'active'
      ? parent
      : key.garageId
        ? await prisma.licenseKey.findFirst({
            where: { garageId: key.garageId, status: 'active', licenseType: { not: 'mechanic' } },
            select: { token: true, licenseType: true, status: true },
            orderBy: { createdAt: 'desc' },
          })
        : null
    if (!garageLicense?.token) return { synced: false, code: 'NO_GARAGE_LICENSE' }

    const out = await cloudPost('/api/sync/mechanic-status', {
      garageLicense: garageLicense.token,
      mechanicLicense: key.token,
      status,
    })
    if (out.ok) {
      logger.info('[sync/mechanic-status:push] confirmé', { key: shortId(licenseId), status })
      return { synced: true }
    }
    logger.warn('[sync/mechanic-status:push] non confirmé', { key: shortId(licenseId), status, code: out.code ?? 'UNKNOWN' })
    return { synced: false, code: out.code ?? 'UNKNOWN' }
  } catch (err) {
    logger.warn('[sync/mechanic-status:push] erreur', { key: shortId(licenseId), message: (err as Error)?.message })
    return { synced: false, code: 'LOCAL_ERROR' }
  }
}

/**
 * Rattrapage : re-pousse les attributions du garage jamais confirmées par le
 * cloud (poste hors ligne au moment de l'attribution). Borné, best-effort.
 */
export async function retryPendingMechanicSyncs(garageId: string, max = 5): Promise<number> {
  if (!isDesktopInstance()) return 0
  try {
    const pending = await prisma.licenseKey.findMany({
      where: { garageId, licenseType: 'mechanic', mechanicId: { not: null }, cloudSyncedAt: null },
      select: { licenseId: true },
      take: max,
    })
    let done = 0
    for (const p of pending) {
      const r = await pushMechanicAssignment(p.licenseId)
      if (r.synced) done++
    }
    return done
  } catch {
    return 0
  }
}
