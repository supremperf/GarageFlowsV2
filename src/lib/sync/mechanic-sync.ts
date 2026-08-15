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
      // Marquer la confirmation, exactement comme pour une attribution : sans
      // cette écriture, une révocation poussée avec succès restait « en attente »
      // et le rattrapage la rejouait à chaque passage.
      await prisma.licenseKey.update({
        where: { licenseId },
        data: { cloudSyncedAt: new Date() },
      }).catch(() => { /* le suivi ne doit jamais casser l'action */ })
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
 * Rattrapage : re-pousse vers le cloud tout état de clé mécanicien qu'il n'a
 * jamais confirmé (poste hors ligne au moment du geste). Borné, best-effort.
 *
 * `cloudSyncedAt: null` signifie « le cloud ne connaît pas l'état ACTUEL de
 * cette clé ». Le filtre exigeait auparavant `mechanicId: { not: null }`, si
 * bien qu'il ne rattrapait que les ATTRIBUTIONS : une révocation ou une
 * suspension effectuée pendant une coupure n'était jamais rejouée, et le
 * mécanicien concerné gardait l'accès à sa PWA indéfiniment. C'est le geste le
 * plus urgent des trois — on le traite donc en premier.
 */
export async function retryPendingMechanicSyncs(garageId: string, max = 5): Promise<number> {
  if (!isDesktopInstance()) return 0
  try {
    // Retirer un accès prime sur en accorder un : les clés qui ne sont plus
    // actives passent devant, quel que soit le plafond. La priorité est exprimée
    // par DEUX requêtes, et non par un `orderBy` sur le statut : un tri
    // alphabétique plaçait « active » avant « revoked » — l'inverse de
    // l'intention — et aurait resilencieusement changé au premier statut ajouté.
    const nonActives = await prisma.licenseKey.findMany({
      where: { garageId, licenseType: 'mechanic', cloudSyncedAt: null, status: { not: 'active' } },
      select: { licenseId: true, status: true, mechanicId: true },
      take: max,
    })
    const reste = max - nonActives.length
    const actives = reste > 0
      ? await prisma.licenseKey.findMany({
        // Une clé active SANS titulaire n'a rien à annoncer au cloud.
        where: { garageId, licenseType: 'mechanic', cloudSyncedAt: null, status: 'active', mechanicId: { not: null } },
        select: { licenseId: true, status: true, mechanicId: true },
        take: reste,
      })
      : []
    const pending = [...nonActives, ...actives]
    let done = 0
    for (const p of pending) {
      // Un état non actif se propage par le canal STATUT ; une clé active et
      // attribuée par celui de l'attribution. Une clé active sans titulaire n'a
      // rien à annoncer.
      const r = p.status !== 'active'
        ? await pushMechanicStatus(p.licenseId, p.status)
        : p.mechanicId
          ? await pushMechanicAssignment(p.licenseId)
          : { synced: false as const }
      if (r.synced) done++
    }
    return done
  } catch {
    return 0
  }
}
